package api

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// TEST_DATABASE_URL이 있을 때만 실제 Postgres로 돈다. 테이블을 지우므로 전용 DB를 쓸 것.
func newTestServer(t *testing.T) *httptest.Server {
	srv, _ := newTestServerDB(t)
	return srv
}

func newTestServerDB(t *testing.T) (*httptest.Server, *pgxpool.Pool) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	resetDB(t, pool)
	s := New(pool, testConfig)
	if err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	mux := http.NewServeMux()
	s.Routes(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv, pool
}

// 카카오 로그인 테스트가 가짜 카카오 서버 주소를 넣는다.
var testConfig Config

func resetDB(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `
		DROP TABLE IF EXISTS daily_activity, friend_requests, friendships, shares, folder_members, base_members, share_links, applied_ops, tombstones, paragraphs, todos, folders,
			kakao_unlink_jobs, login_codes, oauth_states, oauth_identities, password_logins, sessions, users, items, app_meta CASCADE;
		DROP FUNCTION IF EXISTS items_owner_from_folder, folders_owner_to_items CASCADE`); err != nil {
		t.Fatal(err)
	}
}

type client struct {
	t     *testing.T
	srv   *httptest.Server
	token string
	id    string
	ua    string // 있으면 User-Agent(활동 기록 테스트가 앱처럼 보낸다)
}

func (c *client) do(method, path string, body, out any) int {
	c.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, c.srv.URL+path, &buf)
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
	if c.ua != "" {
		req.Header.Set("User-Agent", c.ua)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	if out != nil {
		json.NewDecoder(res.Body).Decode(out)
	}
	return res.StatusCode
}

