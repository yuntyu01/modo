package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/google/uuid"
)

type friendsResp struct {
	Friends []struct {
		ID      string `json:"id"`
		Email   string `json:"email"`
		Folders []struct {
			FolderID   string `json:"folder_id"`
			Role       string `json:"role"`
			FriendRole string `json:"friend_role"`
			Mine       bool   `json:"mine"`
			Home       bool   `json:"home"`
		} `json:"folders"`
	} `json:"friends"`
	Incoming []struct {
		ID   string `json:"id"`
		User struct {
			ID    string `json:"id"`
			Email string `json:"email"`
		} `json:"user"`
	} `json:"incoming"`
	Outgoing []struct {
		ID string `json:"id"`
	} `json:"outgoing"`
}

func (c *client) friends() friendsResp {
	c.t.Helper()
	var r friendsResp
	if code := c.do("GET", "/api/friends", nil, &r); code != 200 {
		c.t.Fatalf("friends: %d", code)
	}
	return r
}

type searchResp struct {
	Code      string `json:"code"`
	Status    string `json:"status"`
	RequestID string `json:"request_id"`
	User      struct {
		ID    string `json:"id"`
		Email string `json:"email"`
	} `json:"user"`
}

func (c *client) search(email string) (int, searchResp) {
	c.t.Helper()
	var r searchResp
	code := c.do("GET", "/api/friends/search?email="+email, nil, &r)
	return code, r
}

type requestResp struct {
	Status    string `json:"status"`
	Code      string `json:"code"`
	RequestID string `json:"request_id"`
	Request   struct {
		ID string `json:"id"`
	} `json:"request"`
}

func (c *client) requestFriend(email string) (int, requestResp) {
	c.t.Helper()
	var r requestResp
	code := c.do("POST", "/api/friends/requests", map[string]string{"email": email}, &r)
	return code, r
}

// 고루틴에서 부르는 요청(t.Fatal을 부르지 않는다)
func rawDo(srv *httptest.Server, token, method, path string, body any) int {
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(method, srv.URL+path, &buf)
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return -1
	}
	res.Body.Close()
	return res.StatusCode
}

// 친구 맺기(테스트 준비)
func befriend(t *testing.T, a, b *client, bEmail string) {
	t.Helper()
	code, r := a.requestFriend(bEmail)
	if code != 201 {
		t.Fatalf("request %s: %d", bEmail, code)
	}
	if code := b.do("POST", "/api/friends/requests/"+r.Request.ID+"/accept", nil, nil); code != 200 {
		t.Fatalf("accept: %d", code)
	}
}

func TestFriendSearchAndRequest(t *testing.T) {
	srv := newTestServer(t)
	minji := signup(t, srv, "minji@example.com")
	subin := signup(t, srv, "subin@example.com")

	if code, r := minji.search("nobody@example.com"); code != 404 || r.Code != "user_not_found" {
		t.Fatalf("unknown: %d %+v", code, r)
	}
	if code, r := minji.search("minji@example.com"); code != 400 || r.Code != "self_friend" {
		t.Fatalf("self: %d %+v", code, r)
	}
	// 이메일 일부로는 찾지 않는다
	if code, _ := minji.search("subin"); code != 404 {
		t.Fatalf("partial email: %d", code)
	}
	// 검색만으로는 요청이 생기지 않는다
	if code, r := minji.search("Subin@Example.com"); code != 200 || r.Status != "none" || r.User.ID != subin.id {
		t.Fatalf("search: %d %+v", code, r)
	}
	if f := subin.friends(); len(f.Incoming) != 0 {
		t.Fatalf("search created a request: %+v", f)
	}

	code, first := minji.requestFriend(" Subin@Example.com ")
	if code != 201 || first.Status != "requested" || first.Request.ID == "" {
		t.Fatalf("request: %d %+v", code, first)
	}
	if code, r := minji.search("subin@example.com"); code != 200 || r.Status != "outgoing" || r.RequestID != first.Request.ID {
		t.Fatalf("search outgoing: %d %+v", code, r)
	}
	// 다시 보내도(재전송·두 번 누르기) 요청은 하나
	if code, again := minji.requestFriend("subin@example.com"); code != 200 || again.Request.ID != first.Request.ID {
		t.Fatalf("again: %d %+v", code, again)
	}
	in := subin.friends()
	if len(in.Incoming) != 1 || in.Incoming[0].User.Email != "minji@example.com" {
		t.Fatalf("subin incoming: %+v", in)
	}
	// 반대 방향: 요청을 새로 만들지 않고 받은 요청을 수락하라고 알린다
	if code, r := subin.search("minji@example.com"); code != 200 || r.Status != "incoming" || r.RequestID != first.Request.ID {
		t.Fatalf("search incoming: %d %+v", code, r)
	}
	if code, r := subin.requestFriend("minji@example.com"); code != 409 || r.Code != "request_incoming" || r.RequestID != first.Request.ID {
		t.Fatalf("reverse request: %d %+v", code, r)
	}
	if f := subin.friends(); len(f.Incoming) != 1 || len(f.Outgoing) != 0 {
		t.Fatalf("reverse made a request: %+v", f)
	}
}

