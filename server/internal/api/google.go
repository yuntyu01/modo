package api

import (
	"context"
	"crypto/subtle"
	"errors"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
	"golang.org/x/oauth2"
)

func (s *Server) googleEnabled() bool {
	return s.cfg.GoogleClientID != "" && s.cfg.GoogleSecret != "" && s.cfg.PublicURL != ""
}

func (s *Server) googleConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID: s.cfg.GoogleClientID, ClientSecret: s.cfg.GoogleSecret,
		RedirectURL: s.cfg.PublicURL + "/api/auth/google/callback",
		Scopes:      []string{"openid", "email", "profile"},
		Endpoint:    oauth2.Endpoint{AuthURL: s.cfg.GoogleAuthURL, TokenURL: s.cfg.GoogleTokenURL, AuthStyle: oauth2.AuthStyleInParams},
	}
}

func (s *Server) googleStart(w http.ResponseWriter, r *http.Request) {
	if !s.googleEnabled() {
		errJSON(w, http.StatusNotFound, "google_disabled", "Google login is not configured")
		return
	}
	q := r.URL.Query()
	redirect, clientState, challenge := q.Get("redirect_uri"), q.Get("state"), q.Get("code_challenge")
	if !allowedRedirect(redirect) || clientState == "" || len(clientState) > 200 || !challengeRe.MatchString(challenge) {
		badRequest(w, "Invalid redirect_uri/state/code_challenge")
		return
	}
	if !s.limiter.allow("oauth:" + s.clientIP(r)) {
		errJSON(w, http.StatusTooManyRequests, "rate_limited", "Please try again later")
		return
	}
	state, stateHash := randomToken()
	nonce, nonceHash := randomToken()
	verifier := oauth2.GenerateVerifier()
	_, err := s.db.Exec(r.Context(), `INSERT INTO oauth_states
		(state_hash, redirect_uri, client_state, challenge, provider, nonce_hash, upstream_verifier, expires_at)
		VALUES ($1,$2,$3,$4,'google',$5,$6,now()+interval '10 minutes')`, stateHash, redirect, clientState, challenge, nonceHash, verifier)
	if err != nil {
		serverError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	http.Redirect(w, r, s.googleConfig().AuthCodeURL(state, oauth2.S256ChallengeOption(verifier), oauth2.SetAuthURLParam("nonce", nonce)), http.StatusFound)
}

func (s *Server) googleCallback(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if !s.googleEnabled() {
		errJSON(w, http.StatusNotFound, "google_disabled", "Google login is not configured")
		return
	}
	var redirect, clientState, challenge, verifier string
	var nonceHash []byte
	err := s.db.QueryRow(r.Context(), `DELETE FROM oauth_states
		WHERE state_hash=$1 AND provider='google' AND expires_at>now()
		RETURNING redirect_uri,client_state,challenge,nonce_hash,upstream_verifier`, hashOf(r.URL.Query().Get("state"))).Scan(&redirect, &clientState, &challenge, &nonceHash, &verifier)
	if errors.Is(err, pgx.ErrNoRows) {
		badRequest(w, "Login expired. Please start again.")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	back := func(params url.Values) {
		params.Set("state", clientState)
		u, _ := url.Parse(redirect)
		u.RawQuery = params.Encode()
		http.Redirect(w, r, u.String(), http.StatusFound)
	}
	q := r.URL.Query()
	if q.Get("error") != "" {
		back(url.Values{"error": {"cancelled"}})
		return
	}
	p, err := s.googleUser(r.Context(), q.Get("code"), verifier, nonceHash)
	if err != nil {
		log.Print("google_exchange_failed")
		back(url.Values{"error": {"google"}})
		return
	}
	u, err := s.findOrCreateOAuthUser(r.Context(), "google", p)
	if err != nil {
		log.Print("google_user_lookup_failed")
		back(url.Values{"error": {"server"}})
		return
	}
	code, sum := randomToken()
	_, err = s.db.Exec(r.Context(), `INSERT INTO login_codes(code_hash,user_id,challenge,expires_at) VALUES($1,$2,$3,now()+interval '2 minutes')`, sum, u.ID, challenge)
	if err != nil {
		log.Print("google_login_code_failed")
		back(url.Values{"error": {"server"}})
		return
	}
	back(url.Values{"code": {code}})
}

func (s *Server) googleUser(ctx context.Context, code, verifier string, nonceHash []byte) (kakaoProfile, error) {
	if code == "" || len(code) > 4096 || len(nonceHash) != 32 || verifier == "" {
		return kakaoProfile{}, errors.New("invalid callback")
	}
	ctx = context.WithValue(ctx, oauth2.HTTPClient, s.cfg.HTTP)
	token, err := s.googleConfig().Exchange(ctx, code, oauth2.VerifierOption(verifier))
	if err != nil {
		return kakaoProfile{}, errors.New("token exchange failed")
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok || len(raw) > 32768 {
		return kakaoProfile{}, errors.New("missing ID token")
	}
	id, err := s.googleVerifier.Verify(ctx, raw)
	if err != nil {
		return kakaoProfile{}, errors.New("invalid ID token")
	}
	if subtle.ConstantTimeCompare(hashOf(id.Nonce), nonceHash) != 1 || id.Subject == "" || len(id.Subject) > 255 {
		return kakaoProfile{}, errors.New("invalid subject or nonce")
	}
	var claims struct {
		Email           string `json:"email"`
		Verified        bool   `json:"email_verified"`
		Name            string `json:"name"`
		AuthorizedParty string `json:"azp"`
	}
	if err := id.Claims(&claims); err != nil {
		return kakaoProfile{}, errors.New("invalid claims")
	}
	if (len(id.Audience) > 1 && claims.AuthorizedParty == "") || (claims.AuthorizedParty != "" && claims.AuthorizedParty != s.cfg.GoogleClientID) {
		return kakaoProfile{}, errors.New("invalid authorized party")
	}
	p := kakaoProfile{Subject: id.Subject, Nickname: strings.TrimSpace(claims.Name)}
	if claims.Verified && len(claims.Email) <= 254 {
		p.Email = strings.ToLower(strings.TrimSpace(claims.Email))
	}
	if len([]rune(p.Nickname)) > 60 {
		p.Nickname = string([]rune(p.Nickname)[:60])
	}
	return p, nil
}
