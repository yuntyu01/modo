package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// 카카오 로그인(REST API, 인가 코드 방식).
//
//	앱 ──(1) /api/auth/kakao/start?redirect_uri=modo://auth&state&code_challenge──▶ 서버 ──302──▶ 카카오 로그인
//	카카오 ──(2) /api/auth/kakao/callback?code&state──▶ 서버: 토큰 교환·사용자 정보 → 일회용 코드
//	서버 ──302──▶ modo://auth?code&state (앱이 브라우저에서 돌아옴)
//	앱 ──(3) POST /api/auth/exchange {code, code_verifier}──▶ 세션 토큰
//
// 카카오 키는 서버만 갖는다. 앱 주소(modo://)는 다른 앱이 가로챌 수 있어 일회용 코드는 PKCE(code_verifier)가
// 있어야만 토큰으로 바뀐다.

type Config struct {
	Erasures       *ErasureJournal
	KakaoKey       string // 카카오 REST API 키. 비어 있으면 카카오 로그인을 끈다
	KakaoSecret    string // 카카오 Client Secret(콘솔에서 켰을 때만)
	KakaoAdmin     string // 서버 전용. 연결 해제 웹훅 검증 및 탈퇴 시 연결 해제에만 사용.
	KakaoAppID     string
	PublicURL      string // 카카오가 돌아올 이 서버의 외부 주소(예: https://modo.example.com). 콘솔의 Redirect URI = PublicURL + /api/auth/kakao/callback
	KakaoAuthURL   string // 기본 https://kauth.kakao.com (테스트에서 바꾼다)
	KakaoAPIURL    string // 기본 https://kapi.kakao.com
	GoogleClientID string
	GoogleSecret   string
	GoogleAuthURL  string // Overrides are only for isolated tests, never environment variables.
	GoogleTokenURL string
	GoogleJWKSURL  string
	HTTP           *http.Client
	TrustProxy     bool // 리버스 프록시 뒤면 X-Forwarded-For로 접속 주소를 본다(요청 수 제한용)
	RateLimit      int  // 로그인·가입 등 접속 주소마다 1분에 받는 횟수(0이면 10)

	// 이메일 가입·로그인을 끈다. 로그인은 Google·카카오만 쓴다(앱에서 이메일 로그인을 없앴다).
	// 실제 서버는 PASSWORD_LOGIN=1일 때만 켜 둔다(테스트·E2E 서버가 계정을 만들 때). 0값(켬)은 테스트용 Config{}를 위해서
	PasswordLoginOff bool
	// Existing store-review account only. Empty disables review login; never permits registration.
	StoreReviewEmail string
}

func (c *Config) defaults() {
	if c.KakaoAuthURL == "" {
		c.KakaoAuthURL = "https://kauth.kakao.com"
	}
	if c.KakaoAPIURL == "" {
		c.KakaoAPIURL = "https://kapi.kakao.com"
	}
	if c.GoogleAuthURL == "" {
		c.GoogleAuthURL = "https://accounts.google.com/o/oauth2/v2/auth"
	}
	if c.GoogleTokenURL == "" {
		c.GoogleTokenURL = "https://oauth2.googleapis.com/token"
	}
	if c.GoogleJWKSURL == "" {
		c.GoogleJWKSURL = "https://www.googleapis.com/oauth2/v3/certs"
	}
	if c.HTTP == nil {
		c.HTTP = &http.Client{Timeout: 10 * time.Second}
	}
	c.PublicURL = strings.TrimRight(c.PublicURL, "/")
}

func (s *Server) kakaoEnabled() bool {
	return s.cfg.KakaoKey != "" && s.cfg.PublicURL != "" && s.cfg.KakaoAdmin != "" && s.cfg.KakaoAppID != ""
}

func (s *Server) kakaoCallbackURL() string { return s.cfg.PublicURL + "/api/auth/kakao/callback" }