func TestFriendAcceptIsAtomicAndIdempotent(t *testing.T) {
	srv := newTestServer(t)
	minji := signup(t, srv, "minji@example.com")
	subin := signup(t, srv, "subin@example.com")
	_, r := minji.requestFriend("subin@example.com")
	// 보낸 사람은 수락할 수 없다
	if code := minji.do("POST", "/api/friends/requests/"+r.Request.ID+"/accept", nil, nil); code != 404 {
		t.Fatalf("sender accepted: %d", code)
	}
	// 두 기기에서 동시에 수락해도 친구는 한 번
	var wg sync.WaitGroup
	codes := make([]int, 4)
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codes[i] = rawDo(srv, subin.token, "POST", "/api/friends/requests/"+r.Request.ID+"/accept", nil)
		}(i)
	}
	wg.Wait()
	for _, c := range codes {
		if c != 200 {
			t.Fatalf("concurrent accept: %v", codes)
		}
	}
	a, b := minji.friends(), subin.friends()
	if len(a.Friends) != 1 || a.Friends[0].ID != subin.id || len(a.Outgoing) != 0 {
		t.Fatalf("minji friends: %+v", a)
	}
	if len(b.Friends) != 1 || b.Friends[0].ID != minji.id || len(b.Incoming) != 0 {
		t.Fatalf("subin friends: %+v", b)
	}
	if code, rr := subin.requestFriend("minji@example.com"); code != 409 || rr.Code != "already_friends" {
		t.Fatalf("already friends: %d %+v", code, rr)
	}
	// 친구를 끊은 뒤 옛 요청을 다시 수락해도 친구가 되살아나지 않는다
	if code := minji.do("DELETE", "/api/friends/"+subin.id, nil, nil); code != 204 {
		t.Fatalf("unfriend: %d", code)
	}
	subin.do("POST", "/api/friends/requests/"+r.Request.ID+"/accept", nil, nil)
	if f := minji.friends(); len(f.Friends) != 0 {
		t.Fatalf("stale accept recreated friendship: %+v", f)
	}
}

