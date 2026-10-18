package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// Signature is the app's primary admin key, not an untrusted user id in the URL.
func (s *Server) kakaoUnlinkWebhook(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	expected := "KakaoAK " + s.cfg.KakaoAdmin
	if s.cfg.KakaoAdmin == "" || s.cfg.KakaoAppID == "" || s.cfg.Erasures == nil ||
		subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte(expected)) != 1 {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 8192)
	if r.ParseForm() != nil || r.Form.Get("app_id") != s.cfg.KakaoAppID {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	subject := r.Form.Get("user_id")
	if _, err := strconv.ParseUint(subject, 10, 64); err != nil || subject == "0" {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	var account string
	err := s.db.QueryRow(r.Context(), `SELECT user_id FROM oauth_identities WHERE provider='kakao' AND subject=$1`, subject).Scan(&account)
	if err != nil {
		// Unknown/already removed subjects are idempotent; DB failures must retry.
		if !errors.Is(err, pgx.ErrNoRows) {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		return
	}
	if s.cfg.Erasures.Request(account, time.Now()) != nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusOK) // Persisted intent blocks all sessions before responding.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if s.ApplyErasures(ctx) != nil {
			log.Print("kakao_webhook_erasure_retry_pending")
		}
	}()
}

func (s *Server) eraseAccount(ctx context.Context, id string, enqueue bool) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if enqueue {
		_, err = tx.Exec(ctx, `INSERT INTO kakao_unlink_jobs(subject,account_id)
            SELECT subject,user_id FROM oauth_identities WHERE provider='kakao' AND user_id=$1
            ON CONFLICT(subject) DO NOTHING`, id)
		if err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `DELETE FROM users WHERE id=$1`, id); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *Server) retryKakaoUnlinks(ctx context.Context) error {
	// Do not retain provider identifiers indefinitely after local deletion.
	var expired int
	if err := s.db.QueryRow(ctx, `WITH removed AS (DELETE FROM kakao_unlink_jobs WHERE requested_at<=now()-interval '6 days 23 hours' RETURNING 1) SELECT count(*) FROM removed`).Scan(&expired); err != nil {
		return err
	}
	if expired > 0 {
		log.Print("kakao_unlink_deadline_exceeded")
	}
	if s.cfg.KakaoAdmin == "" {
		return nil
	}
	rows, err := s.db.Query(ctx, `UPDATE kakao_unlink_jobs SET attempts=attempts+1,last_attempt_at=now()
        WHERE subject IN (SELECT subject FROM kakao_unlink_jobs WHERE last_attempt_at IS NULL OR last_attempt_at<now()-interval '5 minutes' ORDER BY requested_at LIMIT 50)
        RETURNING subject,account_id::text`)
	if err != nil {
		return err
	}
	type job struct{ subject, account string }
	var jobs []job
	for rows.Next() {
		var j job
		if err := rows.Scan(&j.subject, &j.account); err != nil {
			rows.Close()
			return err
		}
		jobs = append(jobs, j)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, j := range jobs {
		var other bool
		if err := s.db.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM oauth_identities WHERE provider='kakao' AND subject=$1 AND user_id<>$2)`, j.subject, j.account).Scan(&other); err != nil {
			return err
		}
		// A restored old deletion must not revoke a newly linked account.
		if !other && s.unlinkKakao(ctx, j.subject) != nil {
			log.Print("kakao_unlink_retry_pending")
			continue
		}
		if _, err := s.db.Exec(ctx, `DELETE FROM kakao_unlink_jobs WHERE subject=$1 AND account_id=$2`, j.subject, j.account); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) unlinkKakao(ctx context.Context, subject string) error {
	requestCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	form := url.Values{"target_id_type": {"user_id"}, "target_id": {subject}}
	req, err := http.NewRequestWithContext(requestCtx, http.MethodPost, s.cfg.KakaoAPIURL+"/v1/user/unlink", strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "KakaoAK "+s.cfg.KakaoAdmin)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := s.cfg.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode == 200 {
		return nil
	}
	var body struct {
		Code int `json:"code"`
	}
	_ = json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&body)
	if response.StatusCode == 400 && body.Code == -101 {
		return nil
	} // Already unlinked.
	return errors.New("kakao_unlink_failed")
}
