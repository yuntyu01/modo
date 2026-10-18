package api

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGoogleLogin(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	var auth url.Values
	mux := http.NewServeMux()
	mux.HandleFunc("GET /jwks", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"keys": []any{map[string]string{
			"kty": "RSA", "kid": "test-key", "alg": "RS256", "use": "sig",
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	})
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		v := r.Form.Get("code_verifier")
		h := sha256.Sum256([]byte(v))
		if v == "" || base64.RawURLEncoding.EncodeToString(h[:]) != auth.Get("code_challenge") ||
			r.Form.Get("client_id") != "google-client" || r.Form.Get("client_secret") != "test-secret" ||
			r.Form.Get("grant_type") != "authorization_code" || r.Form.Get("redirect_uri") != "https://modo.test/api/auth/google/callback" {
			t.Error("Incorrect token exchange or missing upstream PKCE")
			w.WriteHeader(400)
			return
		}
		code := r.Form.Get("code")
		claims := map[string]any{"iss": "https://accounts.google.com", "aud": "google-client", "sub": "g-1", "exp": time.Now().Add(time.Hour).Unix(), "iat": time.Now().Unix(), "nonce": auth.Get("nonce"), "email": "same@example.com", "email_verified": true, "name": "Google tester"}
		switch code {
		case "aud":
			claims["aud"] = "other-app"
		case "iss":
			claims["iss"] = "https://attacker.test"
		case "expired":
			claims["exp"] = time.Now().Add(-time.Hour).Unix()
		case "nonce":
			claims["nonce"] = "wrong-nonce"
		case "azp":
			claims["azp"] = "other-app"
		case "multi":
			claims["aud"] = []string{"google-client", "other-app"}
		case "no-sub":
			claims["sub"] = ""
		case "fresh":
			claims["sub"] = "g-2"
			claims["email"] = "fresh@example.com"
		case "unverified":
			claims["sub"] = "g-3"
			claims["email"] = "unverified@example.com"
			claims["email_verified"] = false
		}
		header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","kid":"test-key"}`))
		body, _ := json.Marshal(claims)
		payload := header + "." + base64.RawURLEncoding.EncodeToString(body)
		sum := sha256.Sum256([]byte(payload))
		sig, _ := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
		if code == "signature" {
			sig[0] ^= 1
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{"access_token": "unused-upstream-token", "token_type": "Bearer", "expires_in": 3600, "id_token": payload + "." + base64.RawURLEncoding.EncodeToString(sig)})
	})
	upstream := httptest.NewServer(mux)
	defer upstream.Close()
	testConfig = Config{RateLimit: 1000, GoogleClientID: "google-client", GoogleSecret: "test-secret", PublicURL: "https://modo.test", GoogleAuthURL: upstream.URL + "/authorize", GoogleTokenURL: upstream.URL + "/token", GoogleJWKSURL: upstream.URL + "/jwks"}
	defer func() { testConfig = Config{} }()
	journal, err := OpenErasureJournal(filepath.Join(t.TempDir(), "erasures.json"))
	if err != nil {
		t.Fatal(err)
	}
	testConfig.Erasures = journal
	srv, pool := newTestServerDB(t)
	existing := signup(t, srv, "same@example.com")
	_, challenge := pkce()
	start := func() string {
		res, err := noRedirect.Get(srv.URL + "/api/auth/google/start?" + url.Values{"redirect_uri": {"modo://auth"}, "state": {"app-state"}, "code_challenge": {challenge}}.Encode())
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != 302 {
			t.Fatalf("start status %d", res.StatusCode)
		}
		u, _ := url.Parse(res.Header.Get("Location"))
		auth = u.Query()
		if auth.Get("scope") != "openid email profile" || auth.Get("access_type") == "offline" || auth.Get("nonce") == "" || auth.Get("code_challenge_method") != "S256" || auth.Get("client_secret") != "" {
			t.Fatal("Incorrect authorize parameters")
		}
		return auth.Get("state")
	}
	callback := func(state, code string) (int, url.Values) {
		res, err := noRedirect.Get(srv.URL + "/api/auth/google/callback?" + url.Values{"state": {state}, "code": {code}}.Encode())
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		u, _ := url.Parse(res.Header.Get("Location"))
		return res.StatusCode, u.Query()
	}
	exchange := func(code, verifier string) (int, map[string]any, string) {
		var out struct {
			Token string         `json:"token"`
			User  map[string]any `json:"user"`
		}
		c := &client{t: t, srv: srv}
		status := c.do("POST", "/api/auth/exchange", map[string]string{"code": code, "code_verifier": verifier}, &out)
		return status, out.User, out.Token
	}
	state := start()
	// A Kakao callback must not consume a Google state.
	res, _ := noRedirect.Get(srv.URL + "/api/auth/kakao/callback?state=" + state + "&code=x")
	res.Body.Close()
	if res.StatusCode != 400 {
		t.Fatal("Cross-provider state accepted")
	}
	status, q := callback(state, "ok")
	if status != 302 || q.Get("code") == "" || q.Get("state") != "app-state" {
		t.Fatal("Google callback failed")
	}
	if status, _ := callback(state, "ok"); status != 400 {
		t.Fatal("State replay accepted")
	}
	if status, _, _ := exchange(q.Get("code"), "wrong"); status != 401 {
		t.Fatal("Wrong app verifier accepted")
	}
	_, q = callback(start(), "ok")
	verifier, _ := pkce()
	status, user, token := exchange(q.Get("code"), verifier)
	if status != 200 || user["id"] == existing.id || user["email"] != "" || user["name"] != "Google tester" || token == "" {
		t.Fatal("Google account mapping failed or email takeover")
	}
	if status, _, _ := exchange(q.Get("code"), verifier); status != 401 {
		t.Fatal("Code replay accepted")
	}
	_, q = callback(start(), "ok")
	if _, again, _ := exchange(q.Get("code"), verifier); again["id"] != user["id"] {
		t.Fatal("Identity is not stable")
	}
	for _, code := range []string{"aud", "iss", "expired", "nonce", "azp", "multi", "no-sub", "signature"} {
		_, q = callback(start(), code)
		if q.Get("error") != "google" || q.Get("code") != "" {
			t.Fatalf("Invalid ID token accepted: %s", code)
		}
	}
	for _, code := range []string{"fresh", "unverified"} {
		_, q = callback(start(), code)
		status, u, _ := exchange(q.Get("code"), verifier)
		if status != 200 || (code == "fresh" && u["email"] != "fresh@example.com") || (code == "unverified" && u["email"] != "") {
			t.Fatalf("Email verification handling: %s", code)
		}
	}
	me := &client{t: t, srv: srv, token: token}
	var out map[string]any
	if me.do("GET", "/api/me", nil, &out) != 200 {
		t.Fatal("Google session invalid")
	}
	if got, _ := out["logins"].([]any); len(got) != 1 || got[0] != "google" {
		t.Fatal("Provider missing from account")
	}
	if me.do("DELETE", "/api/me", map[string]string{"confirmation": "DELETE"}, nil) != 204 {
		t.Fatal("Account deletion failed")
	}
	if me.do("GET", "/api/me", nil, nil) != 401 {
		t.Fatal("Deleted session still usable")
	}
	var identities int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM oauth_identities WHERE provider='google' AND subject='g-1'`).Scan(&identities); err != nil || identities != 0 {
		t.Fatal("Deleted identity remains")
	}
}

func TestOAuthRedirectAllowlist(t *testing.T) {
	for _, raw := range []string{"modo://auth", "naegirok://auth", "http://127.0.0.1:32123/oauth/callback"} {
		if !allowedRedirect(raw) {
			t.Errorf("Rejected app callback: %s", raw)
		}
	}
	for _, raw := range []string{"modo://evil", "modo://auth/path", "modo://auth?x=y", "modo://auth#fragment", "http://localhost:32123/oauth/callback", "http://127.0.0.1/oauth/callback", "http://user@127.0.0.1:32123/oauth/callback", "http://127.0.0.1:65536/oauth/callback", "https://evil.test"} {
		if allowedRedirect(raw) {
			t.Errorf("Unsafe callback accepted: %s", raw)
		}
	}
}

func TestGoogleDisabled(t *testing.T) {
	s := New(nil, Config{GoogleClientID: "id", PublicURL: "https://modo.test"})
	if s.googleEnabled() {
		t.Fatal("Enabled without client secret")
	}
	w := httptest.NewRecorder()
	s.googleStart(w, httptest.NewRequest("GET", "/api/auth/google/start", nil))
	if w.Code != 404 || !strings.Contains(w.Body.String(), "google_disabled") {
		t.Fatal("Missing config must fail closed")
	}
}

func TestOAuthMigrationPreservesExistingKakaoAccounts(t *testing.T) {
	srv, pool := newTestServerDB(t)
	u := signup(t, srv, "migration@example.test")
	ctx := context.Background()
	_, err := pool.Exec(ctx, `
		INSERT INTO oauth_identities(provider,subject,user_id) VALUES('kakao','original-kakao',$1);
	`, u.id)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `
		ALTER TABLE oauth_identities DROP CONSTRAINT oauth_identities_provider_check;
		ALTER TABLE oauth_identities ADD CONSTRAINT oauth_identities_provider_check CHECK(provider IN ('kakao'));
		ALTER TABLE oauth_states DROP COLUMN provider, DROP COLUMN nonce_hash, DROP COLUMN upstream_verifier;
		INSERT INTO oauth_states(state_hash,redirect_uri,client_state,challenge,expires_at)
		VALUES(decode('010203','hex'),'modo://auth','original-state','original-challenge',now()+interval '10 minutes');
	`)
	if err != nil {
		t.Fatal(err)
	}
	s := New(pool, Config{})
	for range 2 {
		if err := s.Migrate(ctx); err != nil {
			t.Fatal(err)
		}
	}
	var subject, provider string
	if err := pool.QueryRow(ctx, `SELECT subject FROM oauth_identities WHERE user_id=$1`, u.id).Scan(&subject); err != nil || subject != "original-kakao" {
		t.Fatal("Existing identity was not preserved")
	}
	if err := pool.QueryRow(ctx, `SELECT provider FROM oauth_states WHERE client_state='original-state'`).Scan(&provider); err != nil || provider != "kakao" {
		t.Fatal("Existing OAuth state was not preserved")
	}
	if u.do("GET", "/api/me", nil, nil) != 200 {
		t.Fatal("Existing session no longer works")
	}
}