func TestFriendDeclineAndCancel(t *testing.T) {
	srv := newTestServer(t)
	doyun := signup(t, srv, "doyun@example.com")
	minji := signup(t, srv, "minji@example.com")
	stranger := signup(t, srv, "stranger@example.com")
	_, r := doyun.requestFriend("minji@example.com")
	id := r.Request.ID
	// 관계없는 사람은 거절·취소할 수 없다
	if code := stranger.do("POST", "/api/friends/requests/"+id+"/decline", nil, nil); code != 404 {
		t.Fatalf("stranger decline: %d", code)
	}
	// 받은 사람은 취소(DELETE)가 아니라 거절, 보낸 사람은 거절할 수 없다
	if code := minji.do("DELETE", "/api/friends/requests/"+id, nil, nil); code != 404 {
		t.Fatalf("recipient cancel: %d", code)
	}
	if code := doyun.do("POST", "/api/friends/requests/"+id+"/decline", nil, nil); code != 404 {
		t.Fatalf("sender decline: %d", code)
	}
	if code := minji.do("POST", "/api/friends/requests/"+id+"/decline", nil, nil); code != 204 {
		t.Fatalf("decline: %d", code)
	}
	if code := minji.do("POST", "/api/friends/requests/"+id+"/decline", nil, nil); code != 204 {
		t.Fatalf("decline twice: %d", code)
	}
	// 거절한 요청은 수락할 수 없고, 보낸 사람이 취소하려 하면 이미 처리됨
	if code := minji.do("POST", "/api/friends/requests/"+id+"/accept", nil, nil); code != 409 {
		t.Fatalf("accept declined: %d", code)
	}
	if code := doyun.do("DELETE", "/api/friends/requests/"+id, nil, nil); code != 409 {
		t.Fatalf("cancel declined: %d", code)
	}
	if f := doyun.friends(); len(f.Outgoing) != 0 || len(f.Friends) != 0 {
		t.Fatalf("after decline: %+v", f)
	}
	// 다시 보낼 수 있고, 보낸 사람이 취소하면 받은 사람 목록에서 빠진다
	code, r2 := doyun.requestFriend("minji@example.com")
	if code != 201 || r2.Request.ID == id {
		t.Fatalf("re-request: %d %+v", code, r2)
	}
	if code := doyun.do("DELETE", "/api/friends/requests/"+r2.Request.ID, nil, nil); code != 204 {
		t.Fatalf("cancel: %d", code)
	}
	if f := minji.friends(); len(f.Incoming) != 0 {
		t.Fatalf("after cancel: %+v", f)
	}
	if code := minji.do("POST", "/api/friends/requests/"+r2.Request.ID+"/accept", nil, nil); code != 409 {
		t.Fatalf("accept cancelled: %d", code)
	}
}

// 서로 동시에 요청해도 대기 중인 요청은 하나만 남는다(DB 제약)
func TestOppositeRequestsAtOnce(t *testing.T) {
	srv := newTestServer(t)
	jihun := signup(t, srv, "jihun@example.com")
	harin := signup(t, srv, "harin@example.com")
	var wg sync.WaitGroup
	codes := make([]int, 2)
	for i, c := range []struct {
		cl *client
		to string
	}{{jihun, "harin@example.com"}, {harin, "jihun@example.com"}} {
		wg.Add(1)
		go func(i int, cl *client, to string) {
			defer wg.Done()
			codes[i] = rawDo(srv, cl.token, "POST", "/api/friends/requests", map[string]string{"email": to})
		}(i, c.cl, c.to)
	}
	wg.Wait()
	f := jihun.friends()
	if len(f.Incoming)+len(f.Outgoing) != 1 {
		t.Fatalf("pending between the pair: %+v (codes %v)", f, codes)
	}
}

