package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
)

// '전체'(폴더 없는 항목) 공유(사용자 요청 2026-10-26): 공유 경로·동기화에서 폴더 id 자리에 주인 사용자 id를 쓴다.

func sameIDs(got, want []string) bool {
	a, b := slices.Clone(got), slices.Clone(want)
	slices.Sort(a)
	slices.Sort(b)
	return slices.Equal(a, b)
}

func purgeOp(entity, id string) map[string]any {
	return map[string]any{"op_id": uuid.NewString(), "entity": entity, "id": id,
		"fields": map[string]any{"purged": map[string]any{"old": false, "new": true}}}
}

type sharesResp struct {
	Owner     person   `json:"owner"`
	CanManage bool     `json:"can_manage"`
	MyRole    string   `json:"my_role"`
	Members   []member `json:"members"`
	Links     []link   `json:"links"`
}

func TestBaseShare(t *testing.T) {
	srv, pool := newTestServerDB(t)
	ctx := context.Background()
	owner := signup(t, srv, "owner@example.com")
	friend := signup(t, srv, "friend@example.com")
	stranger := signup(t, srv, "stranger@example.com")
	base := "/api/folders/" + owner.id
	cols := func(id string) (folder, own *string) {
		pool.QueryRow(ctx, `SELECT folder_id::text, owner_id::text FROM todos WHERE id = $1`, id).Scan(&folder, &own)
		return
	}

	private := uuid.NewString()
	baseTodo, baseMemo, privTodo := uuid.NewString(), uuid.NewString(), uuid.NewString()
	owner.push(
		create("folder", private, map[string]any{"name": "개인", "position": "a1", "created_at": 1, "updated_at": 1}),
		todo(baseTodo, "", "전체 할 일"),
		create("paragraph", baseMemo, map[string]any{"text": "전체 메모", "position": "V", "created_at": 1, "updated_at": 1}),
		todo(privTodo, private, "비밀 할 일"),
	)

	// 친구가 아니면 공유할 수 없다(id로도 이메일로도)
	if code := owner.do("POST", base+"/members", map[string]string{"user_id": stranger.id, "role": "view"}, nil); code != 404 {
		t.Fatalf("non-friend by id: %d", code)
	}
	if code := owner.do("POST", base+"/members", map[string]string{"email": "stranger@example.com", "role": "view"}, nil); code != 404 {
		t.Fatalf("non-friend by email: %d", code)
	}
	befriend(t, owner, friend, "friend@example.com")

	// 친구의 커서가 주인 항목들의 seq보다 뒤에 있어도(공유 전에 동기화해 둠) 공유하면 전부 받는다
	friendOwn := uuid.NewString()
	friend.push(todo(friendOwn, "", "내 할 일"))
	before := friend.pull(0)
	if len(before.Todos) != 1 || len(before.Shared) != 0 || len(before.ForeignIDs) != 0 {
		t.Fatalf("before share: %+v", before)
	}
	var added member
	if code := owner.do("POST", base+"/members", map[string]string{"user_id": friend.id, "role": "view"}, &added); code != 201 || added.UserID.String() != friend.id || added.Role != "view" {
		t.Fatalf("share base: %d %+v", code, added)
	}
	if code := owner.do("POST", base+"/members", map[string]string{"user_id": friend.id, "role": "view"}, nil); code != 409 {
		t.Fatalf("share twice: %d", code)
	}

	// 가짜 폴더 행이 항목보다 먼저 온다(한 쪽씩 받아도 폴더가 먼저)
	var first pullResp
	if code := friend.do("GET", "/api/sync/pull?limit=1&since="+itoa(before.Cursor), nil, &first); code != 200 || len(first.Folders) != 1 || !first.More {
		t.Fatalf("first page: %d %+v", code, first)
	}

	p := friend.pull(before.Cursor)
	if len(p.Folders) != 1 {
		t.Fatalf("synthetic folder: %+v", p.Folders)
	}
	f := p.Folders[0]
	pos, _ := f["position"].(string)
	if f["id"] != owner.id || f["name"] != "전체" || f["deleted_at"] != nil || pos <= "a1" {
		t.Fatalf("synthetic folder row: %+v", f)
	}
	if c, _ := f["created_at"].(float64); c <= 0 || f["updated_at"] == nil {
		t.Fatalf("synthetic folder times: %+v", f)
	}
	got := map[string]any{}
	for _, row := range append(p.Todos, p.Paragraphs...) {
		got[row["id"].(string)] = row["folder_id"]
		if _, ok := row["owner_id"]; ok {
			t.Fatalf("owner_id leaked: %+v", row)
		}
	}
	if len(got) != 2 || got[baseTodo] != owner.id || got[baseMemo] != owner.id {
		t.Fatalf("base items: %+v", got)
	}
	if len(p.Shared) != 1 || p.Shared[0]["folder_id"] != owner.id || p.Shared[0]["role"] != "view" || p.Shared[0]["home"] != true {
		t.Fatalf("shared: %+v", p.Shared)
	}
	if o := p.Shared[0]["owner"].(map[string]any); o["id"] != owner.id || o["email"] != "owner@example.com" {
		t.Fatalf("shared owner: %+v", p.Shared)
	}
	if !sameIDs(p.ForeignIDs, []string{owner.id, baseTodo, baseMemo}) {
		t.Fatalf("foreign ids: %+v", p.ForeignIDs)
	}
	// 주인 자신에게는 그대로 폴더 없는 항목, 남에게는 아무것도
	for _, row := range owner.pull(0).Todos {
		if row["id"] == baseTodo && row["folder_id"] != nil {
			t.Fatalf("owner's own base item: %+v", row)
		}
	}
	if sp := stranger.pull(0); len(sp.Todos)+len(sp.Paragraphs)+len(sp.Folders)+len(sp.Shared)+len(sp.ForeignIDs) != 0 {
		t.Fatalf("stranger sees: %+v", sp)
	}

	// 보기만: 고치기·새 항목·영구 삭제를 막는다(공유받지 않은 사람도)
	for _, c := range []*client{friend, stranger} {
		if r := c.push(update("todo", baseTodo, "done_at", nil, 7)); r[0].Status != "forbidden" {
			t.Fatalf("view write: %+v", r)
		}
		if r := c.push(todo(uuid.NewString(), owner.id, "새 할 일")); r[0].Status != "forbidden" {
			t.Fatalf("view create: %+v", r)
		}
		if r := c.push(purgeOp("paragraph", baseMemo)); r[0].Status != "forbidden" {
			t.Fatalf("view purge: %+v", r)
		}
	}
	// '전체'는 폴더 행이 아니다: 이름 바꾸기, 사용자 id로 폴더 만들기를 받지 않는다
	if r := friend.push(update("folder", owner.id, "name", "전체", "바꿈")); r[0].Status != "forbidden" {
		t.Fatalf("rename base: %+v", r)
	}
	if r := owner.push(create("folder", friend.id, map[string]any{"name": "가짜", "position": "b", "created_at": 1, "updated_at": 1})); r[0].Status != "forbidden" {
		t.Fatalf("folder with user id: %+v", r)
	}
	if r := owner.push(create("folder", owner.id, map[string]any{"name": "가짜", "position": "b", "created_at": 1, "updated_at": 1})); r[0].Status != "forbidden" {
		t.Fatalf("folder with own id: %+v", r)
	}

	// 참여자는 공유를 바꿀 수 없고 누가 함께 쓰는지만 본다. 링크는 없다
	if code := friend.do("POST", base+"/members", map[string]string{"user_id": stranger.id, "role": "edit"}, nil); code != 403 {
		t.Fatalf("member invite: %d", code)
	}
	var sh sharesResp
	if code := friend.do("GET", base+"/shares", nil, &sh); code != 200 || sh.CanManage || sh.MyRole != "view" || len(sh.Members) != 1 || sh.Owner.ID.String() != owner.id {
		t.Fatalf("member shares: %d %+v", code, sh)
	}
	sh = sharesResp{}
	if code := owner.do("GET", base+"/shares", nil, &sh); code != 200 || !sh.CanManage || sh.MyRole != "owner" || len(sh.Members) != 1 || sh.Members[0].UserID.String() != friend.id || len(sh.Links) != 0 {
		t.Fatalf("owner shares: %d %+v", code, sh)
	}
	if code := stranger.do("GET", base+"/shares", nil, nil); code != 404 {
		t.Fatalf("stranger shares: %d", code)
	}
	if code := owner.do("POST", base+"/links", nil, nil); code != 400 {
		t.Fatalf("base link: %d", code)
	}

	// 친구 목록에도 같은 모양으로(folder_id = 주인 id)
	of := owner.friends().Friends[0].Folders
	if len(of) != 1 || of[0].FolderID != owner.id || of[0].Role != "owner" || of[0].FriendRole != "view" || !of[0].Mine {
		t.Fatalf("owner's friend folders: %+v", of)
	}
	ff := friend.friends().Friends[0].Folders
	if len(ff) != 1 || ff[0].FolderID != owner.id || ff[0].Role != "view" || ff[0].FriendRole != "owner" || ff[0].Mine || !ff[0].Home {
		t.Fatalf("friend's friend folders: %+v", ff)
	}

	// 함께 편집: 친구가 고치고 만든 것이 주인의 '전체'에(folder_id 없음, owner_id = 주인)
	if code := owner.do("PATCH", base+"/members/"+friend.id, map[string]string{"role": "edit"}, nil); code != 204 {
		t.Fatalf("to edit: %d", code)
	}
	p2 := friend.pull(p.Cursor)
	if len(p2.Shared) != 1 || p2.Shared[0]["role"] != "edit" || len(p2.Folders) != 1 {
		t.Fatalf("after role change: %+v", p2)
	}
	if r := friend.push(update("todo", baseTodo, "done_at", nil, 7)); r[0].Status != "ok" {
		t.Fatalf("edit write: %+v", r)
	}
	nt := uuid.NewString()
	if r := friend.push(todo(nt, owner.id, "친구가 추가")); r[0].Status != "ok" {
		t.Fatalf("edit create: %+v", r)
	}
	if fc, oc := cols(nt); fc != nil || oc == nil || *oc != owner.id {
		t.Fatalf("member-created base item: folder %v owner %v", fc, oc)
	}
	op := owner.pull(0)
	if !hasTodo(op, nt, "folder_id", nil) || !hasTodo(op, baseTodo, "done_at", float64(7)) {
		t.Fatalf("owner should see member's edits in own base: %+v", op.Todos)
	}
	if fp := friend.pull(p2.Cursor); !hasTodo(fp, nt, "folder_id", owner.id) {
		t.Fatalf("member sees own creation in owner's base: %+v", fp.Todos)
	}
	// 편집자라도 '전체' 밖(내 전체, 주인의 공유 안 한 폴더)으로 못 옮기고, 내 것을 주인의 '전체'로 넣지도 못한다
	if r := friend.push(update("todo", baseTodo, "folder_id", owner.id, nil)); r[0].Status != "forbidden" {
		t.Fatalf("move out to own base: %+v", r)
	}
	if r := friend.push(update("todo", baseTodo, "folder_id", owner.id, private)); r[0].Status != "forbidden" {
		t.Fatalf("move into private folder: %+v", r)
	}
	if r := friend.push(update("todo", friendOwn, "folder_id", nil, owner.id)); r[0].Status != "forbidden" {
		t.Fatalf("move own item into owner's base: %+v", r)
	}
	// 주인의 다른 공유 폴더(편집)와 주인의 '전체' 사이는 옮길 수 있다(같은 주인 안)
	work, wt := uuid.NewString(), uuid.NewString()
	owner.push(create("folder", work, map[string]any{"name": "업무", "position": "a2", "created_at": 1, "updated_at": 1}))
	owner.push(todo(wt, work, "업무 할 일"))
	if code := owner.do("POST", "/api/folders/"+work+"/members", map[string]string{"user_id": friend.id, "role": "edit"}, nil); code != 201 {
		t.Fatalf("share work: %d", code)
	}
	if r := friend.push(update("todo", wt, "folder_id", work, owner.id)); r[0].Status != "ok" {
		t.Fatalf("folder → owner's base: %+v", r)
	}
	if fc, oc := cols(wt); fc != nil || oc == nil || *oc != owner.id {
		t.Fatalf("moved into base: folder %v owner %v", fc, oc)
	}
	if r := friend.push(update("todo", wt, "folder_id", owner.id, work)); r[0].Status != "ok" {
		t.Fatalf("owner's base → folder: %+v", r)
	}
	if fc, oc := cols(wt); fc == nil || *fc != work || oc != nil {
		t.Fatalf("moved back: folder %v owner %v", fc, oc)
	}
	// 영구 삭제도 편집자는 할 수 있고, 주인에게 지운 것으로 간다
	oc := owner.pull(0).Cursor
	if r := friend.push(purgeOp("paragraph", baseMemo)); r[0].Status != "ok" {
		t.Fatalf("edit purge: %+v", r)
	}
	if d := owner.pull(oc).Deleted; len(d) != 1 || d[0]["id"] != baseMemo {
		t.Fatalf("owner gets tombstone: %+v", d)
	}

	// 홈 표시는 참여자 각자의 설정
	if code := friend.do("PUT", base+"/home", map[string]bool{"home": false}, nil); code != 204 {
		t.Fatalf("hide: %d", code)
	}
	if code := owner.do("PUT", base+"/home", map[string]bool{"home": false}, nil); code != 404 {
		t.Fatalf("owner hide: %d", code)
	}
	for _, s := range friend.pull(0).Shared {
		if s["folder_id"] == owner.id && s["home"] != false {
			t.Fatalf("home not saved: %+v", s)
		}
	}

	// 공유를 끊으면 더 내려받지 않고, foreign_ids에서 빠져 앱이 지운다. 늦게 온 쓰기도 막는다
	if code := owner.do("DELETE", base+"/members/"+friend.id, nil, nil); code != 204 {
		t.Fatalf("remove: %d", code)
	}
	after := friend.pull(0)
	for _, id := range after.ForeignIDs {
		if id == owner.id || id == baseTodo || id == nt {
			t.Fatalf("base still foreign after removal: %+v", after.ForeignIDs)
		}
	}
	for _, row := range append(after.Todos, after.Paragraphs...) {
		if row["folder_id"] == owner.id {
			t.Fatalf("base item after removal: %+v", row)
		}
	}
	for _, row := range after.Folders {
		if row["id"] == owner.id {
			t.Fatalf("base folder after removal: %+v", row)
		}
	}
	if len(after.Shared) != 1 || after.Shared[0]["folder_id"] != work {
		t.Fatalf("shared after removal: %+v", after.Shared)
	}
	if r := friend.push(update("todo", baseTodo, "text", "전체 할 일", "몰래")); r[0].Status != "forbidden" {
		t.Fatalf("write after removal: %+v", r)
	}
	if fs := friend.friends().Friends[0].Folders; len(fs) != 1 || fs[0].FolderID != work {
		t.Fatalf("friends after removal: %+v", fs)
	}

	// 다시 공유한 뒤 참여자가 나가기. 주인은 자기 '전체'에서 나갈 수 없다
	if code := owner.do("POST", base+"/members", map[string]string{"email": "friend@example.com", "role": "view"}, nil); code != 201 {
		t.Fatalf("re-share by email (friend): %d", code)
	}
	if p := friend.pull(0); !sameIDs(p.ForeignIDs, []string{work, wt, owner.id, baseTodo, nt}) {
		t.Fatalf("re-shared foreign ids: %+v", p.ForeignIDs)
	}
	if code := friend.do("POST", base+"/leave", nil, nil); code != 204 {
		t.Fatalf("leave: %d", code)
	}
	if code := owner.do("POST", base+"/leave", nil, nil); code != 404 {
		t.Fatalf("owner leave: %d", code)
	}
	if p := friend.pull(0); !sameIDs(p.ForeignIDs, []string{work, wt}) || len(p.Shared) != 1 {
		t.Fatalf("after leave: %+v", p)
	}
}

