package api

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// 가짜 카카오(토큰 교환·사용자 정보)를 띄우고 시작 → 콜백 → 코드 교환까지 돈다.
type fakeKakao struct {
	*httptest.Server
	users map[string]string // 인가 코드 → /v2/user/me 응답
}

func newFakeKakao(t *testing.T) *fakeKakao {
	f := &fakeKakao{users: map[string]string{}}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /oauth/token", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		if r.Form.Get("client_id") != "test-key" || r.Form.Get("grant_type") != "authorization_code" ||
			!strings.HasSuffix(r.Form.Get("redirect_uri"), "/api/auth/kakao/callback") {
			http.Error(w, "bad", 400)
			return
		}
		if _, ok := f.users[r.Form.Get("code")]; !ok {
			http.Error(w, "bad code", 400)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"access_token": "at-" + r.Form.Get("code")})
	})
	mux.HandleFunc("GET /v2/user/me", func(w http.ResponseWriter, r *http.Request) {
		me, ok := f.users[strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer at-")]
		if !ok {
			http.Error(w, "unauthorized", 401)
			return
		}
		w.Write([]byte(me))
	})
	f.Server = httptest.NewServer(mux)
	t.Cleanup(f.Close)
	return f
}

var noRedirect = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

func pkce() (verifier, challenge string) {
	verifier = "verifier-0123456789-0123456789-0123456789-abc"
	sum := sha256.Sum256([]byte(verifier))
	return verifier, base64.RawURLEncoding.EncodeToString(sum[:])
}

// 앱이 하는 일을 흉내: start → (카카오 로그인 화면은 건너뛰고) 콜백 → 앱 주소로 돌아온 code를 반환
func kakaoRound(t *testing.T, srv *httptest.Server, kakaoCode, challenge string) url.Values {
	t.Helper()
	start := srv.URL + "/api/auth/kakao/start?" + url.Values{
		"redirect_uri": {"modo://auth"}, "state": {"app-state"}, "code_challenge": {challenge},
	}.Encode()
	res, err := noRedirect.Get(start)
	if err != nil || res.StatusCode != 302 {
		t.Fatalf("start: %v %v", err, res.StatusCode)
	}
	authorize, _ := url.Parse(res.Header.Get("Location"))
	if authorize.Path != "/oauth/authorize" || authorize.Query().Get("client_id") != "test-key" {
		t.Fatalf("authorize url: %s", authorize)
	}
	cb := srv.URL + "/api/auth/kakao/callback?" + url.Values{"code": {kakaoCode}, "state": {authorize.Query().Get("state")}}.Encode()
	res, err = noRedirect.Get(cb)
	if err != nil || res.StatusCode != 302 {
		t.Fatalf("callback: %v %v", err, res.StatusCode)
	}
	back, _ := url.Parse(res.Header.Get("Location"))
	if back.Scheme != "modo" || back.Query().Get("state") != "app-state" {
		t.Fatalf("back to app: %s", back)
	}
	return back.Query()
}