// 친구가 되어도 공유한 폴더만 보이고, 권한은 공유대로, 친구를 끊어도 공유는 그대로다.
func TestFriendsAndSharingAreSeparate(t *testing.T) {
	srv := newTestServer(t)
	minji := signup(t, srv, "minji@example.com")
	subin := signup(t, srv, "subin@example.com")
	trip, private := uuid.NewString(), uuid.NewString()
	minji.push(
		create("folder", trip, map[string]any{"name": "여행", "position": "V", "created_at": 1, "updated_at": 1}),
		create("folder", private, map[string]any{"name": "개인", "position": "W", "created_at": 1, "updated_at": 1}),
	)
	tripTodo := uuid.NewString()
	minji.push(todo(tripTodo, trip, "기차표 예매하기"), todo(uuid.NewString(), private, "비밀"))

	befriend(t, minji, subin, "subin@example.com")
	if p := subin.pull(0); len(p.Todos) != 0 || len(p.Folders) != 0 {
		t.Fatalf("friendship alone must not show folders: %+v", p)
	}
	if f := subin.friends(); len(f.Friends) != 1 || len(f.Friends[0].Folders) != 0 {
		t.Fatalf("no shared folders yet: %+v", f)
	}

	// 고른 폴더만(보기만): 친구에게는 다시 수락을 묻지 않고 id로 공유한다
	if code := minji.do("POST", "/api/folders/"+trip+"/members", map[string]string{"user_id": subin.id, "role": "view"}, nil); code != 201 {
		t.Fatalf("share: %d", code)
	}
	if p := subin.pull(0); len(p.Folders) != 1 || len(p.Todos) != 1 || p.Todos[0]["id"] != tripTodo {
		t.Fatalf("only the shared folder: %+v", p)
	}
	mine, theirs := minji.friends(), subin.friends()
	if fs := mine.Friends[0].Folders; len(fs) != 1 || fs[0].Role != "owner" || fs[0].FriendRole != "view" || !fs[0].Mine {
		t.Fatalf("owner view: %+v", mine)
	}
	if fs := theirs.Friends[0].Folders; len(fs) != 1 || fs[0].Role != "view" || fs[0].FriendRole != "owner" || fs[0].Mine || !fs[0].Home {
		t.Fatalf("member view: %+v", theirs)
	}
	// 보기만: API로 직접 고쳐도 막힌다(완료·글·새 할 일·메모)
	if r := subin.push(update("todo", tripTodo, "done_at", nil, 7)); r[0].Status != "forbidden" {
		t.Fatalf("view complete: %+v", r)
	}
	if r := subin.push(update("todo", tripTodo, "text", "기차표 예매하기", "바꿈")); r[0].Status != "forbidden" {
		t.Fatalf("view edit: %+v", r)
	}
	if r := subin.push(todo(uuid.NewString(), trip, "새 할 일")); r[0].Status != "forbidden" {
		t.Fatalf("view create: %+v", r)
	}
	// 참여자는 폴더 이름·삭제·참여자를 바꿀 수 없다
	if r := subin.push(update("folder", trip, "name", "여행", "내 것")); r[0].Status != "forbidden" {
		t.Fatalf("member rename: %+v", r)
	}
	if code := subin.do("POST", "/api/folders/"+trip+"/members", map[string]string{"email": "minji@example.com", "role": "edit"}, nil); code != 403 {
		t.Fatalf("member invite: %d", code)
	}
	// 참여자는 누가 함께 쓰는지만 본다(바꿀 수 없음, 링크는 소유자만)
	var shares struct {
		CanManage bool `json:"can_manage"`
		MyRole    string `json:"my_role"`
		Members   []member `json:"members"`
		Links     []link `json:"links"`
	}
	if code := subin.do("GET", "/api/folders/"+trip+"/shares", nil, &shares); code != 200 || shares.CanManage || shares.MyRole != "view" || len(shares.Members) != 1 {
		t.Fatalf("member shares: %d %+v", code, shares)
	}

	// 함께 편집으로 바꾸면 고친 것이 양쪽에 보인다
	if code := minji.do("PATCH", "/api/folders/"+trip+"/members/"+subin.id, map[string]string{"role": "edit"}, nil); code != 204 {
		t.Fatalf("to edit: %d", code)
	}
	if r := subin.push(update("todo", tripTodo, "done_at", nil, 7)); r[0].Status != "ok" {
		t.Fatalf("edit complete: %+v", r)
	}
	if p := minji.pull(0); !hasTodo(p, tripTodo, "done_at", float64(7)) {
		t.Fatalf("owner should see member's completion: %+v", p.Todos)
	}
	// 권한을 다시 보기만으로: 오래 대기하던 쓰기는 서버가 막는다
	minji.do("PATCH", "/api/folders/"+trip+"/members/"+subin.id, map[string]string{"role": "view"}, nil)
	if r := subin.push(update("todo", tripTodo, "text", "기차표 예매하기", "늦게 보낸 수정")); r[0].Status != "forbidden" {
		t.Fatalf("stale outbox after downgrade: %+v", r)
	}

	// 친구를 끊어도 공유는 남는다
	if code := subin.do("DELETE", "/api/friends/"+minji.id, nil, nil); code != 204 {
		t.Fatalf("unfriend: %d", code)
	}
	if p := subin.pull(0); len(p.Folders) != 1 {
		t.Fatalf("share must survive unfriend: %+v", p)
	}
	// 친구가 아니면 id로 공유할 수 없다(이메일 공유는 그대로)
	if code := minji.do("POST", "/api/folders/"+private+"/members", map[string]string{"user_id": subin.id, "role": "view"}, nil); code != 404 {
		t.Fatalf("share by id to non-friend: %d", code)
	}
	// 참여자는 나갈 수 있고, 나가면 더 내려받지 않는다
	if code := subin.do("POST", "/api/folders/"+trip+"/leave", nil, nil); code != 204 {
		t.Fatalf("leave: %d", code)
	}
	if p := subin.pull(0); len(p.Folders) != 0 || len(p.Todos) != 0 {
		t.Fatalf("after leave: %+v", p)
	}
	if code := minji.do("POST", "/api/folders/"+trip+"/leave", nil, nil); code != 404 {
		t.Fatalf("owner leave: %d", code)
	}
}

