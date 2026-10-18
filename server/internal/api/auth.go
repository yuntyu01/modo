package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net"
	"net/http"
	"net/mail"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
)

type ctxKey struct{}

type authUser struct {
	ID    uuid.UUID
	Email string // 카카오 계정은 비어 있을 수 있다
	Name  string
}

func (u authUser) json() map[string]any {
	return map[string]any{"id": u.ID, "email": u.Email, "name": u.Name}
}

func userFrom(ctx context.Context) authUser { return ctx.Value(ctxKey{}).(authUser) }

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Device   string `json:"device"`
}

// 잘못됐으면 (오류 code, 문구)
func (c *credentials) normalize() (string, string) {
	c.Email = strings.ToLower(strings.TrimSpace(c.Email))
	if _, err := mail.ParseAddress(c.Email); err != nil || len(c.Email) > 254 {
		return "invalid_email", "이메일 형식이 잘못됐습니다"
	}
	if n := utf8.RuneCountInString(c.Password); n < 8 || n > 128 {
		return "password_length", "비밀번호는 8~128자여야 합니다"
	}
	if utf8.RuneCountInString(c.Device) > 60 {
		c.Device = string([]rune(c.Device)[:60])
	}
	return "", ""
}

// 이메일 로그인을 끈 서버: 예전 앱에도 Google·카카오로 들어오라고 알린다
func (s *Server) passwordLoginOff(w http.ResponseWriter) bool {
	if !s.cfg.PasswordLoginOff {
		return false
	}
	errJSON(w, http.StatusGone, "password_login_off", "이메일 로그인은 더 이상 쓰지 않아요. Google이나 카카오로 로그인해 주세요")
	return true
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	if s.passwordLoginOff(w) {
		return
	}
	var c credentials
	if !decode(w, r, &c) {
		return
	}
	if code, msg := c.normalize(); code != "" {
		errJSON(w, http.StatusBadRequest, code, msg)
		return
	}
	if !s.limiter.allow("register:" + s.clientIP(r)) {
		errJSON(w, http.StatusTooManyRequests, "rate_limited", "잠시 후 다시 시도해 주세요")
		return
	}
	hash, err := bcrypt.GenerateFromPassword(bcryptInput(c.Password), bcrypt.DefaultCost)
	if err != nil {
		serverError(w, err)
		return
	}
	id := uuid.New()
	err = pgx.BeginFunc(r.Context(), s.db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(r.Context(), `INSERT INTO users (id, email) VALUES ($1, $2)`, id, c.Email); err != nil {
			return err
		}
		_, err := tx.Exec(r.Context(), `INSERT INTO password_logins (user_id, password_hash) VALUES ($1, $2)`, id, string(hash))
		return err
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		errJSON(w, http.StatusConflict, "email_taken", "이미 가입된 이메일입니다")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	s.issueSession(w, r, authUser{ID: id, Email: c.Email}, c.Device, http.StatusCreated)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	if s.passwordLoginOff(w) {
		return
	}
	var c credentials
	if !decode(w, r, &c) {
		return
	}
	if code, _ := c.normalize(); code != "" {
		errJSON(w, http.StatusUnauthorized, "bad_credentials", "이메일 또는 비밀번호가 맞지 않습니다")
		return
	}
	if !s.limiter.allow("login:"+s.clientIP(r)) || !s.limiter.allow("login:"+c.Email) {
		errJSON(w, http.StatusTooManyRequests, "rate_limited", "잠시 후 다시 시도해 주세요")
		return
	}
	var u authUser
	var hash string
	err := s.db.QueryRow(r.Context(), `
		SELECT u.id, u.email, u.name, p.password_hash FROM users u JOIN password_logins p ON p.user_id = u.id
		WHERE u.email = $1`, c.Email).Scan(&u.ID, &u.Email, &u.Name, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		// 가입 여부가 응답 시간으로 드러나지 않게 같은 비용을 쓴다.
		bcrypt.CompareHashAndPassword(dummyHash, bcryptInput(c.Password))
		errJSON(w, http.StatusUnauthorized, "bad_credentials", "이메일 또는 비밀번호가 맞지 않습니다")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), bcryptInput(c.Password)) != nil {
		errJSON(w, http.StatusUnauthorized, "bad_credentials", "이메일 또는 비밀번호가 맞지 않습니다")
		return
	}
	s.issueSession(w, r, u, c.Device, http.StatusOK)
}

var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("dummy-password"), bcrypt.DefaultCost)