func signup(t *testing.T, srv *httptest.Server, email string) *client {
	c := &client{t: t, srv: srv}
	var r struct {
		Token string `json:"token"`
		User  struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	if code := c.do("POST", "/api/auth/register", map[string]string{"email": email, "password": "password123", "device": "test"}, &r); code != 201 {
		t.Fatalf("register %s: %d", email, code)
	}
	c.token, c.id = r.Token, r.User.ID
	return c
}

type res struct {
	OpID      string   `json:"op_id"`
	Status    string   `json:"status"`
	Message   string   `json:"message"`
	CopyID    string   `json:"copy_id"`
	Conflicts []string `json:"conflicts"`
}

func (c *client) push(ops ...map[string]any) []res {
	c.t.Helper()
	var out struct {
		Results []res `json:"results"`
	}
	if code := c.do("POST", "/api/sync/push", map[string]any{"ops": ops}, &out); code != 200 {
		c.t.Fatalf("push: %d", code)
	}
	return out.Results
}

type pullResp struct {
	Folders    []map[string]any `json:"folders"`
	Todos      []map[string]any `json:"todos"`
	Paragraphs []map[string]any `json:"paragraphs"`
	Deleted    []map[string]any `json:"deleted"`
	Cursor     int64            `json:"cursor"`
	More       bool             `json:"more"`
	ForeignIDs []string         `json:"foreign_ids"`
	Shared     []map[string]any `json:"shared"`
	// 남의 항목 목록 요약: 같은 요약(fd)을 보내면 목록 대신 foreign_same
	ForeignDigest string `json:"foreign_digest"`
	ForeignSame   bool   `json:"foreign_same"`
}

func (c *client) pullFD(since int64, fd string) pullResp {
	c.t.Helper()
	var p pullResp
	if code := c.do("GET", "/api/sync/pull?since="+itoa(since)+"&fd="+fd, nil, &p); code != 200 {
		c.t.Fatalf("pull: %d", code)
	}
	return p
}

func (c *client) pull(since int64) pullResp {
	c.t.Helper()
	var p pullResp
	if code := c.do("GET", "/api/sync/pull?since="+itoa(since), nil, &p); code != 200 {
		c.t.Fatalf("pull: %d", code)
	}
	return p
}

func itoa(n int64) string { b, _ := json.Marshal(n); return string(b) }

func set(vals map[string]any) map[string]any {
	f := map[string]any{}
	for k, v := range vals {
		f[k] = map[string]any{"old": nil, "new": v}
	}
	return f
}

func create(entity, id string, vals map[string]any) map[string]any {
	return map[string]any{"op_id": uuid.NewString(), "entity": entity, "id": id, "create": true, "fields": set(vals)}
}

func update(entity, id string, field string, old, new any) map[string]any {
	return map[string]any{"op_id": uuid.NewString(), "entity": entity, "id": id,
		"fields": map[string]any{field: map[string]any{"old": old, "new": new}}}
}

func todo(id, folder, text string) map[string]any {
	v := map[string]any{"text": text, "position": "V", "created_at": 1, "updated_at": 1}
	if folder != "" {
		v["folder_id"] = folder
	}
	return create("todo", id, v)
}

func TestAuth(t *testing.T) {
	srv := newTestServer(t)
	signup(t, srv, "a@example.com")
	c := &client{t: t, srv: srv}
	if code := c.do("POST", "/api/auth/register", map[string]string{"email": "A@example.com ", "password": "password123"}, nil); code != 409 {
		t.Fatalf("duplicate email (case-insensitive): %d", code)
	}
	if code := c.do("POST", "/api/auth/login", map[string]string{"email": "a@example.com", "password": "wrong-pass"}, nil); code != 401 {
		t.Fatalf("wrong password: %d", code)
	}
	if code := c.do("GET", "/api/me", nil, nil); code != 401 {
		t.Fatalf("no token: %d", code)
	}
}

func TestPushIdempotentAndPull(t *testing.T) {
	srv := newTestServer(t)
	a := signup(t, srv, "a@example.com")
	tid := uuid.NewString()
	op := todo(tid, "", "회의 자료 정리")
	r1 := a.push(op)
	r2 := a.push(op) // 응답이 유실돼 같은 op를 다시 보냄
	if r1[0].Status != "ok" || r2[0].Status != "ok" {
		t.Fatalf("results %+v %+v", r1, r2)
	}
	p := a.pull(0)
	if len(p.Todos) != 1 || p.Todos[0]["text"] != "회의 자료 정리" || p.More {
		t.Fatalf("pull: %+v", p)
	}
	// 커서 이후 변경만 온다.
	a.push(update("todo", tid, "done_at", nil, 5))
	p2 := a.pull(p.Cursor)
	if len(p2.Todos) != 1 || p2.Todos[0]["done_at"] != float64(5) {
		t.Fatalf("incremental pull: %+v", p2)
	}
	if p3 := a.pull(p2.Cursor); len(p3.Todos) != 0 {
		t.Fatalf("nothing new expected: %+v", p3)
	}
	// 잘못된 값은 거절하고 다른 op는 계속 처리한다.
	bad := create("todo", uuid.NewString(), map[string]any{"text": "x", "position": "bad key!", "created_at": 1, "updated_at": 1})
	rs := a.push(bad, todo(uuid.NewString(), "", "ok"))
	if rs[0].Status != "invalid" || rs[1].Status != "ok" {
		t.Fatalf("mixed batch: %+v", rs)
	}
}

func TestConcurrentTextEditKeepsBoth(t *testing.T) {
	srv := newTestServer(t)
	a := signup(t, srv, "a@example.com")
	pid := uuid.NewString()
	a.push(create("paragraph", pid, map[string]any{"text": "원래 문단", "position": "V", "created_at": 1, "updated_at": 1}))
	// 폰과 PC가 둘 다 '원래 문단'을 보고 각자 고침
	phone := a.push(update("paragraph", pid, "text", "원래 문단", "폰에서 고침"))
	pc := a.push(update("paragraph", pid, "text", "원래 문단", "PC에서 고침"))
	if phone[0].Status != "ok" || pc[0].Status != "conflict" || pc[0].CopyID == "" {
		t.Fatalf("phone %+v pc %+v", phone, pc)
	}
	p := a.pull(0)
	texts := map[string]any{}
	for _, row := range p.Paragraphs {
		texts[row["id"].(string)] = row
	}
	orig := texts[pid].(map[string]any)
	cp := texts[pc[0].CopyID].(map[string]any)
	if orig["text"] != "폰에서 고침" || cp["text"] != "PC에서 고침" || cp["conflict_of"] != pid {
		t.Fatalf("orig %+v copy %+v", orig, cp)
	}
	if cp["position"].(string) <= orig["position"].(string) {
		t.Fatalf("copy should sort right after original")
	}
	// 같은 값으로 바꾸는 건 충돌이 아니다.
	if r := a.push(update("paragraph", pid, "text", "원래 문단", "폰에서 고침")); r[0].Status != "ok" {
		t.Fatalf("same value: %+v", r)
	}
}

func TestSharingPermissions(t *testing.T) {
	srv, pool := newTestServerDB(t)
	owner := signup(t, srv, "owner@example.com")
	guest := signup(t, srv, "guest@example.com")
	stranger := signup(t, srv, "stranger@example.com")

	work, private := uuid.NewString(), uuid.NewString()
	owner.push(
		create("folder", work, map[string]any{"name": "업무", "position": "V", "created_at": 1, "updated_at": 1}),
		create("folder", private, map[string]any{"name": "개인", "position": "W", "created_at": 1, "updated_at": 1}),
	)
	workTodo, privTodo, unfiled := uuid.NewString(), uuid.NewString(), uuid.NewString()
	owner.push(todo(workTodo, work, "업무 할 일"), todo(privTodo, private, "비밀 할 일"), todo(unfiled, "", "미분류"))

	// 공유 전: 남의 항목을 고칠 수 없다.
	if r := guest.push(update("todo", workTodo, "text", "업무 할 일", "해킹")); r[0].Status != "forbidden" {
		t.Fatalf("before share: %+v", r)
	}
	// 소유자가 아니면 공유를 만들 수 없다.
	if code := guest.do("POST", "/api/folders/"+work+"/members", map[string]string{"email": "stranger@example.com", "role": "view"}, nil); code != 403 {
		t.Fatalf("non-owner invite: %d", code)
	}

	var share member
	if code := owner.do("POST", "/api/folders/"+work+"/members", map[string]string{"email": "guest@example.com", "role": "view"}, &share); code != 201 {
		t.Fatalf("invite: %d", code)
	}
	p := guest.pull(0)
	if len(p.Todos) != 1 || p.Todos[0]["id"] != workTodo || len(p.Folders) != 1 {
		t.Fatalf("guest should see only shared folder: %+v", p)
	}
	if len(p.ForeignIDs) != 2 {
		t.Fatalf("foreign ids: %+v", p.ForeignIDs)
	}
	if sp := stranger.pull(0); len(sp.Todos) != 0 {
		t.Fatalf("stranger sees: %+v", sp)
	}
	// 보기 권한은 쓰기 불가
	if r := guest.push(update("todo", workTodo, "done_at", nil, 7)); r[0].Status != "forbidden" {
		t.Fatalf("view role write: %+v", r)
	}
	if r := guest.push(todo(uuid.NewString(), work, "새 항목")); r[0].Status != "forbidden" {
		t.Fatalf("view role create: %+v", r)
	}

	// 편집 권한으로 올리면 쓸 수 있고, 만든 항목은 폴더 주인 소유가 된다.
	if code := owner.do("PATCH", "/api/folders/"+work+"/members/"+share.UserID.String(), map[string]string{"role": "edit"}, nil); code != 204 {
		t.Fatalf("role change: %d", code)
	}
	if r := guest.push(update("todo", workTodo, "done_at", nil, 7)); r[0].Status != "ok" {
		t.Fatalf("edit role write: %+v", r)
	}
	gt := uuid.NewString()
	if r := guest.push(todo(gt, work, "게스트가 추가")); r[0].Status != "ok" {
		t.Fatalf("edit role create: %+v", r)
	}
	found := false
	for _, row := range owner.pull(0).Todos {
		found = found || row["id"] == gt
	}
	var ownerCol *string
	pool.QueryRow(context.Background(), `SELECT owner_id::text FROM todos WHERE id = $1`, gt).Scan(&ownerCol)
	if !found || ownerCol != nil {
		t.Fatalf("guest-created item should belong to folder (owner sees it: %v, own owner_id: %v)", found, ownerCol)
	}
	if o := p.Shared[0]["owner"].(map[string]any); o["email"] != "owner@example.com" || o["id"] != owner.id {
		t.Fatalf("shared owner: %+v", p.Shared)
	}
	// 편집자라도 공유 폴더 밖(비공개 폴더, 미분류)으로는 못 옮기고 폴더 자체도 못 고친다.
	if r := guest.push(update("todo", workTodo, "folder_id", work, private)); r[0].Status != "forbidden" {
		t.Fatalf("move to private: %+v", r)
	}
	if r := guest.push(update("todo", workTodo, "folder_id", work, nil)); r[0].Status != "forbidden" {
		t.Fatalf("move out: %+v", r)
	}
	if r := guest.push(update("folder", work, "name", "업무", "바꿈")); r[0].Status != "forbidden" {
		t.Fatalf("rename folder: %+v", r)
	}

	// 링크는 그 폴더만 보여준다.
	var lk link
	owner.do("POST", "/api/folders/"+work+"/links", nil, &lk)
	resp, _ := http.Get(srv.URL + lk.Path)
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	html := string(body)
	if !strings.Contains(html, "업무 할 일") || strings.Contains(html, "비밀 할 일") || strings.Contains(html, "미분류") {
		t.Fatalf("link page leaks or misses content")
	}

	// 소유자가 항목을 비공개 폴더로 옮기면 게스트 목록에서 빠진다.
	owner.push(update("todo", workTodo, "folder_id", work, private))
	p = guest.pull(0)
	for _, id := range p.ForeignIDs {
		if id == workTodo {
			t.Fatalf("moved item still visible to guest")
		}
	}
	// 공유 해제
	owner.do("DELETE", "/api/folders/"+work+"/members/"+share.UserID.String(), nil, nil)
	owner.do("DELETE", "/api/folders/"+work+"/links/"+lk.Token, nil, nil)
	p = guest.pull(0)
	if len(p.ForeignIDs) != 0 || len(p.Todos) != 0 {
		t.Fatalf("after revoke: %+v", p)
	}
	if resp, _ := http.Get(srv.URL + lk.Path); resp.StatusCode != 404 {
		t.Fatalf("revoked link: %d", resp.StatusCode)
	}
}

// 날짜는 날짜형으로 저장되고 'YYYY-MM-DD'로 그대로 돌아온다. 없는 날짜는 거절한다.
func TestDueDateIsDate(t *testing.T) {
	srv, pool := newTestServerDB(t)
	a := signup(t, srv, "date@example.com")
	id := uuid.NewString()
	op := todo(id, "", "보고서")
	op["fields"].(map[string]any)["due_date"] = map[string]any{"old": nil, "new": "2026-10-17"}
	if r := a.push(op); r[0].Status != "ok" {
		t.Fatalf("push: %+v", r)
	}
	bad := update("todo", id, "due_date", "2026-10-17", "2026-02-30")
	if r := a.push(bad); r[0].Status != "invalid" {
		t.Fatalf("bad date accepted: %+v", r)
	}
	var typ string
	pool.QueryRow(context.Background(), `SELECT pg_typeof(due_date)::text FROM todos WHERE id = $1`, id).Scan(&typ)
	if typ != "date" {
		t.Fatalf("due_date type %s", typ)
	}
	p := a.pull(0)
	if p.Todos[0]["due_date"] != "2026-10-17" {
		t.Fatalf("pulled due_date %v", p.Todos[0]["due_date"])
	}
}

// 반복은 정해진 값만 받고(매일/매주/매월, 요일 비트 1~127) 그대로 돌아온다. 예전 행은 반복 없음.
func TestRepeatFields(t *testing.T) {
	srv, _ := newTestServerDB(t)
	a := signup(t, srv, "repeat@example.com")
	id := uuid.NewString()
	op := todo(id, "", "책 20분 읽기")
	f := op["fields"].(map[string]any)
	f["due_date"] = map[string]any{"old": nil, "new": "2026-10-19"}
	f["repeat_freq"] = map[string]any{"old": nil, "new": "weekly"}
	f["repeat_days"] = map[string]any{"old": nil, "new": 21}
	if r := a.push(op); r[0].Status != "ok" {
		t.Fatalf("push: %+v", r)
	}
	for _, bad := range []map[string]any{
		update("todo", id, "repeat_freq", "weekly", "hourly"),
		update("todo", id, "repeat_days", 21, 128),
		update("todo", id, "repeat_days", 21, 0),
	} {
		if r := a.push(bad); r[0].Status != "invalid" {
			t.Fatalf("bad repeat accepted: %+v", r)
		}
	}
	// 반복 끄기(null)
	if r := a.push(update("todo", id, "repeat_freq", "weekly", nil)); r[0].Status != "ok" {
		t.Fatalf("clear repeat: %+v", r)
	}
	plain := uuid.NewString()
	a.push(todo(plain, "", "보통 할 일"))
	got := map[string]map[string]any{}
	for _, row := range a.pull(0).Todos {
		got[row["id"].(string)] = row
	}
	if got[id]["repeat_freq"] != nil || got[id]["repeat_days"] != float64(21) {
		t.Fatalf("pulled repeat %v %v", got[id]["repeat_freq"], got[id]["repeat_days"])
	}
	if got[plain]["repeat_freq"] != nil || got[plain]["repeat_days"] != nil {
		t.Fatalf("plain todo has repeat: %v", got[plain])
	}
}

// 항목의 주인은 한 곳에만: 폴더에 든 항목은 폴더 주인(owner_id 없음), 기본 폴더 항목만 owner_id.
func TestItemOwnerIsFolders(t *testing.T) {
	srv, pool := newTestServerDB(t)
	a := signup(t, srv, "owner-a@example.com")
	ctx := context.Background()
	cols := func(id string) (folder, owner *string) {
		pool.QueryRow(ctx, `SELECT folder_id::text, owner_id::text FROM todos WHERE id = $1`, id).Scan(&folder, &owner)
		return
	}
	folder, item, early := uuid.NewString(), uuid.NewString(), uuid.NewString()
	a.push(create("folder", folder, map[string]any{"name": "업무", "position": "V", "created_at": 1, "updated_at": 1}))
	a.push(todo(item, "", "기본 폴더 항목"))
	if f, o := cols(item); f != nil || o == nil || *o != a.id {
		t.Fatalf("default item: folder %v owner %v", f, o)
	}
	// 폴더로 옮기면 주인은 폴더가 정한다(owner_id 비움), 다시 빼면 owner_id
	a.push(update("todo", item, "folder_id", nil, folder))
	if f, o := cols(item); f == nil || *f != folder || o != nil {
		t.Fatalf("moved into folder: folder %v owner %v", f, o)
	}
	a.push(update("todo", item, "folder_id", folder, nil))
	if f, o := cols(item); f != nil || o == nil || *o != a.id {
		t.Fatalf("moved out: folder %v owner %v", f, o)
	}
	// DB가 둘 다 있거나 둘 다 없는 행을 막는다
	if _, err := pool.Exec(ctx, `UPDATE todos SET folder_id = $1 WHERE id = $2`, folder, item); err == nil {
		t.Fatalf("CHECK should reject folder_id + owner_id")
	}
	// 서버에 없는 폴더로 온 새 항목은 내용을 잃지 않게 기본 폴더에 둔다
	if r := a.push(todo(early, uuid.NewString(), "폴더보다 먼저 온 항목")); r[0].Status != "ok" {
		t.Fatalf("push early: %+v", r)
	}
	if f, o := cols(early); f != nil || o == nil {
		t.Fatalf("early item: folder %v owner %v", f, o)
	}
	// 서버에 없는 폴더로 옮기기는 거절(다음 pull에서 원래 폴더로 돌아간다)
	if r := a.push(update("todo", item, "folder_id", nil, uuid.NewString())); r[0].Status != "forbidden" {
		t.Fatalf("move to missing folder: %+v", r)
	}
}

// 한 번의 push 안에서 앞 op가 만든 폴더·항목을 뒤 op가 이어서 쓴다(한 트랜잭션, 메모리 상태).
func TestPushBatchSeesEarlierOps(t *testing.T) {
	srv := newTestServer(t)
	a := signup(t, srv, "batch@example.com")
	folder, item := uuid.NewString(), uuid.NewString()
	rs := a.push(
		create("folder", folder, map[string]any{"name": "새 폴더", "position": "a0", "created_at": 1, "updated_at": 1}),
		todo(item, folder, "첫 글"),
		update("todo", item, "text", "첫 글", "고친 글"),
		update("folder", folder, "name", "새 폴더", "이름 바꿈"),
		update("todo", item, "text", "누가 알던 옛 글", "동시에 고친 글"),
	)
	want := []string{"ok", "ok", "ok", "ok", "conflict"}
	for i, r := range rs {
		if r.Status != want[i] {
			t.Fatalf("op %d: %+v", i, rs)
		}
	}
	p := a.pull(0)
	if len(p.Folders) != 1 || p.Folders[0]["name"] != "이름 바꿈" || len(p.Todos) != 2 {
		t.Fatalf("pull: %+v", p)
	}
	for _, row := range p.Todos {
		if row["id"] == item && (row["text"] != "고친 글" || row["folder_id"] != folder) {
			t.Fatalf("item: %+v", row)
		}
		if row["id"] == rs[4].CopyID && (row["text"] != "동시에 고친 글" || row["folder_id"] != folder) {
			t.Fatalf("copy: %+v", row)
		}
	}
	// 같은 push를 다시 보내면 같은 결과(재전송)
	again := a.push(
		map[string]any{"op_id": rs[2].OpID, "entity": "todo", "id": item, "fields": map[string]any{"text": map[string]any{"old": "x", "new": "y"}}},
	)
	if again[0].Status != "ok" {
		t.Fatalf("replay: %+v", again)
	}
}

// 영구 삭제는 행을 지우고 tombstones에 남긴다. 다른 기기와 공유받은 사람도 pull로 받고, 같은 id로 다시 만들 수 없다.
func TestPurgeLeavesTombstone(t *testing.T) {
	srv, pool := newTestServerDB(t)
	owner := signup(t, srv, "purge-owner@example.com")
	guest := signup(t, srv, "purge-guest@example.com")
	ctx := context.Background()
	work, inFolder, plain, copyOf := uuid.NewString(), uuid.NewString(), uuid.NewString(), ""
	owner.push(create("folder", work, map[string]any{"name": "업무", "position": "V", "created_at": 1, "updated_at": 1}))
	owner.push(todo(inFolder, work, "공유 폴더 할 일"), todo(plain, "", "기본 할 일"))
	owner.do("POST", "/api/folders/"+work+"/members", map[string]string{"email": "purge-guest@example.com", "role": "view"}, nil)
	// 충돌 사본을 하나 만들어 둔다(원본을 지우면 사본의 conflict_of는 비워진다)
	owner.push(update("todo", plain, "text", "기본 할 일", "폰"))
	copyOf = owner.push(update("todo", plain, "text", "기본 할 일", "PC"))[0].CopyID
	since := owner.pull(0).Cursor
	gsince := guest.pull(0).Cursor

	purge := func(id string) map[string]any {
		return map[string]any{"op_id": uuid.NewString(), "entity": "todo", "id": id,
			"fields": map[string]any{"purged": map[string]any{"old": false, "new": true}, "text": map[string]any{"old": "x", "new": ""}}}
	}
	if r := owner.push(purge(plain), purge(inFolder)); r[0].Status != "ok" || r[1].Status != "ok" {
		t.Fatalf("purge: %+v", r)
	}
	var n int
	pool.QueryRow(ctx, `SELECT count(*) FROM todos WHERE id = ANY($1)`, []string{plain, inFolder}).Scan(&n)
	if n != 0 {
		t.Fatalf("purged rows left: %d", n)
	}
	var conflictOf *string
	pool.QueryRow(ctx, `SELECT conflict_of::text FROM todos WHERE id = $1`, copyOf).Scan(&conflictOf)
	if conflictOf != nil {
		t.Fatalf("copy still points at purged original")
	}
	if p := owner.pull(since); len(p.Deleted) != 2 {
		t.Fatalf("owner deleted: %+v", p.Deleted)
	}
	if p := guest.pull(gsince); len(p.Deleted) != 1 || p.Deleted[0]["id"] != inFolder || p.Deleted[0]["entity"] != "todo" {
		t.Fatalf("guest deleted: %+v", p.Deleted)
	}
	// 오래 꺼져 있던 기기가 지운 항목을 다시 '만들기'로 보내도 살아나지 않는다
	if r := owner.push(todo(plain, "", "되살리기")); r[0].Status != "gone" {
		t.Fatalf("recreate: %+v", r)
	}
	pool.QueryRow(ctx, `SELECT count(*) FROM todos WHERE id = $1`, plain).Scan(&n)
	if n != 0 {
		t.Fatalf("purged item came back")
	}
}

// 예전 구조(비밀번호가 users에, 항목마다 복사한 owner_id와 트리거, purged 행, version)의 DB를 새 구조로 옮긴다.
func TestMigrateFromV1(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	resetDB(t, pool)
	v1, _ := os.ReadFile("testdata/schema_v1.sql")
	if _, err := pool.Exec(ctx, string(v1)); err != nil {
		t.Fatal(err)
	}
	u, folder := uuid.NewString(), uuid.NewString()
	inFolder, plain, orphan, purged := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO users (id, email, password_hash) VALUES ($1, 'old@example.com', 'hash')`, []any{u}},
		{`INSERT INTO folders (id, owner_id, name, position, created_at, updated_at) VALUES ($1, $2, '업무', 'V', 1, 1)`, []any{folder, u}},
		{`INSERT INTO todos (id, owner_id, folder_id, text, position, created_at, updated_at) VALUES ($1, $2, $3, '폴더 항목', 'V', 1, 1)`, []any{inFolder, u, folder}},
		{`INSERT INTO todos (id, owner_id, folder_id, text, position, created_at, updated_at) VALUES ($1, $2, NULL, '기본 항목', 'W', 1, 1)`, []any{plain, u}},
		{`INSERT INTO todos (id, owner_id, folder_id, text, position, created_at, updated_at) VALUES ($1, $2, $3, '없는 폴더 항목', 'X', 1, 1)`, []any{orphan, u, uuid.NewString()}},
		{`INSERT INTO todos (id, owner_id, folder_id, text, position, created_at, updated_at, purged) VALUES ($1, $2, $3, '', 'Y', 1, 1, true)`, []any{purged, u, folder}},
	} {
		if _, err := pool.Exec(ctx, q.sql, q.args...); err != nil {
			t.Fatal(err)
		}
	}
	s := New(pool, Config{})
	if err := s.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	if err := s.Migrate(ctx); err != nil { // 두 번 돌려도 그대로
		t.Fatal(err)
	}
	var hash string
	pool.QueryRow(ctx, `SELECT password_hash FROM password_logins WHERE user_id = $1`, u).Scan(&hash)
	if hash != "hash" {
		t.Fatalf("password moved: %q", hash)
	}
	type row struct{ folder, owner *string }
	get := func(id string) (r row) {
		pool.QueryRow(ctx, `SELECT folder_id::text, owner_id::text FROM todos WHERE id = $1`, id).Scan(&r.folder, &r.owner)
		return
	}
	if r := get(inFolder); r.folder == nil || r.owner != nil {
		t.Fatalf("folder item: %+v", r)
	}
	if r := get(plain); r.folder != nil || r.owner == nil {
		t.Fatalf("plain item: %+v", r)
	}
	if r := get(orphan); r.folder != nil || r.owner == nil || *r.owner != u {
		t.Fatalf("orphan item: %+v", r)
	}
	var n int
	pool.QueryRow(ctx, `SELECT count(*) FROM tombstones WHERE id = $1 AND folder_id = $2`, purged, folder).Scan(&n)
	if n != 1 {
		t.Fatalf("purged row → tombstone: %d", n)
	}
	for _, c := range [][2]string{{"todos", "purged"}, {"paragraphs", "purged"}, {"todos", "version"}, {"folders", "version"}, {"users", "password_hash"}} {
		pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 AND table_schema = current_schema()`, c[0], c[1]).Scan(&n)
		if n != 0 {
			t.Fatalf("column %s.%s still exists", c[0], c[1])
		}
	}
}

