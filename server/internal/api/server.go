package api

import (
	"context"
	_ "embed"
	"encoding/json"
	"github.com/coreos/go-oidc/v3/oidc"
	"log"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schema string

type Server struct {
	db             *pgxpool.Pool
	limiter        *limiter
	cfg            Config
	popular        popularCache
	googleVerifier *oidc.IDTokenVerifier
}

func New(db *pgxpool.Pool, cfg Config) *Server {
	cfg.defaults()
	s := &Server{db: db, limiter: newLimiter(cfg.RateLimit), cfg: cfg}
	if s.googleEnabled() {
		ctx := oidc.ClientContext(context.Background(), cfg.HTTP)
		s.googleVerifier = oidc.NewVerifier("https://accounts.google.com", oidc.NewRemoteKeySet(ctx, cfg.GoogleJWKSURL), &oidc.Config{ClientID: cfg.GoogleClientID, SupportedSigningAlgs: []string{oidc.RS256}})
	}
	return s
}

func (s *Server) Migrate(ctx context.Context) error {
	_, err := s.db.Exec(ctx, schema)
	return err
}

// Cleanup: 오래된 재전송 기록(30일), 오래 안 쓴 세션(180일), 끝난 외부 로그인 상태를 지운다. main이 주기적으로 부른다.
func (s *Server) Cleanup(ctx context.Context) error {
	if err := s.ApplyErasures(ctx); err != nil {
		return err
	}
	if err := s.retryKakaoUnlinks(ctx); err != nil {
		return err
	}
	for _, q := range []string{
		`DELETE FROM applied_ops WHERE created_at < now() - interval '30 days'`,
		`DELETE FROM sessions WHERE last_used_at < now() - interval '180 days'`,
		`DELETE FROM oauth_states WHERE expires_at < now()`,
		`DELETE FROM login_codes WHERE expires_at < now()`,
	} {
		if _, err := s.db.Exec(ctx, q); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) Routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/auth/register", s.register)
	mux.HandleFunc("POST /api/auth/login", s.login)
	mux.HandleFunc("POST /api/auth/logout", s.auth(s.logout))
	mux.HandleFunc("GET /api/auth/providers", s.providers)
	mux.HandleFunc("GET /api/auth/kakao/start", s.kakaoStart)
	mux.HandleFunc("GET /api/auth/kakao/callback", s.kakaoCallback)
	mux.HandleFunc("GET /api/auth/kakao/unlink", s.kakaoUnlinkWebhook)
	mux.HandleFunc("POST /api/auth/kakao/unlink", s.kakaoUnlinkWebhook)
	mux.HandleFunc("GET /api/auth/google/start", s.googleStart)
	mux.HandleFunc("GET /api/auth/google/callback", s.googleCallback)
	mux.HandleFunc("POST /api/auth/exchange", s.exchange)
	mux.HandleFunc("GET /api/me", s.auth(s.me))
	mux.HandleFunc("DELETE /api/me", s.auth(s.deleteAccount))
	mux.HandleFunc("GET /api/me/theme", s.auth(s.getTheme))
	mux.HandleFunc("PUT /api/me/theme", s.auth(s.putTheme))
	mux.HandleFunc("GET /api/themes/popular", s.popularThemes)

	mux.HandleFunc("POST /api/sync/push", s.auth(s.push))
	mux.HandleFunc("GET /api/sync/pull", s.auth(s.pull))

	mux.HandleFunc("GET /api/folders/{id}/shares", s.auth(s.listShares))
	mux.HandleFunc("POST /api/folders/{id}/members", s.auth(s.addMember))
	mux.HandleFunc("PATCH /api/folders/{id}/members/{user}", s.auth(s.updateMember))
	mux.HandleFunc("DELETE /api/folders/{id}/members/{user}", s.auth(s.removeMember))
	mux.HandleFunc("POST /api/folders/{id}/links", s.auth(s.createLink))
	mux.HandleFunc("DELETE /api/folders/{id}/links/{token}", s.auth(s.deleteLink))
	mux.HandleFunc("GET /s/{token}", s.publicLink)
}

func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	if err := json.NewDecoder(r.Body).Decode(v); err != nil {
		badRequest(w, "JSON 본문이 잘못됐습니다")
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// 오류 응답: code는 앱이 사용자 언어로 바꿔 보여 줄 고정 값(app/src/i18n.ts의 err_<code>), error는 그 code를 모르는 클라이언트용 문구.
func errJSON(w http.ResponseWriter, status int, code, msg string) {
	writeJSON(w, status, map[string]string{"code": code, "error": msg})
}

func badRequest(w http.ResponseWriter, msg string) {
	errJSON(w, http.StatusBadRequest, "bad_request", msg)
}

func serverError(w http.ResponseWriter, err error) {
	// Database errors can contain row values. Keep user content and credentials out of logs.
	log.Print("request_failed")
	errJSON(w, http.StatusInternalServerError, "server", "서버 오류")
}
