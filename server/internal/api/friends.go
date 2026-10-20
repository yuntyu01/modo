package api

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// 친구: 이메일로 요청 → 받은 사람이 수락하면 친구. 친구 관계는 아무것도 보여 주지 않는다(폴더는 공유한 것만 보인다).
// 폴더 공유 권한(folder_members)과는 따로 관리한다: 친구를 끊어도 공유는 그대로이고, 공유를 끊어도 친구는 그대로다.

// 하루에 보낼 수 있는 친구 요청 수(가입한 이메일을 하나씩 알아보는 데 쓰이지 않게)
const friendRequestsPerDay = 50

type friendFolder struct {
	FolderID uuid.UUID `json:"folder_id"`
	Role     string    `json:"role"`
	// true면 내 폴더를 친구에게 공유한 것, false면 친구가 내게 공유한 폴더
	Mine bool `json:"mine"`
}

type friend struct {
	person
	Since   time.Time      `json:"since"`
	Folders []friendFolder `json:"folders"`
}

type friendRequest struct {
	ID        uuid.UUID `json:"id"`
	User      person    `json:"user"`
	CreatedAt time.Time `json:"created_at"`
}

// 친구 쌍은 작은 id를 a에 둔 한 줄로 저장한다
func friendPair(x, y uuid.UUID) (uuid.UUID, uuid.UUID) {
	if strings.Compare(x.String(), y.String()) < 0 {
		return x, y
	}
	return y, x
}