// 오래된 재전송 기록과 세션은 Cleanup이 지운다.
func TestCleanup(t *testing.T) {
	srv, pool := newTestServerDB(t)
	a := signup(t, srv, "clean@example.com")
	ctx := context.Background()
	pool.Exec(ctx, `INSERT INTO applied_ops (user_id, op_id, result, created_at) VALUES ($1, 'old', '{}', now() - interval '40 days'), ($1, 'new', '{}', now())`, a.id)
	if err := New(pool, Config{}).Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	pool.QueryRow(ctx, `SELECT count(*) FROM applied_ops WHERE user_id = $1`, a.id).Scan(&n)
	if n != 1 {
		t.Fatalf("applied_ops left %d, want 1", n)
	}
}

// DB가 받지 않는 값(NUL 글자, 0으로 된 UUID, 0년)이 섞여도 그 op만 invalid가 되고 나머지는 저장된다.
// (예전에는 묶음 전체가 500으로 실패하고 클라이언트가 같은 묶음을 영영 다시 보내 동기화가 멈췄다)
func TestBadValueDoesNotBlockPush(t *testing.T) {
	srv := newTestServer(t)
	a := signup(t, srv, "poison@example.com")
	good1, good2, zeroFolder := uuid.NewString(), uuid.NewString(), uuid.NewString()
	nul := todo(uuid.NewString(), "", "글\u0000자")
	year0 := todo(uuid.NewString(), "", "0년")
	year0["fields"].(map[string]any)["due_date"] = map[string]any{"old": nil, "new": "0000-01-01"}
	rs := a.push(todo(good1, "", "앞"), nul, todo(zeroFolder, uuid.Nil.String(), "0 UUID 폴더"), year0, todo(good2, "", "뒤"))
	want := []string{"ok", "invalid", "ok", "invalid", "ok"}
	for i, r := range rs {
		if r.Status != want[i] {
			t.Fatalf("op %d: %+v", i, rs)
		}
	}
	got := map[string]bool{}
	for _, row := range a.pull(0).Todos {
		got[row["id"].(string)] = row["folder_id"] == nil
	}
	if !got[good1] || !got[good2] || !got[zeroFolder] || len(got) != 3 {
		t.Fatalf("stored: %v", got)
	}
	// 0 UUID로 '옮기기'도 기본 폴더로 옮기기로 본다
	if r := a.push(update("todo", good1, "folder_id", nil, uuid.Nil.String())); r[0].Status != "ok" {
		t.Fatalf("move to nil uuid: %+v", r)
	}
	// DB 제약에 걸린 op를 다시 보내도 같은 결과(재전송 기록)
	if r := a.push(nul); r[0].Status != "invalid" {
		t.Fatalf("replay bad op: %+v", r)
	}
}

