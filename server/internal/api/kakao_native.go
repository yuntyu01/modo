package api

import (
	"net/http"
	"strconv"
	"strings"
)

// The official Android SDK authenticates through Talk. Never trust a client-supplied
// Kakao user ID: validate token issuer app, expiry and subject with Kakao first.
// The provider credential is neither stored nor logged. Only a short-lived,
// PKCE-bound one-time code is returned, as in the existing browser flow.
func (s *Server) kakaoNative(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !s.kakaoEnabled() {
		errJSON(w, http.StatusNotFound, "kakao_disabled", "카카오 로그인을 사용할 수 없습니다")
		return
	}
	if !s.limiter.allow("oauth:" + s.clientIP(r)) {
		errJSON(w, http.StatusTooManyRequests, "rate_limited", "잠시 후 다시 시도해 주세요")
		return
	}
	var body struct {
		AccessToken string `json:"access_token"`
		Challenge   string `json:"code_challenge"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if !decode(w, r, &body) {
		return
	}
	if body.AccessToken == "" || len(body.AccessToken) > 2048 || strings.ContainsAny(body.AccessToken, " \r\n\t") || !challengeRe.MatchString(body.Challenge) {
		badRequest(w, "로그인 요청이 잘못됐습니다")
		return
	}
	req, _ := http.NewRequestWithContext(r.Context(), http.MethodGet, s.cfg.KakaoAPIURL+"/v1/user/access_token_info", nil)
	req.Header.Set("Authorization", "Bearer "+body.AccessToken)
	var info struct {
		ID        int64 `json:"id"`
		AppID     int64 `json:"app_id"`
		ExpiresIn int64 `json:"expires_in"`
	}
	if s.kakaoJSON(req, &info) != nil || info.ID <= 0 || info.ExpiresIn <= 0 || strconv.FormatInt(info.AppID, 10) != s.cfg.KakaoAppID {
		errJSON(w, http.StatusUnauthorized, "kakao_failed", "카카오 로그인을 다시 시도해 주세요")
		return
	}
	profile, err := s.kakaoUserWithToken(r.Context(), body.AccessToken)
	if err != nil || profile.Subject != strconv.FormatInt(info.ID, 10) {
		errJSON(w, http.StatusUnauthorized, "kakao_failed", "카카오 로그인을 다시 시도해 주세요")
		return
	}
	user, err := s.findOrCreateKakaoUser(r.Context(), profile)
	if err != nil {
		serverError(w, err)
		return
	}
	code, sum := randomToken()
	if _, err := s.db.Exec(r.Context(), `INSERT INTO login_codes (code_hash, user_id, challenge, expires_at) VALUES ($1, $2, $3, now() + interval '2 minutes')`, sum, user.ID, body.Challenge); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"code": code})
}