func (s *Server) providers(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, map[string]bool{"password": !s.cfg.PasswordLoginOff, "kakao": s.kakaoEnabled(), "google": s.googleEnabled(), "storeReview": s.storeReviewEnabled()})
}

var challengeRe = regexp.MustCompile(`^[A-Za-z0-9_-]{43,128}$`)

// 돌아갈 곳은 앱 주소(modo://, naegirok://)나 이 컴퓨터(개발용 웹)만.
func allowedRedirect(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || len(raw) > 300 || u.User != nil || u.Fragment != "" || u.RawQuery != "" {
		return false
	}
	switch u.Scheme {
	case "modo", "naegirok":
		return u.Host == "auth" && u.Path == "" && u.Opaque == ""
	case "http":
		port, err := strconv.Atoi(u.Port())
		return err == nil && port > 0 && port <= 65535 && u.Hostname() == "127.0.0.1" && u.Path == "/oauth/callback"
	}
	return false
}

func randomToken() (string, []byte) {
	b := make([]byte, 32)
	rand.Read(b)
	t := base64.RawURLEncoding.EncodeToString(b)
	sum := sha256.Sum256([]byte(t))
	return t, sum[:]
}

func hashOf(t string) []byte {
	sum := sha256.Sum256([]byte(t))
	return sum[:]
}

func (s *Server) kakaoStart(w http.ResponseWriter, r *http.Request) {
	if !s.kakaoEnabled() {
		errJSON(w, http.StatusNotFound, "kakao_disabled", "이 서버에는 카카오 로그인이 설정되지 않았습니다")
		return
	}
	q := r.URL.Query()
	redirect, clientState, challenge := q.Get("redirect_uri"), q.Get("state"), q.Get("code_challenge")
	if !allowedRedirect(redirect) || clientState == "" || len(clientState) > 200 || !challengeRe.MatchString(challenge) {
		badRequest(w, "redirect_uri/state/code_challenge가 잘못됐습니다")
		return
	}
	if !s.limiter.allow("oauth:" + s.clientIP(r)) {
		errJSON(w, http.StatusTooManyRequests, "rate_limited", "잠시 후 다시 시도해 주세요")
		return
	}
	state, sum := randomToken()
	if _, err := s.db.Exec(r.Context(), `
		INSERT INTO oauth_states (state_hash, redirect_uri, client_state, challenge, expires_at)
		VALUES ($1, $2, $3, $4, now() + interval '10 minutes')`, sum, redirect, clientState, challenge); err != nil {
		serverError(w, err)
		return
	}
	v := url.Values{
		"client_id":     {s.cfg.KakaoKey},
		"redirect_uri":  {s.kakaoCallbackURL()},
		"response_type": {"code"},
		"state":         {state},
	}
	w.Header().Set("Cache-Control", "no-store")
	http.Redirect(w, r, s.cfg.KakaoAuthURL+"/oauth/authorize?"+v.Encode(), http.StatusFound)
}

var oauthErrorPage = template.Must(template.New("e").Parse(`<!doctype html><html lang="{{.Lang}}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>modo</title></head>
<body style="font-family:system-ui,sans-serif;padding:32px;background:#050505;color:#fff">
<h2>{{.T.LoginTitle}}</h2><p>{{.T.LoginExpired}}</p><p>{{.T.LoginRetry}}</p></body></html>`))

