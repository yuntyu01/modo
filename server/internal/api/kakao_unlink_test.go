package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestKakaoErasureQueuesRevocationAndRetriesWithoutTouchingOthers(t *testing.T) {
	var allow atomic.Bool
	called := make(chan struct{}, 10)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/user/unlink" || r.Header.Get("Authorization") != "KakaoAK test-admin" {
			w.WriteHeader(401)
			return
		}
		_ = r.ParseForm()
		if r.Form.Get("target_id") != "12345" || r.Form.Get("target_id_type") != "user_id" {
			w.WriteHeader(400)
			return
		}
		success := allow.Load()
		called <- struct{}{}
		if !success {
			w.WriteHeader(503)
			return
		}
		w.Write([]byte(`{"id":12345}`))
	}))
	defer upstream.Close()
	journal, err := OpenErasureJournal(filepath.Join(t.TempDir(), "journal.json"))
	if err != nil {
		t.Fatal(err)
	}
	previous := testConfig
	testConfig = Config{Erasures: journal, KakaoKey: "key", KakaoAdmin: "test-admin", KakaoAppID: "1613095", KakaoAPIURL: upstream.URL, PublicURL: "http://modo.test"}
	defer func() { testConfig = previous }()
	srv, pool := newTestServerDB(t)
	owner := signup(t, srv, "erase-kakao@example.test")
	other := signup(t, srv, "keep-kakao@example.test")
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `INSERT INTO oauth_identities(provider,subject,user_id) VALUES('kakao','12345',$1)`, owner.id); err != nil {
		t.Fatal(err)
	}
	if status := owner.do("DELETE", "/api/me", map[string]string{"confirmation": "DELETE"}, nil); status != 204 {
		t.Fatalf("delete: %d", status)
	}
	select {
	case <-called:
	case <-time.After(3 * time.Second):
		t.Fatal("revocation did not start")
	}
	if status := owner.do("GET", "/api/me", nil, nil); status != 401 {
		t.Fatalf("deleted session: %d", status)
	}
	if status := other.do("GET", "/api/me", nil, nil); status != 200 {
		t.Fatalf("unrelated account: %d", status)
	}
	deadline := time.Now().Add(time.Second)
	for {
		var n int
		_ = pool.QueryRow(ctx, `SELECT count(*) FROM kakao_unlink_jobs WHERE subject='12345'`).Scan(&n)
		if n == 1 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("retry missing")
		}
		time.Sleep(10 * time.Millisecond)
	}
	// Wait for the first worker to retain its failed job, then retry in isolation.
	time.Sleep(30 * time.Millisecond)
	allow.Store(true)
	_, _ = pool.Exec(ctx, `UPDATE kakao_unlink_jobs SET last_attempt_at=NULL`)
	api := New(pool, testConfig)
	if err := api.retryKakaoUnlinks(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM kakao_unlink_jobs`).Scan(&n)
	if n != 0 {
		t.Fatal("successful revocation not removed")
	}
}

func TestKakaoWebhookVerifiesAppAndSecretBeforeBlockingAccount(t *testing.T) {
	journal, err := OpenErasureJournal(filepath.Join(t.TempDir(), "journal.json"))
	if err != nil {
		t.Fatal(err)
	}
	previous := testConfig
	testConfig = Config{Erasures: journal, KakaoAdmin: "test-admin", KakaoAppID: "1613095"}
	defer func() { testConfig = previous }()
	srv, pool := newTestServerDB(t)
	owner := signup(t, srv, "webhook-owner@example.test")
	other := signup(t, srv, "webhook-other@example.test")
	if _, err := pool.Exec(context.Background(), `INSERT INTO oauth_identities(provider,subject,user_id) VALUES('kakao','12345',$1)`, owner.id); err != nil {
		t.Fatal(err)
	}
	send := func(secret, app, subject string) int {
		form := url.Values{"app_id": {app}, "user_id": {subject}, "referrer_type": {"UNLINK_FROM_APPS"}}
		req, _ := http.NewRequest("POST", srv.URL+"/api/auth/kakao/unlink", strings.NewReader(form.Encode()))
		req.Header.Set("Authorization", secret)
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		return res.StatusCode
	}
	if got := send("KakaoAK wrong", "1613095", "12345"); got != 401 {
		t.Fatalf("bad key: %d", got)
	}
	if got := send("KakaoAK test-admin", "different-app", "12345"); got != 400 {
		t.Fatalf("bad app: %d", got)
	}
	if owner.do("GET", "/api/me", nil, nil) != 200 {
		t.Fatal("unverified request deleted account")
	}
	if got := send("KakaoAK test-admin", "1613095", "12345"); got != 200 {
		t.Fatalf("verified webhook: %d", got)
	}
	if !journal.Blocked(owner.id) || owner.do("GET", "/api/me", nil, nil) != 401 {
		t.Fatal("verified withdrawal did not revoke access")
	}
	if other.do("GET", "/api/me", nil, nil) != 200 {
		t.Fatal("other account removed")
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		var n int
		_ = pool.QueryRow(context.Background(), `SELECT count(*) FROM users WHERE id=$1`, owner.id).Scan(&n)
		if n == 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("withdrawal not erased")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if got := send("KakaoAK test-admin", "1613095", "12345"); got != 200 {
		t.Fatalf("duplicate webhook: %d", got)
	}
}
