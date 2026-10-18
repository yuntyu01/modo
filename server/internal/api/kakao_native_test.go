package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestKakaoNativeValidatesTokenAndPreservesIdentity(t *testing.T) {
	infoID, appID, expires := int64(111), int64(1613095), int64(600)
	profileID := int64(111)
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer native-credential" {
			w.WriteHeader(401)
			return
		}
		switch r.URL.Path {
		case "/v1/user/access_token_info":
			json.NewEncoder(w).Encode(map[string]int64{"id": infoID, "app_id": appID, "expires_in": expires})
		case "/v2/user/me":
			json.NewEncoder(w).Encode(map[string]any{"id": profileID, "kakao_account": map[string]any{"profile": map[string]string{"nickname": "Talk user"}}})
		default:
			w.WriteHeader(404)
		}
	}))
	defer api.Close()
	testConfig = Config{KakaoKey: "test-key", KakaoAdmin: "test-admin", KakaoAppID: "1613095", KakaoAPIURL: api.URL, PublicURL: "https://modo.test", RateLimit: 100}
	defer func() { testConfig = Config{} }()
	srv, db := newTestServerDB(t)
	// Simulate the identity already created by the REST login path.
	existing := signup(t, srv, "existing-native@example.com")
	if _, err := db.Exec(t.Context(), `INSERT INTO oauth_identities(provider, subject, user_id) VALUES('kakao','111',$1)`, existing.id); err != nil {
		t.Fatal(err)
	}
	c := &client{t: t, srv: srv}
	verifier, challenge := pkce()
	request := func(token string) (int, string) {
		var out struct {
			Code string `json:"code"`
		}
		status := c.do("POST", "/api/auth/kakao/native", map[string]string{"access_token": token, "code_challenge": challenge}, &out)
		return status, out.Code
	}
	for _, fail := range []string{"wrong-app", "expired", "wrong-subject", "invalid-token"} {
		appID, expires, profileID = 1613095, 600, 111
		token := "native-credential"
		switch fail {
		case "wrong-app":
			appID = 1604236
		case "expired":
			expires = 0
		case "wrong-subject":
			profileID = 222
		case "invalid-token":
			token = "invalid"
		}
		if status, code := request(token); status != 401 || code != "kakao_failed" {
			t.Fatalf("%s accepted: %d", fail, status)
		}
	}
	appID, expires, profileID = 1613095, 600, 111
	status, code := request("native-credential")
	if status != 200 || code == "" {
		t.Fatalf("native login: %d", status)
	}
	var account struct {
		Token string `json:"token"`
		User  struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	if c.do("POST", "/api/auth/exchange", map[string]string{"code": code, "code_verifier": verifier, "device": "test-native"}, &account) != 200 || account.User.ID != existing.id || account.Token == "" {
		t.Fatal("existing identity was not retained")
	}
	if c.do("POST", "/api/auth/exchange", map[string]string{"code": code, "code_verifier": verifier}, nil) != 401 {
		t.Fatal("one-time code replay accepted")
	}
	_, code = request("native-credential")
	if c.do("POST", "/api/auth/exchange", map[string]string{"code": code, "code_verifier": "wrong"}, nil) != 401 {
		t.Fatal("wrong PKCE accepted")
	}
	var users int
	if err := db.QueryRow(t.Context(), `SELECT count(*) FROM users`).Scan(&users); err != nil || users != 1 {
		t.Fatalf("native flow created extra users: %d %v", users, err)
	}
}