func (s *Server) listFriends(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	ctx := r.Context()
	out := struct {
		Friends  []friend        `json:"friends"`
		Incoming []friendRequest `json:"incoming"`
		Outgoing []friendRequest `json:"outgoing"`
	}{Friends: []friend{}, Incoming: []friendRequest{}, Outgoing: []friendRequest{}}

	rows, err := s.db.Query(ctx, `
		SELECT o.id, COALESCE(o.email, ''), o.name, f.created_at FROM friendships f
		JOIN users o ON o.id = CASE WHEN f.a = $1 THEN f.b ELSE f.a END
		WHERE f.a = $1 OR f.b = $1 ORDER BY f.created_at, o.id`, u.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	index := map[uuid.UUID]int{}
	ids := []uuid.UUID{}
	for rows.Next() {
		f := friend{Folders: []friendFolder{}}
		if err := rows.Scan(&f.ID, &f.Email, &f.Name, &f.Since); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		index[f.ID] = len(out.Friends)
		ids = append(ids, f.ID)
		out.Friends = append(out.Friends, f)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}

	// 친구와 함께 쓰는 폴더: 친구가 내게 공유한 폴더 + 내가 친구에게 공유한 폴더(권한은 그 공유의 것)
	if len(ids) > 0 {
		rows, err = s.db.Query(ctx, `
			SELECT f.owner_id, m.folder_id, m.role, false FROM folder_members m JOIN folders f ON f.id = m.folder_id
			WHERE m.user_id = $1 AND f.owner_id = ANY($2) AND f.deleted_at IS NULL
			UNION ALL
			SELECT m.user_id, m.folder_id, m.role, true FROM folder_members m JOIN folders f ON f.id = m.folder_id
			WHERE f.owner_id = $1 AND m.user_id = ANY($2) AND f.deleted_at IS NULL
			ORDER BY 2`, u.ID, ids)
		if err != nil {
			serverError(w, err)
			return
		}
		for rows.Next() {
			var who uuid.UUID
			var ff friendFolder
			if err := rows.Scan(&who, &ff.FolderID, &ff.Role, &ff.Mine); err != nil {
				rows.Close()
				serverError(w, err)
				return
			}
			if i, ok := index[who]; ok {
				out.Friends[i].Folders = append(out.Friends[i].Folders, ff)
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			serverError(w, err)
			return
		}
	}

	for _, q := range []struct {
		dst *[]friendRequest
		sql string
	}{
		{&out.Incoming, `SELECT r.id, o.id, COALESCE(o.email, ''), o.name, r.created_at FROM friend_requests r JOIN users o ON o.id = r.from_id WHERE r.to_id = $1 ORDER BY r.created_at`},
		{&out.Outgoing, `SELECT r.id, o.id, COALESCE(o.email, ''), o.name, r.created_at FROM friend_requests r JOIN users o ON o.id = r.to_id WHERE r.from_id = $1 ORDER BY r.created_at`},
	} {
		rows, err := s.db.Query(ctx, q.sql, u.ID)
		if err != nil {
			serverError(w, err)
			return
		}
		for rows.Next() {
			var fr friendRequest
			if err := rows.Scan(&fr.ID, &fr.User.ID, &fr.User.Email, &fr.User.Name, &fr.CreatedAt); err != nil {
				rows.Close()
				serverError(w, err)
				return
			}
			*q.dst = append(*q.dst, fr)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			serverError(w, err)
			return
		}
	}
	writeJSON(w, http.StatusOK, out)
}

// 친구 요청 보내기(이메일). 상대가 이미 내게 요청했으면 바로 친구가 된다.
func (s *Server) requestFriend(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	ctx := r.Context()
	var b struct {
		Email string `json:"email"`
	}
	if !decode(w, r, &b) {
		return
	}
	email := strings.ToLower(strings.TrimSpace(b.Email))
	if email == "" {
		badRequest(w, "이메일이 비었습니다")
		return
	}
	if !s.limiter.allow("friend:" + u.ID.String()) {
		errJSON(w, http.StatusTooManyRequests, "rate_limited", "잠시 후 다시 시도해 주세요")
		return
	}
	var sent int
	if err := s.db.QueryRow(ctx, `SELECT count(*) FROM friend_requests WHERE from_id = $1 AND created_at > now() - interval '1 day'`, u.ID).Scan(&sent); err != nil {
		serverError(w, err)
		return
	}
	if sent >= friendRequestsPerDay {
		errJSON(w, http.StatusTooManyRequests, "rate_limited", "오늘은 친구 요청을 더 보낼 수 없습니다")
		return
	}
	var to person
	err := s.db.QueryRow(ctx, `SELECT id, COALESCE(email, ''), name FROM users WHERE email = $1`, email).Scan(&to.ID, &to.Email, &to.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		errJSON(w, http.StatusNotFound, "user_not_found", "그 이메일로 가입한 사용자가 없습니다")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if to.ID == u.ID {
		errJSON(w, http.StatusBadRequest, "self_friend", "자기 자신에게는 친구 요청을 보낼 수 없습니다")
		return
	}

	status, code := "", 0
	var req friendRequest
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		a, bb := friendPair(u.ID, to.ID)
		var exists bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM friendships WHERE a = $1 AND b = $2)`, a, bb).Scan(&exists); err != nil {
			return err
		}
		if exists {
			status, code = "already_friends", http.StatusConflict
			return nil
		}
		// 상대가 먼저 보낸 요청이 있으면 수락한 것으로 본다
		tag, err := tx.Exec(ctx, `DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2`, to.ID, u.ID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() > 0 {
			if _, err := tx.Exec(ctx, `INSERT INTO friendships (a, b) VALUES ($1, $2) ON CONFLICT DO NOTHING`, a, bb); err != nil {
				return err
			}
			status, code = "accepted", http.StatusOK
			return nil
		}
		// 같은 사람에게 다시 보내면 처음 요청을 그대로 돌려준다
		err = tx.QueryRow(ctx, `
			INSERT INTO friend_requests (id, from_id, to_id) VALUES ($1, $2, $3)
			ON CONFLICT (from_id, to_id) DO UPDATE SET from_id = excluded.from_id
			RETURNING id, created_at`, uuid.New(), u.ID, to.ID).Scan(&req.ID, &req.CreatedAt)
		if err != nil {
			return err
		}
		req.User = to
		status, code = "requested", http.StatusCreated
		return nil
	})
	if err != nil {
		serverError(w, err)
		return
	}
	if status == "already_friends" {
		errJSON(w, code, "already_friends", "이미 친구입니다")
		return
	}
	resp := map[string]any{"status": status}
	if status == "accepted" {
		resp["friend"] = to
	} else {
		resp["request"] = req
	}
	writeJSON(w, code, resp)
}

// 받은 요청 수락
func (s *Server) acceptFriend(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		badRequest(w, "id가 잘못됐습니다")
		return
	}
	var from person
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		if err := tx.QueryRow(ctx, `DELETE FROM friend_requests WHERE id = $1 AND to_id = $2 RETURNING from_id`, id, u.ID).Scan(&from.ID); err != nil {
			return err
		}
		a, b := friendPair(u.ID, from.ID)
		if _, err := tx.Exec(ctx, `INSERT INTO friendships (a, b) VALUES ($1, $2) ON CONFLICT DO NOTHING`, a, b); err != nil {
			return err
		}
		// 내가 그 사람에게 보낸 요청도 함께 정리한다
		if _, err := tx.Exec(ctx, `DELETE FROM friend_requests WHERE from_id = $1 AND to_id = $2`, u.ID, from.ID); err != nil {
			return err
		}
		return tx.QueryRow(ctx, `SELECT COALESCE(email, ''), name FROM users WHERE id = $1`, from.ID).Scan(&from.Email, &from.Name)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		errJSON(w, http.StatusNotFound, "request_not_found", "친구 요청을 찾을 수 없습니다")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "accepted", "friend": from})
}

// 받은 요청 거절 또는 보낸 요청 취소. 상대에게 알리지 않는다.
func (s *Server) deleteFriendRequest(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		badRequest(w, "id가 잘못됐습니다")
		return
	}
	tag, err := s.db.Exec(r.Context(), `DELETE FROM friend_requests WHERE id = $1 AND (to_id = $2 OR from_id = $2)`, id, u.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		errJSON(w, http.StatusNotFound, "request_not_found", "친구 요청을 찾을 수 없습니다")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// 친구 끊기. 폴더 공유는 그대로 둔다(공유는 폴더 주인이 폴더 공유에서 끊는다).
func (s *Server) removeFriend(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	other, err := uuid.Parse(r.PathValue("user"))
	if err != nil {
		badRequest(w, "user가 잘못됐습니다")
		return
	}
	a, b := friendPair(u.ID, other)
	tag, err := s.db.Exec(r.Context(), `DELETE FROM friendships WHERE a = $1 AND b = $2`, a, b)
	if err != nil {
		serverError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		errJSON(w, http.StatusNotFound, "friend_not_found", "친구가 아닙니다")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
