package api

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"html/template"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type member struct {
	UserID    uuid.UUID `json:"user_id"`
	Email     string    `json:"email"`
	Name      string    `json:"name"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

type link struct {
	Token     string    `json:"token"`
	Path      string    `json:"link_path"`
	CreatedAt time.Time `json:"created_at"`
}

// 폴더 소유자만 공유를 관리한다.
// 폴더 id 자리에 내 사용자 id가 오면 내 '전체'(폴더 없는 항목)다(base = true, 사용자 요청 2026-10-26).
func (s *Server) ownedFolder(w http.ResponseWriter, r *http.Request) (id uuid.UUID, base bool, ok bool) {
	u := userFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		badRequest(w, "id가 잘못됐습니다")
		return uuid.Nil, false, false
	}
	if id == u.ID {
		return id, true, true
	}
	var owner uuid.UUID
	err = s.db.QueryRow(r.Context(), `SELECT owner_id FROM folders WHERE id = $1 AND deleted_at IS NULL`, id).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		// 남의 '전체'를 공유받은 사람은 폴더 참여자처럼 공유를 바꿀 수 없다
		var member bool
		if err := s.db.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM base_members WHERE owner_id = $1 AND user_id = $2)`, id, u.ID).Scan(&member); err != nil {
			serverError(w, err)
			return uuid.Nil, false, false
		}
		if member {
			errJSON(w, http.StatusForbidden, "not_owner", "폴더 소유자만 공유를 바꿀 수 있습니다")
			return uuid.Nil, false, false
		}
		errJSON(w, http.StatusNotFound, "folder_not_synced", "폴더가 아직 서버에 없습니다. 동기화 후 다시 시도해 주세요")
		return uuid.Nil, false, false
	}
	if err != nil {
		serverError(w, err)
		return uuid.Nil, false, false
	}
	if owner != u.ID {
		errJSON(w, http.StatusForbidden, "not_owner", "폴더 소유자만 공유를 바꿀 수 있습니다")
		return uuid.Nil, false, false
	}
	return id, false, true
}

// 폴더의 참여자 보기: 소유자는 참여자·링크와 함께 바꿀 수 있고(can_manage), 참여자는 누가 함께 쓰는지만 본다(링크는 소유자만).
// '전체'(폴더 id = 주인 사용자 id)도 같은 모양으로 답한다. 링크는 없다.
func (s *Server) listShares(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	ctx := r.Context()
	folder, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		badRequest(w, "id가 잘못됐습니다")
		return
	}
	var owner person
	var myRole *string
	err = s.db.QueryRow(ctx, `
		SELECT o.id, COALESCE(o.email, ''), o.name, m.role FROM folders f JOIN users o ON o.id = f.owner_id
		LEFT JOIN folder_members m ON m.folder_id = f.id AND m.user_id = $2
		WHERE f.id = $1 AND f.deleted_at IS NULL`, folder, u.ID).Scan(&owner.ID, &owner.Email, &owner.Name, &myRole)
	base := false
	if errors.Is(err, pgx.ErrNoRows) {
		// 폴더가 아니면 '전체': 내 id면 내 전체, 남의 id면 내가 공유받은 그 사람의 전체(아니면 아래에서 404)
		base = true
		err = s.db.QueryRow(ctx, `
			SELECT o.id, COALESCE(o.email, ''), o.name, m.role FROM users o
			LEFT JOIN base_members m ON m.owner_id = o.id AND m.user_id = $2
			WHERE o.id = $1`, folder, u.ID).Scan(&owner.ID, &owner.Email, &owner.Name, &myRole)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		errJSON(w, http.StatusNotFound, "folder_not_synced", "폴더가 아직 서버에 없습니다. 동기화 후 다시 시도해 주세요")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	manage := owner.ID == u.ID
	if !manage && myRole == nil {
		// 접근할 수 없는 폴더는 있는지조차 알리지 않는다
		errJSON(w, http.StatusNotFound, "folder_not_synced", "폴더가 아직 서버에 없습니다. 동기화 후 다시 시도해 주세요")
		return
	}
	out := struct {
		Owner     person   `json:"owner"`
		CanManage bool     `json:"can_manage"`
		MyRole    string   `json:"my_role"`
		Members   []member `json:"members"`
		Links     []link   `json:"links"`
	}{Owner: owner, CanManage: manage, MyRole: "owner", Members: []member{}, Links: []link{}}
	if myRole != nil {
		out.MyRole = *myRole
	}
	membersSQL := `
		SELECT m.user_id, COALESCE(u.email, ''), u.name, m.role, m.created_at FROM folder_members m JOIN users u ON u.id = m.user_id
		WHERE m.folder_id = $1 ORDER BY m.created_at`
	if base {
		membersSQL = `
		SELECT m.user_id, COALESCE(u.email, ''), u.name, m.role, m.created_at FROM base_members m JOIN users u ON u.id = m.user_id
		WHERE m.owner_id = $1 ORDER BY m.created_at`
	}
	rows, err := s.db.Query(ctx, membersSQL, folder)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var m member
		rows.Scan(&m.UserID, &m.Email, &m.Name, &m.Role, &m.CreatedAt)
		out.Members = append(out.Members, m)
	}
	rows.Close()
	if !manage || base {
		writeJSON(w, http.StatusOK, out)
		return
	}
	rows, err = s.db.Query(ctx, `SELECT token, created_at FROM share_links WHERE folder_id = $1 ORDER BY created_at`, folder)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var l link
		rows.Scan(&l.Token, &l.CreatedAt)
		l.Path = "/s/" + l.Token
		out.Links = append(out.Links, l)
	}
	rows.Close()
	writeJSON(w, http.StatusOK, out)
}