// bcrypt는 72바이트까지만 받는다(넘으면 가입이 오류로 끝난다). 그보다 긴 비밀번호(한글이면 25자쯤부터)는
// SHA-256을 base64(44바이트)로 줄여 넣는다. 72바이트 이하는 그대로라 이미 있는 계정의 해시와 같다.
func bcryptInput(password string) []byte {
	if len(password) <= 72 {
		return []byte(password)
	}
	sum := sha256.Sum256([]byte(password))
	return []byte(base64.StdEncoding.EncodeToString(sum[:]))
}

func (s *Server) issueSession(w http.ResponseWriter, r *http.Request, u authUser, device string, status int) {
	if s.cfg.Erasures.Blocked(u.ID.String()) {
		errJSON(w, 401, "session_expired", "삭제 요청된 계정입니다")
		return
	}
	raw := make([]byte, 32)
	rand.Read(raw)
	token := base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(token))
	if _, err := s.db.Exec(r.Context(), `INSERT INTO sessions (token_hash, user_id, device) VALUES ($1, $2, $3)`, sum[:], u.ID, device); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, status, map[string]any{"token": token, "user": u.json()})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	sum := sha256.Sum256([]byte(bearer(r)))
	if _, err := s.db.Exec(r.Context(), `DELETE FROM sessions WHERE token_hash = $1`, sum[:]); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	out := u.json()
	logins := []string{}
	rows, err := s.db.Query(r.Context(), `
		SELECT 'password' FROM password_logins WHERE user_id = $1
		UNION ALL SELECT provider FROM oauth_identities WHERE user_id = $1`, u.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var p string
		rows.Scan(&p)
		logins = append(logins, p)
	}
	rows.Close()
	out["logins"] = logins
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) auth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := bearer(r)
		if token == "" {
			errJSON(w, http.StatusUnauthorized, "login_required", "로그인이 필요합니다")
			return
		}
		sum := sha256.Sum256([]byte(token))
		var u authUser
		// 요청마다 세션 행을 고쳐 쓰지 않는다: 마지막 사용 시각은 1시간에 한 번만 갱신(오래 안 쓴 세션 정리용이라 충분).
		err := s.db.QueryRow(r.Context(), `
			WITH touch AS (
				UPDATE sessions SET last_used_at = now()
				WHERE token_hash = $1 AND last_used_at < now() - interval '1 hour'
			)
			SELECT u.id, COALESCE(u.email, ''), u.name FROM sessions s JOIN users u ON u.id = s.user_id
			WHERE s.token_hash = $1`, sum[:]).Scan(&u.ID, &u.Email, &u.Name)
		if errors.Is(err, pgx.ErrNoRows) {
			errJSON(w, http.StatusUnauthorized, "session_expired", "로그인이 만료됐습니다")
			return
		}
		if err != nil {
			serverError(w, err)
			return
		}
		if s.cfg.Erasures.Blocked(u.ID.String()) {
			errJSON(w, 401, "session_expired", "삭제 요청된 계정입니다")
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, u)))
	}
}

func bearer(r *http.Request) string {
	h := r.Header.Get("Authorization")
	if t, ok := strings.CutPrefix(h, "Bearer "); ok {
		return strings.TrimSpace(t)
	}
	return ""
}

// 요청을 보낸 곳. TRUST_PROXY=1이면(HTTPS 리버스 프록시 뒤) 프록시가 붙인 X-Forwarded-For의 마지막 주소를 쓴다.
// (앞쪽 주소는 클라이언트가 마음대로 써 보낼 수 있다. 프록시가 덧붙인 마지막 주소가 실제 접속 주소)
func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			return strings.TrimSpace(parts[len(parts)-1])
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// 키마다 1분에 max번까지(기본 10, RATE_LIMIT로 바꿈). 단일 인스턴스용 간단한 고정 창 제한.
type limiter struct {
	mu   sync.Mutex
	max  int
	hits map[string][]time.Time
}

func newLimiter(max int) *limiter {
	if max <= 0 {
		max = 10
	}
	return &limiter{max: max, hits: map[string][]time.Time{}}
}

func (l *limiter) allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	// Expire inactive IP/email keys too, rather than keeping them until restart.
	for k, times := range l.hits {
		if len(times) == 0 || now.Sub(times[len(times)-1]) >= time.Minute {
			delete(l.hits, k)
		}
	}
	kept := l.hits[key][:0]
	for _, t := range l.hits[key] {
		if now.Sub(t) < time.Minute {
			kept = append(kept, t)
		}
	}
	if len(kept) >= l.max {
		l.hits[key] = kept
		return false
	}
	l.hits[key] = append(kept, now)
	return true
}