// 이미 서버에 있는 행에 '만들기'가 오면(로그아웃 뒤 다시 로그인해 전부 올림 등) 서버 것을 덮어쓰지 않는다.
func TestCreateOnExistingKeepsServer(t *testing.T) {
	srv := newTestServer(t)
	a := signup(t, srv, "recreate@example.com")
	id := uuid.NewString()
	a.push(todo(id, "", "v1"))
	a.push(update("todo", id, "text", "v1", "다른 기기가 고친 v2"), update("todo", id, "done_at", nil, 9))
	// 이 기기는 옛 v1(완료 전)을 다시 '만들기'로 올린다
	rs := a.push(todo(id, "", "v1"))
	if rs[0].Status != "conflict" || rs[0].CopyID == "" {
		t.Fatalf("result: %+v", rs)
	}
	rows := map[string]map[string]any{}
	for _, row := range a.pull(0).Todos {
		rows[row["id"].(string)] = row
	}
	if rows[id]["text"] != "다른 기기가 고친 v2" || rows[id]["done_at"] != float64(9) {
		t.Fatalf("server row overwritten: %v", rows[id])
	}
	if rows[rs[0].CopyID]["text"] != "v1" {
		t.Fatalf("local text should survive as a copy: %v", rows[rs[0].CopyID])
	}
	// 같은 내용이면 아무 일도 없다
	if r := a.push(todo(id, "", "다른 기기가 고친 v2")); r[0].Status != "ok" {
		t.Fatalf("same content: %+v", r)
	}
}