func (s *Server) kakaoCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	q := r.URL.Query()
	var redirect, clientState, challenge string
	err := s.db.QueryRow(ctx, `
		DELETE FROM oauth_states WHERE state_hash = $1 AND provider = 'kakao' AND expires_at > now()
		RETURNING redirect_uri, client_state, challenge`, hashOf(q.Get("state"))).Scan(&redirect, &clientState, &challenge)
	if errors.Is(err, pgx.ErrNoRows) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusBadRequest)
		lang := pageLang(r)
		oauthErrorPage.Execute(w, struct {
			Lang string
			T    pageText
		}{lang, pageTexts[lang]})
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	back := func(params url.Values) {
		params.Set("state", clientState)
		u, _ := url.Parse(redirect)
		qs := u.Query()
		for k, v := range params {
			qs[k] = v
		}
		u.RawQuery = qs.Encode()
		w.Header().Set("Cache-Control", "no-store")
		http.Redirect(w, r, u.String(), http.StatusFound)
	}
	if e := q.Get("error"); e != "" {
		back(url.Values{"error": {"cancelled"}})
		return
	}
	ku, err := s.kakaoUser(ctx, q.Get("code"))
	if err != nil {
		log.Print("kakao_exchange_failed")
		back(url.Values{"error": {"kakao"}})
		return
	}
	u, err := s.findOrCreateKakaoUser(ctx, ku)
	if err != nil {
		log.Print("kakao_user_lookup_failed")
		back(url.Values{"error": {"server"}})
		return
	}
	code, sum := randomToken()
	if _, err := s.db.Exec(ctx, `
		INSERT INTO login_codes (code_hash, user_id, challenge, expires_at) VALUES ($1, $2, $3, now() + interval '2 minutes')`,
		sum, u.ID, challenge); err != nil {
		log.Print("kakao_login_code_failed")
		back(url.Values{"error": {"server"}})
		return
	}
	back(url.Values{"code": {code}})
}

type kakaoProfile struct {
	Subject  string
	Email    string // 확인된 이메일만(아니면 빈 문자열)
	Nickname string
}

func (s *Server) kakaoUser(ctx context.Context, code string) (kakaoProfile, error) {
	form := url.Values{
		"grant_type":   {"authorization_code"},
		"client_id":    {s.cfg.KakaoKey},
		"redirect_uri": {s.kakaoCallbackURL()},
		"code":         {code},
	}
	if s.cfg.KakaoSecret != "" {
		form.Set("client_secret", s.cfg.KakaoSecret)
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.KakaoAuthURL+"/oauth/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded;charset=utf-8")
	var tok struct {
		AccessToken string `json:"access_token"`
	}
	if err := s.kakaoJSON(req, &tok); err != nil {
		return kakaoProfile{}, fmt.Errorf("token: %w", err)
	}
	if tok.AccessToken == "" {
		return kakaoProfile{}, errors.New("token: empty")
	}
	return s.kakaoUserWithToken(ctx, tok.AccessToken)
}

func (s *Server) kakaoUserWithToken(ctx context.Context, accessToken string) (kakaoProfile, error) {
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, s.cfg.KakaoAPIURL+"/v2/user/me", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	var me struct {
		ID      int64 `json:"id"`
		Account struct {
			Email    string `json:"email"`
			Valid    bool   `json:"is_email_valid"`
			Verified bool   `json:"is_email_verified"`
			Profile  struct {
				Nickname string `json:"nickname"`
			} `json:"profile"`
		} `json:"kakao_account"`
	}
	if err := s.kakaoJSON(req, &me); err != nil {
		return kakaoProfile{}, fmt.Errorf("user: %w", err)
	}
	if me.ID == 0 {
		return kakaoProfile{}, errors.New("user: no id")
	}
	p := kakaoProfile{Subject: strconv.FormatInt(me.ID, 10), Nickname: me.Account.Profile.Nickname}
	if me.Account.Valid && me.Account.Verified {
		p.Email = strings.ToLower(strings.TrimSpace(me.Account.Email))
	}
	if len([]rune(p.Nickname)) > 60 {
		p.Nickname = string([]rune(p.Nickname)[:60])
	}
	return p, nil
}

func (s *Server) kakaoJSON(req *http.Request, v any) error {
	res, err := s.cfg.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("status %d", res.StatusCode)
	}
	return json.NewDecoder(http.MaxBytesReader(nil, res.Body, 1<<20)).Decode(v)
}