func hasTodo(p pullResp, id, field string, want any) bool {
	for _, t := range p.Todos {
		if t["id"] == id && t[field] == want {
			return true
		}
	}
	return false
}

// 세 사람: 소유자 O의 폴더에 B와 C가 참여. B와 C는 친구라 서로의 탭에 같은 폴더(같은 id, 복제 없음)가 보인다.
// 홈 표시는 각자의 설정이라 다른 참여자에게 영향이 없다.
func TestThreePeopleOneFolderAndHome(t *testing.T) {
	srv := newTestServer(t)
	owner := signup(t, srv, "owner@example.com")
	b := signup(t, srv, "b@example.com")
	c := signup(t, srv, "c@example.com")
	folder := uuid.NewString()
	owner.push(create("folder", folder, map[string]any{"name": "같이", "position": "V", "created_at": 1, "updated_at": 1}))
	owner.push(todo(uuid.NewString(), folder, "함께 할 일"))
	owner.do("POST", "/api/folders/"+folder+"/members", map[string]string{"email": "b@example.com", "role": "edit"}, nil)
	owner.do("POST", "/api/folders/"+folder+"/members", map[string]string{"email": "c@example.com", "role": "view"}, nil)
	befriend(t, b, c, "c@example.com")

	bf, cf := b.friends(), c.friends()
	if fs := bf.Friends[0].Folders; len(fs) != 1 || fs[0].FolderID != folder || fs[0].Role != "edit" || fs[0].FriendRole != "view" {
		t.Fatalf("b's tab: %+v", bf)
	}
	if fs := cf.Friends[0].Folders; len(fs) != 1 || fs[0].FolderID != folder || fs[0].Role != "view" || fs[0].FriendRole != "edit" {
		t.Fatalf("c's tab: %+v", cf)
	}
	if p := b.pull(0); len(p.Folders) != 1 || len(p.Todos) != 1 {
		t.Fatalf("one folder, no copies: %+v", p)
	}

	// B만 홈에서 숨긴다: C·소유자는 그대로
	if code := b.do("PUT", "/api/folders/"+folder+"/home", map[string]bool{"home": false}, nil); code != 204 {
		t.Fatalf("hide: %d", code)
	}
	if code := owner.do("PUT", "/api/folders/"+folder+"/home", map[string]bool{"home": false}, nil); code != 404 {
		t.Fatalf("owner hide: %d", code)
	}
	var bp, cp struct {
		Shared []struct {
			FolderID string `json:"folder_id"`
			Home     bool   `json:"home"`
		} `json:"shared"`
	}
	b.do("GET", "/api/sync/pull?since=0", nil, &bp)
	c.do("GET", "/api/sync/pull?since=0", nil, &cp)
	if len(bp.Shared) != 1 || bp.Shared[0].Home || len(cp.Shared) != 1 || !cp.Shared[0].Home {
		t.Fatalf("home is personal: b %+v c %+v", bp, cp)
	}
	if fs := b.friends().Friends[0].Folders; fs[0].Home {
		t.Fatalf("b's friends folder should be hidden from home: %+v", fs)
	}
	if fs := c.friends().Friends[0].Folders; !fs[0].Home {
		t.Fatalf("c unaffected: %+v", fs)
	}
}

// 친구·요청 상태는 기존 동기화(pull)로 온다. 바뀐 게 없으면 요약만
func TestPullCarriesFriends(t *testing.T) {
	srv := newTestServer(t)
	minji := signup(t, srv, "minji@example.com")
	signup(t, srv, "subin@example.com")
	minji.requestFriend("subin@example.com")
	var p struct {
		Friends *friendsResp `json:"friends"`
		Digest  string       `json:"friends_digest"`
	}
	minji.do("GET", "/api/sync/pull?since=0", nil, &p)
	if p.Friends == nil || len(p.Friends.Outgoing) != 1 || p.Digest == "" {
		t.Fatalf("pull friends: %+v", p)
	}
	digest := p.Digest
	p.Friends = nil
	minji.do("GET", "/api/sync/pull?since=0&ffd="+digest, nil, &p)
	if p.Friends != nil || p.Digest != digest {
		t.Fatalf("unchanged friends should be omitted: %+v", p)
	}
}