// 바로 받기(wait)도 pull과 같은 범위: 공유받은 '전체'의 항목이 바뀌면 깬다
func TestBaseShareWait(t *testing.T) {
	srv := newTestServer(t)
	owner := signup(t, srv, "owner@example.com")
	friend := signup(t, srv, "friend@example.com")
	befriend(t, owner, friend, "friend@example.com")
	owner.push(todo(uuid.NewString(), "", "처음 할 일"))
	cur := friend.pull(0).Cursor
	owner.push(todo(uuid.NewString(), "", "아직 나만 보는 할 일"))
	if changed, _, err := waitChanged(friend, cur, 1); err != nil || changed {
		t.Fatalf("before share: %v %v", changed, err)
	}
	if code := owner.do("POST", "/api/folders/"+owner.id+"/members", map[string]string{"user_id": friend.id, "role": "view"}, nil); code != 201 {
		t.Fatalf("share: %d", code)
	}
	if changed, _, err := waitChanged(friend, cur, 1); err != nil || !changed {
		t.Fatalf("after share: %v %v", changed, err)
	}
	cur = friend.pull(cur).Cursor
	if changed, _, err := waitChanged(friend, cur, 1); err != nil || changed {
		t.Fatalf("after pull: %v %v", changed, err)
	}
	// 기다리는 동안 주인이 '전체'에 적으면 push가 바로 깨운다
	type result struct {
		changed bool
		took    time.Duration
		err     error
	}
	got := make(chan result, 1)
	go func() {
		changed, took, err := waitChanged(friend, cur, 20)
		got <- result{changed, took, err}
	}()
	time.Sleep(300 * time.Millisecond)
	id := uuid.NewString()
	owner.push(todo(id, "", "새로 적음"))
	if r := <-got; r.err != nil || !r.changed || r.took > 5*time.Second {
		t.Fatalf("base push did not wake: %+v", r)
	}
	cur = friend.pull(cur).Cursor
	// 영구 삭제도 변경
	owner.push(purgeOp("todo", id))
	if changed, _, err := waitChanged(friend, cur, 1); err != nil || !changed {
		t.Fatalf("base purge: %v %v", changed, err)
	}
	cur = friend.pull(cur).Cursor
	// 권한 바꿈도(가짜 폴더 행이 다시 간다)
	if code := owner.do("PATCH", "/api/folders/"+owner.id+"/members/"+friend.id, map[string]string{"role": "edit"}, nil); code != 204 {
		t.Fatalf("to edit: %d", code)
	}
	if changed, _, err := waitChanged(friend, cur, 1); err != nil || !changed {
		t.Fatalf("role change: %v %v", changed, err)
	}
	cur = friend.pull(cur).Cursor
	// 주인의 공유하지 않은 폴더는 변경이 아니다
	private := uuid.NewString()
	owner.push(create("folder", private, map[string]any{"name": "개인", "position": "a1", "created_at": 1, "updated_at": 1}))
	owner.push(todo(uuid.NewString(), private, "비밀"))
	if changed, _, err := waitChanged(friend, cur, 1); err != nil || changed {
		t.Fatalf("private folder: %v %v", changed, err)
	}
}

