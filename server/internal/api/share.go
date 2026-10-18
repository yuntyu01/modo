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
func (s *Server) ownedFolder(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	u := userFrom(r.Context())
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		badRequest(w, "id가 잘못됐습니다")
		return uuid.Nil, false
	}
	var owner uuid.UUID
	err = s.db.QueryRow(r.Context(), `SELECT owner_id FROM folders WHERE id = $1 AND deleted_at IS NULL`, id).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		errJSON(w, http.StatusNotFound, "folder_not_synced", "폴더가 아직 서버에 없습니다. 동기화 후 다시 시도해 주세요")
		return uuid.Nil, false
	}
	if err != nil {
		serverError(w, err)
		return uuid.Nil, false
	}
	if owner != u.ID {
		errJSON(w, http.StatusForbidden, "not_owner", "폴더 소유자만 공유를 바꿀 수 있습니다")
		return uuid.Nil, false
	}
	return id, true
}

func (s *Server) listShares(w http.ResponseWriter, r *http.Request) {
	folder, ok := s.ownedFolder(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	out := struct {
		Members []member `json:"members"`
		Links   []link   `json:"links"`
	}{Members: []member{}, Links: []link{}}
	rows, err := s.db.Query(ctx, `
		SELECT m.user_id, COALESCE(u.email, ''), u.name, m.role, m.created_at FROM folder_members m JOIN users u ON u.id = m.user_id
		WHERE m.folder_id = $1 ORDER BY m.created_at`, folder)
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
	folder, ok := s.ownedFolder(w, r)
	if !ok {
		return
	}
	var b struct {
		Email string `json:"email"`
		Role  string `json:"role"`
	}
	if !decode(w, r, &b) || !validRole(w, b.Role) {
		return
	}
	var m member
	err := s.db.QueryRow(r.Context(), `SELECT id, email, name FROM users WHERE email = $1`, strings.ToLower(strings.TrimSpace(b.Email))).Scan(&m.UserID, &m.Email, &m.Name)
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
	m.Role, m.CreatedAt = b.Role, time.Now()
	err = s.withSeqWrite(r.Context(), func(tx pgx.Tx) error {
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
	writeJSON(w, http.StatusCreated, m)
}

func (s *Server) updateMember(w http.ResponseWriter, r *http.Request) {
	folder, ok := s.ownedFolder(w, r)
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
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) removeMember(w http.ResponseWriter, r *http.Request) {
	folder, ok := s.ownedFolder(w, r)
	if !ok {
		return
	}
	user, err := uuid.Parse(r.PathValue("user"))
	if err != nil {
		badRequest(w, "user가 잘못됐습니다")
		return
	}
	err = s.withSeqWrite(r.Context(), func(tx pgx.Tx) error {
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

func (s *Server) createLink(w http.ResponseWriter, r *http.Request) {
	folder, ok := s.ownedFolder(w, r)
	if !ok {
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
	folder, ok := s.ownedFolder(w, r)
	if !ok {
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
