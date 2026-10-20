package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// 친구: 이메일로 찾아 요청 → 받은 사람이 수락하면 친구. 친구 관계는 아무것도 보여 주지 않는다(폴더는 명시적으로 공유한 것만 보인다).
// 폴더 공유 권한(folder_members)과는 따로 관리한다: 친구를 끊어도 공유는 그대로이고, 공유를 끊어도 친구는 그대로다.
// 요청은 상태(pending/accepted/declined/cancelled)와 처리 시각을 남긴다. 한 쌍에 대기 중인 요청은 방향과 상관없이 하나(DB 제약).

// 하루에 보낼 수 있는 친구 요청 수(가입한 이메일을 하나씩 알아보는 데 쓰이지 않게). 1분 제한은 limiter
const friendRequestsPerDay = 50

type friendFolder struct {
	FolderID uuid.UUID `json:"folder_id"`
	// 내 권한(owner | edit | view)과 친구의 권한. 셋째 사람의 폴더면 둘 다 참여자 권한
	Role       string `json:"role"`
	FriendRole string `json:"friend_role"`
	// 내 폴더인지(Role == owner)
	Mine bool `json:"mine"`
	// 내 홈에 보이는지(내 폴더는 늘 true, 참여 중인 폴더는 내 설정)
	Home bool `json:"home"`
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

type friendsPayload struct {
	Friends  []friend        `json:"friends"`
	Incoming []friendRequest `json:"incoming"`
	Outgoing []friendRequest `json:"outgoing"`
}

type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// 친구 쌍은 작은 id를 a에 둔 한 줄로 저장한다
func friendPair(x, y uuid.UUID) (uuid.UUID, uuid.UUID) {
	if strings.Compare(x.String(), y.String()) < 0 {
		return x, y
	}
	return y, x
}

// 친구·친구별 함께 쓰는 폴더·대기 중인 요청. GET /api/friends와 pull이 같이 쓴다.
// 폴더는 내가 지금 접근할 수 있는 것만(내 폴더 + 내가 참여 중인 폴더) 중에서 그 친구도 소유·참여 중인 것이다.
func friendsOf(ctx context.Context, q querier, me uuid.UUID) (friendsPayload, error) {
	out := friendsPayload{Friends: []friend{}, Incoming: []friendRequest{}, Outgoing: []friendRequest{}}
	rows, err := q.Query(ctx, `
		SELECT o.id, COALESCE(o.email, ''), o.name, f.created_at FROM friendships f
		JOIN users o ON o.id = CASE WHEN f.a = $1 THEN f.b ELSE f.a END
		WHERE f.a = $1 OR f.b = $1 ORDER BY f.created_at, o.id`, me)
	if err != nil {
		return out, err
	}
	index := map[uuid.UUID]int{}
	ids := []uuid.UUID{}
	for rows.Next() {
		f := friend{Folders: []friendFolder{}}
		if err := rows.Scan(&f.ID, &f.Email, &f.Name, &f.Since); err != nil {
			rows.Close()
			return out, err
		}
		index[f.ID] = len(out.Friends)
		ids = append(ids, f.ID)
		out.Friends = append(out.Friends, f)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}

	if len(ids) > 0 {
		rows, err = q.Query(ctx, `
			-- 친구가 내게 공유한 폴더
			SELECT f.owner_id, m.folder_id, m.role, 'owner', m.home FROM folder_members m JOIN folders f ON f.id = m.folder_id
			WHERE m.user_id = $1 AND f.owner_id = ANY($2) AND f.deleted_at IS NULL
			UNION ALL
			-- 내가 친구에게 공유한 폴더
			SELECT m.user_id, m.folder_id, 'owner', m.role, true FROM folder_members m JOIN folders f ON f.id = m.folder_id
			WHERE f.owner_id = $1 AND m.user_id = ANY($2) AND f.deleted_at IS NULL
			UNION ALL
			-- 다른 사람의 폴더에 나와 친구가 함께 참여 중
			SELECT o.user_id, mine.folder_id, mine.role, o.role, mine.home FROM folder_members mine
			JOIN folder_members o ON o.folder_id = mine.folder_id AND o.user_id = ANY($2)
			JOIN folders f ON f.id = mine.folder_id
			WHERE mine.user_id = $1 AND f.owner_id <> o.user_id AND f.deleted_at IS NULL
			ORDER BY 2`, me, ids)
		if err != nil {
			return out, err
		}
		for rows.Next() {
			var who uuid.UUID
			var ff friendFolder
			if err := rows.Scan(&who, &ff.FolderID, &ff.Role, &ff.FriendRole, &ff.Home); err != nil {
				rows.Close()
				return out, err
			}
			ff.Mine = ff.Role == "owner"
			if i, ok := index[who]; ok {
				out.Friends[i].Folders = append(out.Friends[i].Folders, ff)
			}
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return out, err
		}
	}

	for _, r := range []struct {
		dst *[]friendRequest
		sql string
	}{
		{&out.Incoming, `SELECT r.id, o.id, COALESCE(o.email, ''), o.name, r.created_at FROM friend_requests r JOIN users o ON o.id = r.from_id WHERE r.to_id = $1 AND r.status = 'pending' ORDER BY r.created_at, r.id`},
		{&out.Outgoing, `SELECT r.id, o.id, COALESCE(o.email, ''), o.name, r.created_at FROM friend_requests r JOIN users o ON o.id = r.to_id WHERE r.from_id = $1 AND r.status = 'pending' ORDER BY r.created_at, r.id`},
	} {
		rows, err := q.Query(ctx, r.sql, me)
		if err != nil {
			return out, err
		}
		for rows.Next() {
			var fr friendRequest
			if err := rows.Scan(&fr.ID, &fr.User.ID, &fr.User.Email, &fr.User.Name, &fr.CreatedAt); err != nil {
				rows.Close()
				return out, err
			}
			*r.dst = append(*r.dst, fr)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return out, err
		}
	}
	return out, nil
}

// pull이 바뀐 게 없으면 친구 목록을 빼고 보낼 수 있게 하는 요약
func friendsDigest(p friendsPayload) string {
	b, _ := json.Marshal(p)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:12])
}

