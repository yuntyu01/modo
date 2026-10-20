package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStoreReviewDisabledByDefault(t *testing.T) {
	for _, email := range []string{"", "invalid"} {
		s := New(nil, Config{PasswordLoginOff: true, StoreReviewEmail: email})
		mux := http.NewServeMux()
		s.Routes(mux)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/auth/review", strings.NewReader(`{}`)))
		if rec.Code != 404 {
			t.Fatalf("disabled review: %d", rec.Code)
		}
	}
}

func TestStoreReviewOnlyExistingAllowlistedAccount(t *testing.T) {
	srv, pool := newTestServerDB(t)
	reviewer := signup(t, srv, "review@example.test")
	other := signup(t, srv, "other@example.test")
	_ = other
	s := New(pool, Config{PasswordLoginOff: true, StoreReviewEmail: " Review@example.test ", RateLimit: 4})
	mux := http.NewServeMux()
	s.Routes(mux)
	guarded := httptest.NewServer(mux)
	defer guarded.Close()
	c := &client{t: t, srv: guarded}
	var out struct {
		Token string `json:"token"`
		User  struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	for _, email := range []string{"other@example.test", "missing@example.test"} {
		if code := c.do("POST", "/api/auth/review", map[string]string{"email": email, "password": "password123"}, nil); code != 401 {
			t.Fatalf("unlisted: %d", code)
		}
	}
	if code := c.do("POST", "/api/auth/review", map[string]string{"email": "review@example.test", "password": "wrongpass"}, nil); code != 401 {
		t.Fatalf("bad password: %d", code)
	}
	if code := c.do("POST", "/api/auth/review", map[string]string{"email": "REVIEW@example.test", "password": "password123"}, &out); code != 200 || out.Token == "" || out.User.ID != reviewer.id {
		t.Fatalf("existing reviewer denied: %d", code)
	}
	c.token = out.Token
	if code := c.do("GET", "/api/me", nil, nil); code != 200 {
		t.Fatalf("normal session: %d", code)
	}
	c.token = ""
	for _, path := range []string{"/api/auth/register", "/api/auth/login"} {
		if code := c.do("POST", path, map[string]string{"email": "review@example.test", "password": "password123"}, nil); code != 410 {
			t.Fatalf("ordinary auth reenabled: %d", code)
		}
	}
	if code := c.do("POST", "/api/auth/review", map[string]string{"email": "review@example.test", "password": "password123"}, nil); code != 429 {
		t.Fatalf("rate limit: %d", code)
	}
}