// 앱은 providers의 baseShare가 true일 때만 '전체' 공유를 보인다(예전 서버는 이 값이 없다). DB 없이 돈다
func TestProvidersBaseShare(t *testing.T) {
	s := New(nil, Config{})
	mux := http.NewServeMux()
	s.Routes(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/auth/providers", nil))
	var p map[string]bool
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil || !p["baseShare"] {
		t.Fatalf("providers: %s", rec.Body.String())
	}
}

// 계정을 지우면 그 사람이 주인이든 참여자든 '전체' 공유가 함께 지워진다(FK CASCADE)
func TestBaseShareAccountDeletion(t *testing.T) {
	j, err := OpenErasureJournal(filepath.Join(t.TempDir(), "journal.json"))
	if err != nil {
		t.Fatal(err)
	}
	previous := testConfig
	testConfig.Erasures = j
	t.Cleanup(func() { testConfig = previous })
	srv, pool := newTestServerDB(t)
	ctx := context.Background()
	owner := signup(t, srv, "owner@example.test")
	member := signup(t, srv, "member@example.test")
	other := signup(t, srv, "other@example.test")
	befriend(t, owner, member, "member@example.test")
	befriend(t, owner, other, "other@example.test")
	baseTodo := uuid.NewString()
	owner.push(todo(baseTodo, "", "주인의 전체"))
	for _, c := range []struct {
		by *client
		to string
	}{{owner, member.id}, {owner, other.id}, {member, owner.id}} {
		if code := c.by.do("POST", "/api/folders/"+c.by.id+"/members", map[string]string{"user_id": c.to, "role": "edit"}, nil); code != 201 {
			t.Fatalf("share: %d", code)
		}
	}
	count := func() (n int) {
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM base_members`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return
	}
	if n := count(); n != 3 {
		t.Fatalf("base_members: %d", n)
	}
	// 참여자(이면서 자기 '전체'의 주인)가 지우면 그 사람이 낀 공유 둘이 지워진다
	if code := member.do("DELETE", "/api/me", map[string]string{"confirmation": "DELETE"}, nil); code != 204 {
		t.Fatalf("delete member: %d", code)
	}
	if n := count(); n != 1 {
		t.Fatalf("after member deletion: %d", n)
	}
	if p := other.pull(0); len(p.Shared) != 1 || !hasTodo(p, baseTodo, "folder_id", owner.id) {
		t.Fatalf("other member keeps the share: %+v", p)
	}
	// 주인이 지우면 공유와 항목이 함께 지워지고 남은 참여자의 목록에서 빠진다
	if code := owner.do("DELETE", "/api/me", map[string]string{"confirmation": "DELETE"}, nil); code != 204 {
		t.Fatalf("delete owner: %d", code)
	}
	if n := count(); n != 0 {
		t.Fatalf("after owner deletion: %d", n)
	}
	if p := other.pull(0); len(p.Shared) != 0 || len(p.Todos) != 0 || len(p.ForeignIDs) != 0 {
		t.Fatalf("after owner deletion: %+v", p)
	}
}