// 영구 삭제된 id로 오는 op는 gone: 클라이언트가 자기 쪽 행도 지운다(백업에서 되살린 항목 등)
func TestTombstonedOpIsGone(t *testing.T) {
	srv := newTestServer(t)
	a := signup(t, srv, "gone@example.com")
	id := uuid.NewString()
	a.push(todo(id, "", "지울 것"))
	a.push(map[string]any{"op_id": uuid.NewString(), "entity": "todo", "id": id, "fields": map[string]any{"purged": map[string]any{"old": false, "new": true}}})
	if r := a.push(todo(id, "", "백업에서 되살림")); r[0].Status != "gone" {
		t.Fatalf("recreate tombstoned: %+v", r)
	}
}

// 오류에는 앱이 번역할 code가 붙고, 서버가 그리는 페이지는 브라우저 언어를 따른다.
func TestErrorCodesAndPageLanguage(t *testing.T) {
	srv := newTestServer(t)
	a := signup(t, srv, "lang@example.com")
	c := &client{t: t, srv: srv}
	var e map[string]string
	if code := c.do("POST", "/api/auth/register", map[string]string{"email": "lang@example.com", "password": "password123"}, &e); code != 409 || e["code"] != "email_taken" {
		t.Fatalf("email_taken: %d %v", code, e)
	}
	c.do("POST", "/api/auth/register", map[string]string{"email": "nope", "password": "password123"}, &e)
	if e["code"] != "invalid_email" {
		t.Fatalf("invalid_email: %v", e)
	}
	folder := uuid.NewString()
	a.push(create("folder", folder, map[string]any{"name": "Work", "position": "a0", "created_at": 1, "updated_at": 1}))
	a.do("POST", "/api/folders/"+folder+"/members", map[string]string{"email": "nobody@example.com", "role": "view"}, &e)
	if e["code"] != "user_not_found" {
		t.Fatalf("user_not_found: %v", e)
	}
	var lk link
	a.do("POST", "/api/folders/"+folder+"/links", nil, &lk)
	for lang, want := range map[string]string{"": "이 링크를", "ja-JP,ja;q=0.9": "このリンク", "zh-CN": "任何拥有", "fr-FR,en;q=0.8": "Anyone with", "de": "Anyone with"} {
		req, _ := http.NewRequest("GET", srv.URL+lk.Path, nil)
		if lang != "" {
			req.Header.Set("Accept-Language", lang)
		}
		resp, _ := http.DefaultClient.Do(req)
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if !strings.Contains(string(body), want) {
			t.Fatalf("Accept-Language %q: page missing %q", lang, want)
		}
	}
}