func validRole(w http.ResponseWriter, role string) bool {
	if role != "view" && role != "edit" {
		badRequest(w, "권한은 view 또는 edit입니다")
		return false
	}
	return true
}

func (s *Server) addMember(w http.ResponseWriter, r *http.Request) {
	folder, base, ok := s.ownedFolder(w, r)
	if !ok {
		return
	}
	var b struct {
		Email string `json:"email"`
		// 친구에게는 사용자 id로도 공유한다(이메일이 없는 카카오 계정도). 친구가 아니면 id로는 찾지 않는다
		UserID string `json:"user_id"`
		Role   string `json:"role"`
	}
	if !decode(w, r, &b) || !validRole(w, b.Role) {
		return
	}
	var m member
	var err error
	if b.UserID != "" {
		other, perr := uuid.Parse(b.UserID)
		if perr != nil {
			badRequest(w, "user_id가 잘못됐습니다")
			return
		}
		a, bb := friendPair(userFrom(r.Context()).ID, other)
		err = s.db.QueryRow(r.Context(), `
			SELECT u.id, COALESCE(u.email, ''), u.name FROM friendships f JOIN users u ON u.id = $3
			WHERE f.a = $1 AND f.b = $2`, a, bb, other).Scan(&m.UserID, &m.Email, &m.Name)
	} else {
		err = s.db.QueryRow(r.Context(), `SELECT id, email, name FROM users WHERE email = $1`, strings.ToLower(strings.TrimSpace(b.Email))).Scan(&m.UserID, &m.Email, &m.Name)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		errJSON(w, http.StatusNotFound, "user_not_found", "그 이메일로 가입한 사용자가 없습니다")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if m.UserID == userFrom(r.Context()).ID {
		errJSON(w, http.StatusBadRequest, "self_invite", "자기 자신은 초대할 수 없습니다")
		return
	}
	// '전체'는 친구에게만(이메일로 와도 친구가 아니면 없는 사람처럼 답한다)
	if base && b.UserID == "" {
		a, bb := friendPair(userFrom(r.Context()).ID, m.UserID)
		var friends bool
		if err := s.db.QueryRow(r.Context(), `SELECT EXISTS (SELECT 1 FROM friendships WHERE a = $1 AND b = $2)`, a, bb).Scan(&friends); err != nil {
			serverError(w, err)
			return
		}
		if !friends {
			errJSON(w, http.StatusNotFound, "user_not_found", "그 이메일로 가입한 사용자가 없습니다")
			return
		}
	}
	m.Role, m.CreatedAt = b.Role, time.Now()
	err = s.withSeqWrite(r.Context(), func(tx pgx.Tx) error {
		if base {
			// 공유 행의 seq(기본값)가 가짜 폴더 행 '전체'의 순번이 된다. 항목보다 먼저 매겨져 폴더가 먼저 내려간다
			if _, err := tx.Exec(r.Context(), `INSERT INTO base_members (owner_id, user_id, role) VALUES ($1, $2, $3)`, folder, m.UserID, m.Role); err != nil {
				return err
			}
			return bumpBase(r.Context(), tx, folder)
		}
		if _, err := tx.Exec(r.Context(), `INSERT INTO folder_members (folder_id, user_id, role) VALUES ($1, $2, $3)`, folder, m.UserID, m.Role); err != nil {
			return err
		}
		return bumpFolder(r.Context(), tx, folder)
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		errJSON(w, http.StatusConflict, "already_shared", "이미 공유한 사용자입니다")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	// 받는 사람이 기다리던 바로 받기(/api/sync/wait)를 깨운다
	s.changes.bump()
	writeJSON(w, http.StatusCreated, m)
}

func (s *Server) updateMember(w http.ResponseWriter, r *http.Request) {
	folder, base, ok := s.ownedFolder(w, r)
	if !ok {
		return
	}
	user, err := uuid.Parse(r.PathValue("user"))
	if err != nil {
		badRequest(w, "user가 잘못됐습니다")
		return
	}
	var b struct {
		Role string `json:"role"`
	}
	if !decode(w, r, &b) || !validRole(w, b.Role) {
		return
	}
	err = s.withSeqWrite(r.Context(), func(tx pgx.Tx) error {
		if base {
			// 권한은 pull의 shared로 간다. 가짜 폴더 행의 순번만 새로 매겨 받는 사람의 바로 받기가 깨게 한다(항목은 이미 받았다)
			tag, err := tx.Exec(r.Context(), `UPDATE base_members SET role = $3, seq = nextval('change_seq') WHERE owner_id = $1 AND user_id = $2`, folder, user, b.Role)
			if err == nil && tag.RowsAffected() == 0 {
				err = pgx.ErrNoRows
			}
			return err
		}
		tag, err := tx.Exec(r.Context(), `UPDATE folder_members SET role = $3 WHERE folder_id = $1 AND user_id = $2`, folder, user, b.Role)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return bumpFolder(r.Context(), tx, folder)
	})
	if errors.Is(err, pgx.ErrNoRows) {
		errJSON(w, http.StatusNotFound, "share_not_found", "공유를 찾을 수 없습니다")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	s.changes.bump()
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) removeMember(w http.ResponseWriter, r *http.Request) {
	folder, base, ok := s.ownedFolder(w, r)
	if !ok {
		return
	}
	user, err := uuid.Parse(r.PathValue("user"))
	if err != nil {
		badRequest(w, "user가 잘못됐습니다")
		return
	}
	err = s.withSeqWrite(r.Context(), func(tx pgx.Tx) error {
		if base {
			// 빠진 사람은 다음 pull의 foreign_ids에서 이 항목들이 빠져 앱이 지운다. 남은 사람이 다시 받을 것은 없다
			_, err := tx.Exec(r.Context(), `DELETE FROM base_members WHERE owner_id = $1 AND user_id = $2`, folder, user)
			return err
		}
		if _, err := tx.Exec(r.Context(), `DELETE FROM folder_members WHERE folder_id = $1 AND user_id = $2`, folder, user); err != nil {
			return err
		}
		return bumpFolder(r.Context(), tx, folder)
	})
	if err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// 공유 폴더 나가기(참여자만). 소유자는 나갈 수 없다(폴더 삭제·공유 해제로). 폴더와 내용은 남는다.
func (s *Server) leaveFolder(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	folder, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		badRequest(w, "id가 잘못됐습니다")
		return
	}
	tag, err := s.db.Exec(r.Context(), `DELETE FROM folder_members WHERE folder_id = $1 AND user_id = $2`, folder, u.ID)
	if err == nil && tag.RowsAffected() == 0 {
		// 공유받은 '전체'에서 나가기(폴더 id 자리에 주인 사용자 id)
		tag, err = s.db.Exec(r.Context(), `DELETE FROM base_members WHERE owner_id = $1 AND user_id = $2`, folder, u.ID)
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		errJSON(w, http.StatusNotFound, "share_not_found", "공유를 찾을 수 없습니다")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// 공유받은 폴더를 내 홈에도 보일지(내 설정만 바뀐다. 다른 참여자와 공유 관계는 그대로)
func (s *Server) setFolderHome(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	folder, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		badRequest(w, "id가 잘못됐습니다")
		return
	}
	var b struct {
		Home bool `json:"home"`
	}
	if !decode(w, r, &b) {
		return
	}
	tag, err := s.db.Exec(r.Context(), `UPDATE folder_members SET home = $3 WHERE folder_id = $1 AND user_id = $2`, folder, u.ID, b.Home)
	if err == nil && tag.RowsAffected() == 0 {
		// 공유받은 '전체'(폴더 id 자리에 주인 사용자 id)
		tag, err = s.db.Exec(r.Context(), `UPDATE base_members SET home = $3 WHERE owner_id = $1 AND user_id = $2`, folder, u.ID, b.Home)
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		errJSON(w, http.StatusNotFound, "share_not_found", "공유를 찾을 수 없습니다")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) createLink(w http.ResponseWriter, r *http.Request) {
	folder, base, ok := s.ownedFolder(w, r)
	if !ok {
		return
	}
	if base {
		badRequest(w, "전체는 링크로 공유할 수 없습니다")
		return
	}
	raw := make([]byte, 18)
	rand.Read(raw)
	l := link{Token: base64.RawURLEncoding.EncodeToString(raw), CreatedAt: time.Now()}
	l.Path = "/s/" + l.Token
	if _, err := s.db.Exec(r.Context(), `INSERT INTO share_links (token, folder_id) VALUES ($1, $2)`, l.Token, folder); err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, l)
}

func (s *Server) deleteLink(w http.ResponseWriter, r *http.Request) {
	folder, base, ok := s.ownedFolder(w, r)
	if !ok {
		return
	}
	if base {
		badRequest(w, "전체는 링크로 공유할 수 없습니다")
		return
	}
	if _, err := s.db.Exec(r.Context(), `DELETE FROM share_links WHERE folder_id = $1 AND token = $2`, folder, r.PathValue("token")); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) withSeqWrite(ctx context.Context, fn func(pgx.Tx) error) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock_shared($1)`, seqLock); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// 새로 공유받은 사람이 커서와 상관없이 폴더 내용을 받도록 seq를 새로 매긴다.
func bumpFolder(ctx context.Context, tx pgx.Tx, folder uuid.UUID) error {
	for _, q := range []string{
		`UPDATE folders SET seq = nextval('change_seq') WHERE id = $1`,
		`UPDATE todos SET seq = nextval('change_seq') WHERE folder_id = $1`,
		`UPDATE paragraphs SET seq = nextval('change_seq') WHERE folder_id = $1`,
	} {
		if _, err := tx.Exec(ctx, q, folder); err != nil {
			return err
		}
	}
	return nil
}

// '전체'를 새로 공유받은 사람이 커서와 상관없이 주인의 폴더 없는 항목을 받도록 seq를 새로 매긴다(bumpFolder와 같은 이유).
// owner_id는 폴더 없는 항목에만 있다(폴더에 든 항목은 NULL).
func bumpBase(ctx context.Context, tx pgx.Tx, owner uuid.UUID) error {
	for _, q := range []string{
		`UPDATE todos SET seq = nextval('change_seq') WHERE owner_id = $1`,
		`UPDATE paragraphs SET seq = nextval('change_seq') WHERE owner_id = $1`,
	} {
		if _, err := tx.Exec(ctx, q, owner); err != nil {
			return err
		}
	}
	return nil
}

var linkPage = template.Must(template.New("link").Parse(`<!doctype html>
<html lang="{{.Lang}}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>{{.Name}} - modo</title>
<style>
body{margin:0;background:#050505;color:#fff;font-family:system-ui,-apple-system,"Malgun Gothic",sans-serif}
main{max-width:560px;margin:0 auto;padding:32px 16px}
h1{font-size:28px;margin:0 0 6px}.scope{color:#9a9a9c;font-size:14px;margin:0 0 24px}
.card{background:#1a1a1b;border-radius:16px;padding:16px 20px;margin-bottom:8px;line-height:1.7;white-space:pre-wrap}
.todo{display:flex;gap:14px;align-items:center}.c{width:22px;height:22px;border:2px solid #858586;border-radius:50%;flex:none}
.done .c{background:#94cdf8;border-color:#94cdf8}.done span{color:#9a9a9c;text-decoration:line-through}
::selection{background:rgba(114,205,244,.55)}
</style></head><body><main>
<h1>{{.Name}}</h1><p class="scope">{{printf .T.Scope .Name}}</p>
{{if .Memo}}<div class="card">{{range $i, $p := .Memo}}{{if $i}}
{{end}}{{$p}}{{end}}</div>{{end}}
{{range .Todos}}<div class="card todo{{if .Done}} done{{end}}"><div class="c"></div><span>{{.Text}}</span></div>{{end}}
</main></body></html>`))

func (s *Server) publicLink(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	var folder uuid.UUID
	var name string
	err := s.db.QueryRow(ctx, `
		SELECT f.id, f.name FROM share_links l JOIN folders f ON f.id = l.folder_id
		WHERE l.token = $1 AND f.deleted_at IS NULL`, r.PathValue("token")).Scan(&folder, &name)
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, pageTexts[pageLang(r)].LinkGone, http.StatusNotFound)
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	lang := pageLang(r)
	data := struct {
		Lang  string
		T     pageText
		Name  string
		Memo  []string
		Todos []struct {
			Text string
			Done bool
		}
	}{Lang: lang, T: pageTexts[lang], Name: name}
	rows, err := s.db.Query(ctx, `SELECT text FROM paragraphs WHERE folder_id = $1 AND deleted_at IS NULL ORDER BY position, id`, folder)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var t string
		rows.Scan(&t)
		data.Memo = append(data.Memo, t)
	}
	rows.Close()
	rows, err = s.db.Query(ctx, `SELECT text, done_at IS NOT NULL FROM todos WHERE folder_id = $1 AND deleted_at IS NULL ORDER BY position, id`, folder)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var t struct {
			Text string
			Done bool
		}
		rows.Scan(&t.Text, &t.Done)
		data.Todos = append(data.Todos, t)
	}
	rows.Close()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Language", lang)
	w.Header().Set("Vary", "Accept-Language")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	linkPage.Execute(w, data)
}