func TestKakaoLogin(t *testing.T) {
	kakao := newFakeKakao(t)
	testConfig = Config{KakaoKey: "test-key", KakaoAdmin: "test-admin", KakaoAppID: "test-app", KakaoAuthURL: kakao.URL, KakaoAPIURL: kakao.URL, PublicURL: "http://modo.test"}
	defer func() { testConfig = Config{} }()
	srv := newTestServer(t)
	existing := signup(t, srv, "same@example.com")

	kakao.users["c-new"] = `{"id": 111, "kakao_account": {"profile": {"nickname": "카카오 사용자"}}}`
	kakao.users["c-link"] = `{"id": 222, "kakao_account": {"email": "Same@example.com", "is_email_valid": true, "is_email_verified": true, "profile": {"nickname": "같은 사람"}}}`
	kakao.users["c-unverified"] = `{"id": 333, "kakao_account": {"email": "same@example.com", "is_email_valid": true, "is_email_verified": false}}`

	c := &client{t: t, srv: srv}
	var prov map[string]bool
	c.do("GET", "/api/auth/providers", nil, &prov)
	if !prov["kakao"] {
		t.Fatalf("providers: %v", prov)
	}

	verifier, challenge := pkce()
	exchange := func(code, verifier string) (int, string, map[string]any) {
		var r struct {
			Token string         `json:"token"`
			User  map[string]any `json:"user"`
		}
		status := c.do("POST", "/api/auth/exchange", map[string]string{"code": code, "code_verifier": verifier, "device": "test"}, &r)
		return status, r.Token, r.User
	}

	// 처음 온 카카오 계정(이메일 동의 없음) → 새 사용자
	q := kakaoRound(t, srv, "c-new", challenge)
	if status, _, _ := exchange(q.Get("code"), "wrong-verifier-0123456789-0123456789-0123456789"); status != 401 {
		t.Fatalf("wrong verifier: %d", status)
	}
	// 틀린 verifier로 한 번 시도하면 코드는 이미 쓰인 것(가로챈 쪽이 먼저 쓰면 진짜 앱도 실패 → 다시 로그인)
	q = kakaoRound(t, srv, "c-new", challenge)
	status, token, user := exchange(q.Get("code"), verifier)
	if status != 200 || token == "" || user["name"] != "카카오 사용자" || user["email"] != "" {
		t.Fatalf("exchange: %d %v", status, user)
	}
	if status, _, _ := exchange(q.Get("code"), verifier); status != 401 {
		t.Fatalf("code reuse: %d", status)
	}
	newID := user["id"]
	q = kakaoRound(t, srv, "c-new", challenge)
	if _, _, again := exchange(q.Get("code"), verifier); again["id"] != newID {
		t.Fatalf("same kakao account should map to same user: %v vs %v", again["id"], newID)
	}
	me := &client{t: t, srv: srv, token: token}
	var meResp map[string]any
	me.do("GET", "/api/me", nil, &meResp)
	if logins, _ := meResp["logins"].([]any); len(logins) != 1 || logins[0] != "kakao" {
		t.Fatalf("me: %v", meResp)
	}

	// 같은 이메일의 기존(비밀번호) 계정에 자동으로 붙지 않는다: 비밀번호 가입은 이메일을 확인하지 않아
	// 남의 이메일로 먼저 가입해 둔 사람이 카카오 사용자의 계정을 넘겨받을 수 있다. 이메일은 이미 쓰이고 있어 비워 둔다.
	for _, code := range []string{"c-link", "c-unverified"} {
		q = kakaoRound(t, srv, code, challenge)
		if _, _, u := exchange(q.Get("code"), verifier); u["id"] == existing.id || u["email"] != "" {
			t.Fatalf("%s must not take over the password account: %v", code, u)
		}
	}
	// 이메일이 비어 있으면 확인된 카카오 이메일을 쓴다
	kakao.users["c-fresh"] = `{"id": 444, "kakao_account": {"email": "fresh@example.com", "is_email_valid": true, "is_email_verified": true}}`
	q = kakaoRound(t, srv, "c-fresh", challenge)
	if _, _, u := exchange(q.Get("code"), verifier); u["email"] != "fresh@example.com" {
		t.Fatalf("fresh verified email: %v", u)
	}

	// 사용자가 카카오 화면에서 취소하면 앱으로 error를 돌려준다
	res, _ := noRedirect.Get(srv.URL + "/api/auth/kakao/start?" + url.Values{"redirect_uri": {"modo://auth"}, "state": {"s"}, "code_challenge": {challenge}}.Encode())
	authorize, _ := url.Parse(res.Header.Get("Location"))
	res, _ = noRedirect.Get(srv.URL + "/api/auth/kakao/callback?error=access_denied&state=" + url.QueryEscape(authorize.Query().Get("state")))
	if back, _ := url.Parse(res.Header.Get("Location")); back.Query().Get("error") != "cancelled" {
		t.Fatalf("cancel: %s", back)
	}
	// 앱 주소가 아닌 곳으로는 돌려보내지 않는다
	for _, bad := range []string{"https://evil.example/cb", "javascript:alert(1)", ""} {
		res, _ := noRedirect.Get(srv.URL + "/api/auth/kakao/start?" + url.Values{"redirect_uri": {bad}, "state": {"s"}, "code_challenge": {challenge}}.Encode())
		if res.StatusCode != 400 {
			t.Fatalf("redirect %q allowed: %d", bad, res.StatusCode)
		}
	}
	// 모르는(만료된) state
	if res, _ := noRedirect.Get(srv.URL + "/api/auth/kakao/callback?code=x&state=nope"); res.StatusCode != 400 {
		t.Fatalf("unknown state: %d", res.StatusCode)
	}
}

func TestKakaoDisabled(t *testing.T) {
	srv := newTestServer(t)
	c := &client{t: t, srv: srv}
	var prov map[string]bool
	c.do("GET", "/api/auth/providers", nil, &prov)
	if prov["kakao"] {
		t.Fatalf("kakao should be off without key")
	}
	_, challenge := pkce()
	res, _ := noRedirect.Get(srv.URL + "/api/auth/kakao/start?" + url.Values{"redirect_uri": {"modo://auth"}, "state": {"s"}, "code_challenge": {challenge}}.Encode())
	if res.StatusCode != 404 {
		t.Fatalf("start without key: %d", res.StatusCode)
	}
}