// 빈 동기화(30초마다)에 공유 폴더의 항목 id 전체를 매번 보내지 않는다: 요약이 같으면 목록 대신 foreign_same
func TestForeignDigestSkipsUnchangedList(t *testing.T) {
	srv := newTestServer(t)
	owner := signup(t, srv, "owner@example.com")
	guest := signup(t, srv, "guest@example.com")
	work := uuid.NewString()
	owner.push(create("folder", work, map[string]any{"name": "업무", "position": "V", "created_at": 1, "updated_at": 1}))
	owner.push(todo(uuid.NewString(), work, "하나"), todo(uuid.NewString(), work, "둘"))
	if code := owner.do("POST", "/api/folders/"+work+"/members", map[string]string{"email": "guest@example.com", "role": "view"}, nil); code != 201 {
		t.Fatalf("invite: %d", code)
	}
	first := guest.pull(0) // 예전 앱(fd 없음): 늘 목록
	if len(first.ForeignIDs) != 3 || first.ForeignDigest == "" || first.ForeignSame {
		t.Fatalf("first: %+v", first)
	}
	same := guest.pullFD(first.Cursor, first.ForeignDigest)
	if !same.ForeignSame || same.ForeignIDs != nil || same.ForeignDigest != first.ForeignDigest || len(same.Shared) != 1 {
		t.Fatalf("unchanged: %+v", same)
	}
	// 공유 폴더 안 항목이 늘면 요약이 달라져 목록을 다시 준다
	owner.push(todo(uuid.NewString(), work, "셋"))
	changed := guest.pullFD(same.Cursor, first.ForeignDigest)
	if changed.ForeignSame || len(changed.ForeignIDs) != 4 || changed.ForeignDigest == first.ForeignDigest {
		t.Fatalf("changed: %+v", changed)
	}
}