func (s *Server) listFriends(w http.ResponseWriter, r *http.Request) {
	out, err := friendsOf(r.Context(), s.db, userFrom(r.Context()).ID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, out)
}

// 이메일로 한 사람 찾기: 정확히 같은 이메일(가입 때와 같은 정규화)만, 이름·이메일과 지금 관계만 돌려준다.
// 일부만 맞는 이메일로 목록을 훑는 기능은 두지 않는다.
func (s *Server) searchFriend(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	ctx := r.Context()
	if !s.limiter.allow("friend-search:" + u.ID.String()) {
		errJSON(w, http.StatusTooManyRequests, "rate_limited", "잠시 후 다시 시도해 주세요")
		return
	}
	email := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("email")))
	if email == "" {
		badRequest(w, "이메일이 비었습니다")
		return
	}
	var p person
	err := s.db.QueryRow(ctx, `SELECT id, COALESCE(email, ''), name FROM users WHERE email = $1`, email).Scan(&p.ID, &p.Email, &p.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		errJSON(w, http.StatusNotFound, "user_not_found", "그 이메일로 가입한 사용자가 없습니다")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if p.ID == u.ID {
		errJSON(w, http.StatusBadRequest, "self_friend", "자기 자신에게는 친구 요청을 보낼 수 없습니다")
		return
	}
	status, reqID, err := s.relation(ctx, u.ID, p.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	resp := map[string]any{"user": p, "status": status}
	if reqID != uuid.Nil {
		resp["request_id"] = reqID
	}
	writeJSON(w, http.StatusOK, resp)
}

// 두 사람의 지금 관계: friend | outgoing(내가 보낸 요청 대기) | incoming(받은 요청 대기) | none
func (s *Server) relation(ctx context.Context, me, other uuid.UUID) (string, uuid.UUID, error) {
	a, b := friendPair(me, other)
	var friends bool
	if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM friendships WHERE a = $1 AND b = $2)`, a, b).Scan(&friends); err != nil {
		return "", uuid.Nil, err
	}
	if friends {
		return "friend", uuid.Nil, nil
	}
	var id, from uuid.UUID
	err := s.db.QueryRow(ctx, `
		SELECT id, from_id FROM friend_requests
		WHERE status = 'pending' AND ((from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1))`, me, other).Scan(&id, &from)
	if errors.Is(err, pgx.ErrNoRows) {
		return "none", uuid.Nil, nil
	}
	if err != nil {
		return "", uuid.Nil, err
	}
	if from == me {
		return "outgoing", id, nil
	}
	return "incoming", id, nil
}

// 친구 요청 보내기(검색 결과에서 '요청 보내기'를 눌렀을 때). 상대가 이미 내게 요청했으면 만들지 않고 그 요청을 수락하라고 알린다.
func (s *Server) requestFriend(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	ctx := r.Context()
	var b struct {
		Email  string `json:"email"`
		UserID string `json:"user_id"`
	}
	if !decode(w, r, &b) {
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
	// 받는 사람은 이메일로 찾는다(검색과 같은 규칙). 검색 결과의 id를 보내도 그 이메일과 같은 사람이어야 한다
	email := strings.ToLower(strings.TrimSpace(b.Email))
	if email == "" {
		badRequest(w, "이메일이 비었습니다")
		return
	}
	var to person
	err := s.db.QueryRow(ctx, `SELECT id, COALESCE(email, ''), name FROM users WHERE email = $1`, email).Scan(&to.ID, &to.Email, &to.Name)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && b.UserID != "" && b.UserID != to.ID.String()) {
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
	status, reqID, err := s.relation(ctx, u.ID, to.ID)
	if err != nil {
		serverError(w, err)
		return
	}
	switch status {
	case "friend":
		errJSON(w, http.StatusConflict, "already_friends", "이미 친구입니다")
		return
	case "incoming":
		writeJSON(w, http.StatusConflict, map[string]any{"code": "request_incoming", "error": "이미 받은 요청이 있습니다. 받은 요청을 수락해 주세요", "request_id": reqID})
		return
	case "outgoing":
		// 이미 보낸 요청: 새로 만들지 않고 그 요청을 돌려준다(재전송·두 번 누르기)
		writeJSON(w, http.StatusOK, map[string]any{"status": "requested", "request": friendRequest{ID: reqID, User: to, CreatedAt: time.Now()}})
		return
	}
	req := friendRequest{ID: uuid.New(), User: to}
	err = s.db.QueryRow(ctx, `INSERT INTO friend_requests (id, from_id, to_id) VALUES ($1, $2, $3) RETURNING created_at`, req.ID, u.ID, to.ID).Scan(&req.CreatedAt)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		// 방금 상대도(또는 다른 기기에서 내가) 요청했다: 다시 보고 같은 규칙으로 답한다
		status, reqID, err = s.relation(ctx, u.ID, to.ID)
		if err == nil && status == "incoming" {
			writeJSON(w, http.StatusConflict, map[string]any{"code": "request_incoming", "error": "이미 받은 요청이 있습니다. 받은 요청을 수락해 주세요", "request_id": reqID})
			return
		}
		if err == nil && status == "outgoing" {
			writeJSON(w, http.StatusOK, map[string]any{"status": "requested", "request": friendRequest{ID: reqID, User: to, CreatedAt: time.Now()}})
			return
		}
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"status": "requested", "request": req})
}

// 받은 요청 수락(받은 사람만). 수락과 친구 관계 만들기는 한 트랜잭션. 이미 수락한 요청을 다시 수락해도 같은 결과(다른 기기·두 번 누르기)
func (s *Server) acceptFriend(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		badRequest(w, "id가 잘못됐습니다")
		return
	}
	var from person
	closed := false
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `
			UPDATE friend_requests SET status = 'accepted', responded_at = now()
			WHERE id = $1 AND to_id = $2 AND status = 'pending' RETURNING from_id`, id, u.ID).Scan(&from.ID)
		if errors.Is(err, pgx.ErrNoRows) {
			// 이미 처리된 요청: 수락이었으면 같은 답(다른 기기·두 번 누르기). 그 뒤 친구를 끊었어도 되살리지 않는다.
			// 거절·취소된 요청이면 닫힌 요청
			var status string
			if err := tx.QueryRow(ctx, `SELECT status, from_id FROM friend_requests WHERE id = $1 AND to_id = $2`, id, u.ID).Scan(&status, &from.ID); err != nil {
				return err
			}
			if status != "accepted" {
				closed = true
				return nil
			}
		} else if err != nil {
			return err
		} else {
			a, b := friendPair(u.ID, from.ID)
			if _, err := tx.Exec(ctx, `INSERT INTO friendships (a, b) VALUES ($1, $2) ON CONFLICT DO NOTHING`, a, b); err != nil {
				return err
			}
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
	if closed {
		errJSON(w, http.StatusConflict, "request_closed", "이미 처리된 요청입니다")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "accepted", "friend": from})
}

// 받은 요청 거절(받은 사람만). 보낸 사람에게 알리지 않는다
func (s *Server) declineFriend(w http.ResponseWriter, r *http.Request) {
	s.closeRequest(w, r, "to_id", "declined")
}

// 보낸 요청 취소(보낸 사람만)
func (s *Server) cancelFriendRequest(w http.ResponseWriter, r *http.Request) {
	s.closeRequest(w, r, "from_id", "cancelled")
}

func (s *Server) closeRequest(w http.ResponseWriter, r *http.Request, who, status string) {
	u := userFrom(r.Context())
	ctx := r.Context()
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		badRequest(w, "id가 잘못됐습니다")
		return
	}
	tag, err := s.db.Exec(ctx, `UPDATE friend_requests SET status = $3, responded_at = now() WHERE id = $1 AND `+who+` = $2 AND status = 'pending'`, id, u.ID, status)
	if err != nil {
		serverError(w, err)
		return
	}
	if tag.RowsAffected() > 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	// 없는 요청인지, 상대(또는 다른 기기)가 이미 처리한 요청인지 구분해 알린다
	var cur string
	err = s.db.QueryRow(ctx, `SELECT status FROM friend_requests WHERE id = $1 AND `+who+` = $2`, id, u.ID).Scan(&cur)
	if errors.Is(err, pgx.ErrNoRows) {
		errJSON(w, http.StatusNotFound, "request_not_found", "친구 요청을 찾을 수 없습니다")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if cur == status {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	errJSON(w, http.StatusConflict, "request_closed", "이미 처리된 요청입니다")
}

// 친구 끊기. 폴더 공유는 그대로 둔다(공유는 폴더 주인이 공유 관리에서 끊거나, 참여자가 나간다).
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