// 이미 연결된 카카오 계정이면 그 사용자, 아니면 새 사용자.
// 같은 이메일의 기존 계정에 자동으로 붙이지 않는다: 비밀번호 가입은 이메일을 확인하지 않아서, 남의 이메일로 먼저 가입해 둔
// 사람이 나중에 그 주인이 카카오로 들어올 때 그 계정을 넘겨받을 수 있다. 이메일이 이미 쓰이고 있으면 새 사용자는 이메일 없이 만든다.
func (s *Server) findOrCreateKakaoUser(ctx context.Context, p kakaoProfile) (authUser, error) {
	return s.findOrCreateOAuthUser(ctx, "kakao", p)
}

func (s *Server) findOrCreateOAuthUser(ctx context.Context, provider string, p kakaoProfile) (authUser, error) {
	var u authUser
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		// Serialize identical identities and email claims without linking accounts by email.
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, provider+":"+p.Subject); err != nil {
			return err
		}
		if provider == "kakao" {
			var pending bool
			if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM kakao_unlink_jobs WHERE subject=$1)`, p.Subject).Scan(&pending); err != nil {
				return err
			}
			if pending {
				return errors.New("kakao_deletion_pending")
			}
		}
		if p.Email != "" {
			if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 1))`, p.Email); err != nil {
				return err
			}
		}
		err := tx.QueryRow(ctx, `
			SELECT u.id, COALESCE(u.email, ''), u.name FROM oauth_identities i JOIN users u ON u.id = i.user_id
			WHERE i.provider = $1 AND i.subject = $2`, provider, p.Subject).Scan(&u.ID, &u.Email, &u.Name)
		if err == nil || !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		u = authUser{ID: uuid.New(), Name: p.Nickname}
		if _, err := tx.Exec(ctx, `
			INSERT INTO users (id, email, name)
			VALUES ($1, CASE WHEN $2 <> '' AND NOT EXISTS (SELECT 1 FROM users WHERE email = $2) THEN $2 END, $3)`,
			u.ID, p.Email, u.Name); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `SELECT COALESCE(email, '') FROM users WHERE id = $1`, u.ID).Scan(&u.Email); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO oauth_identities (provider, subject, user_id) VALUES ($1, $2, $3)`, provider, p.Subject, u.ID)
		return err
	})
	return u, err
}

// 외부 로그인으로 받은 일회용 코드를 세션 토큰으로 바꾼다.
func (s *Server) exchange(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Code     string `json:"code"`
		Verifier string `json:"code_verifier"`
		Device   string `json:"device"`
	}
	if !decode(w, r, &b) {
		return
	}
	if !s.limiter.allow("exchange:" + s.clientIP(r)) {
		errJSON(w, http.StatusTooManyRequests, "rate_limited", "잠시 후 다시 시도해 주세요")
		return
	}
	var user uuid.UUID
	var challenge string
	err := s.db.QueryRow(r.Context(), `
		DELETE FROM login_codes WHERE code_hash = $1 AND expires_at > now() RETURNING user_id, challenge`,
		hashOf(b.Code)).Scan(&user, &challenge)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		serverError(w, err)
		return
	}
	sum := sha256.Sum256([]byte(b.Verifier))
	want := base64.RawURLEncoding.EncodeToString(sum[:])
	if err != nil || subtle.ConstantTimeCompare([]byte(want), []byte(challenge)) != 1 {
		errJSON(w, http.StatusUnauthorized, "code_invalid", "로그인 코드가 만료됐거나 잘못됐습니다")
		return
	}
	u := authUser{ID: user}
	if err := s.db.QueryRow(r.Context(), `SELECT COALESCE(email, ''), name FROM users WHERE id = $1`, user).Scan(&u.Email, &u.Name); err != nil {
		serverError(w, err)
		return
	}
	if n := []rune(b.Device); len(n) > 60 {
		b.Device = string(n[:60])
	}
	s.issueSession(w, r, u, b.Device, http.StatusOK)
}
