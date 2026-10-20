package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

// 가입이 받는 가장 긴 비밀번호(128자)도 bcrypt 72바이트 제한에 걸리지 않고, 72바이트 이하는 예전 해시와 그대로 맞는다.
func TestBcryptInputLongPasswords(t *testing.T) {
	short := "password-1234"
	if string(bcryptInput(short)) != short {
		t.Fatal("72바이트 이하 비밀번호는 그대로 넣어야 이미 있는 계정 해시와 맞는다")
	}
	old, err := bcrypt.GenerateFromPassword([]byte(short), bcrypt.MinCost)
	if err != nil || bcrypt.CompareHashAndPassword(old, bcryptInput(short)) != nil {
		t.Fatal("기존 해시와 맞지 않는다", err)
	}

	long := strings.Repeat("가", 128) // 384바이트
	hash, err := bcrypt.GenerateFromPassword(bcryptInput(long), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}
	if bcrypt.CompareHashAndPassword(hash, bcryptInput(long)) != nil {
		t.Fatal("같은 긴 비밀번호가 맞지 않는다")
	}
	// 앞 72바이트가 같아도 뒤가 다르면 다른 비밀번호다(잘라 쓰지 않는다)
	if bcrypt.CompareHashAndPassword(hash, bcryptInput(strings.Repeat("가", 127)+"나")) == nil {
		t.Fatal("뒤가 다른 비밀번호가 맞다고 나온다")
	}
}

// 이메일 로그인을 끈 서버는 가입·로그인을 410으로 막고 providers에서 password를 끈다(DB 없이 돈다)
func TestPasswordLoginOff(t *testing.T) {
	s := New(nil, Config{PasswordLoginOff: true})
	mux := http.NewServeMux()
	s.Routes(mux)
	for _, path := range []string{"/api/auth/register", "/api/auth/login"} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest("POST", path, strings.NewReader(`{"email":"a@example.com","password":"password123"}`)))
		if rec.Code != http.StatusGone || !strings.Contains(rec.Body.String(), "password_login_off") {
			t.Fatalf("%s: %d %s", path, rec.Code, rec.Body.String())
		}
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/auth/providers", nil))
	var p map[string]bool
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil || p["password"] {
		t.Fatalf("providers: %s", rec.Body.String())
	}
}
