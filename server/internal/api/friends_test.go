package api

import (
	"testing"

	"github.com/google/uuid"
)

type friendsResp struct {
	Friends []struct {
		ID      string `json:"id"`
		Email   string `json:"email"`
		Folders []struct {
			FolderID string `json:"folder_id"`
			Role     string `json:"role"`
			Mine     bool   `json:"mine"`
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

type requestResp struct {
	Status  string `json:"status"`
	Code    string `json:"code"`
	Request struct {
		ID string `json:"id"`
	} `json:"request"`
	Friend struct {
		ID string `json:"id"`
	} `json:"friend"`
}

func (c *client) requestFriend(email string) (int, requestResp) {
	c.t.Helper()
	var r requestResp
	code := c.do("POST", "/api/friends/requests", map[string]string{"email": email}, &r)
	return code, r
}

func TestFriendRequestsAndAccept(t *testing.T) {
	srv := newTestServer(t)
	minji := signup(t, srv, "minji@example.com")
	subin := signup(t, srv, "subin@example.com")

	if code, r := minji.requestFriend("minji@example.com"); code != 400 || r.Code != "self_friend" {
		t.Fatalf("self: %d %+v", code, r)
	}
	if code, r := minji.requestFriend("nobody@example.com"); code != 404 || r.Code != "user_not_found" {
		t.Fatalf("unknown: %d %+v", code, r)
	}
	code, first := minji.requestFriend(" Subin@Example.com ")
	if code != 201 || first.Status != "requested" || first.Request.ID == "" {
		t.Fatalf("request: %d %+v", code, first)
	}
	// 다시 보내도 요청은 하나(처음 것을 돌려준다)
	if code, again := minji.requestFriend("subin@example.com"); code != 201 || again.Request.ID != first.Request.ID {
		t.Fatalf("again: %d %+v", code, again)
	}
	if out := minji.friends(); len(out.Outgoing) != 1 || len(out.Friends) != 0 {
		t.Fatalf("minji outgoing: %+v", out)
	}
	in := subin.friends()
	if len(in.Incoming) != 1 || in.Incoming[0].User.Email != "minji@example.com" {
		t.Fatalf("subin incoming: %+v", in)
	}
	// 받은 사람만 수락할 수 있다
	if code := minji.do("POST", "/api/friends/requests/"+first.Request.ID+"/accept", nil, nil); code != 404 {
		t.Fatalf("sender accepted own request: %d", code)
	}
	if code := subin.do("POST", "/api/friends/requests/"+first.Request.ID+"/accept", nil, nil); code != 200 {
		t.Fatalf("accept: %d", code)
	}
	a, b := minji.friends(), subin.friends()
	if len(a.Friends) != 1 || a.Friends[0].ID != subin.id || len(a.Outgoing) != 0 {
		t.Fatalf("minji friends: %+v", a)
	}
	if len(b.Friends) != 1 || b.Friends[0].ID != minji.id || len(b.Incoming) != 0 {
		t.Fatalf("subin friends: %+v", b)
	}
	if code, r := subin.requestFriend("minji@example.com"); code != 409 || r.Code != "already_friends" {
		t.Fatalf("already friends: %d %+v", code, r)
	}
}

func TestFriendRequestBothWaysAccepts(t *testing.T) {
	srv := newTestServer(t)
	jihun := signup(t, srv, "jihun@example.com")
	harin := signup(t, srv, "harin@example.com")
	if code, _ := jihun.requestFriend("harin@example.com"); code != 201 {
		t.Fatalf("request: %d", code)
	}
	// 상대가 이미 보낸 요청이 있으면 바로 친구
	code, r := harin.requestFriend("jihun@example.com")
	if code != 200 || r.Status != "accepted" || r.Friend.ID != jihun.id {
		t.Fatalf("mutual: %d %+v", code, r)
	}
	if f := jihun.friends(); len(f.Friends) != 1 || len(f.Outgoing) != 0 || len(f.Incoming) != 0 {
		t.Fatalf("after mutual: %+v", f)
	}
}

func TestFriendRequestDeclineAndCancel(t *testing.T) {
	srv := newTestServer(t)
	doyun := signup(t, srv, "doyun@example.com")
	minji := signup(t, srv, "minji@example.com")
	stranger := signup(t, srv, "stranger@example.com")
	_, r := doyun.requestFriend("minji@example.com")
	// 관계없는 사람은 지울 수 없다
	if code := stranger.do("DELETE", "/api/friends/requests/"+r.Request.ID, nil, nil); code != 404 {
		t.Fatalf("stranger delete: %d", code)
	}
	if code := minji.do("DELETE", "/api/friends/requests/"+r.Request.ID, nil, nil); code != 204 {
		t.Fatalf("decline: %d", code)
	}
	if code := minji.do("DELETE", "/api/friends/requests/"+r.Request.ID, nil, nil); code != 404 {
		t.Fatalf("decline twice: %d", code)
	}
	if f := doyun.friends(); len(f.Outgoing) != 0 || len(f.Friends) != 0 {
		t.Fatalf("after decline: %+v", f)
	}
	// 보낸 사람은 취소할 수 있다
	_, r = doyun.requestFriend("minji@example.com")
	if code := doyun.do("DELETE", "/api/friends/requests/"+r.Request.ID, nil, nil); code != 204 {
		t.Fatalf("cancel: %d", code)
	}
	if f := minji.friends(); len(f.Incoming) != 0 {
		t.Fatalf("after cancel: %+v", f)
	}
}

// 친구가 되어도 공유한 폴더만 보이고, 친구를 끊어도 공유는 그대로다(둘은 따로 관리한다).
func TestFriendsAndSharingAreSeparate(t *testing.T) {
	srv := newTestServer(t)
	minji := signup(t, srv, "minji@example.com")
	subin := signup(t, srv, "subin@example.com")
	trip, private := uuid.NewString(), uuid.NewString()
	minji.push(
		create("folder", trip, map[string]any{"name": "여행", "position": "V", "created_at": 1, "updated_at": 1}),
		create("folder", private, map[string]any{"name": "개인", "position": "W", "created_at": 1, "updated_at": 1}),
	)
	minji.push(todo(uuid.NewString(), trip, "기차표 예매하기"), todo(uuid.NewString(), private, "비밀"))

	_, r := minji.requestFriend("subin@example.com")
	subin.do("POST", "/api/friends/requests/"+r.Request.ID+"/accept", nil, nil)
	if p := subin.pull(0); len(p.Todos) != 0 || len(p.Folders) != 0 {
		t.Fatalf("friendship alone must not show folders: %+v", p)
	}
	if f := subin.friends(); len(f.Friends) != 1 || len(f.Friends[0].Folders) != 0 {
		t.Fatalf("no shared folders yet: %+v", f)
	}

	if code := minji.do("POST", "/api/folders/"+trip+"/members", map[string]string{"email": "subin@example.com", "role": "edit"}, nil); code != 201 {
		t.Fatalf("share: %d", code)
	}
	mine, theirs := minji.friends(), subin.friends()
	if fs := mine.Friends[0].Folders; len(fs) != 1 || fs[0].FolderID != trip || fs[0].Role != "edit" || !fs[0].Mine {
		t.Fatalf("owner view: %+v", mine)
	}
	if fs := theirs.Friends[0].Folders; len(fs) != 1 || fs[0].FolderID != trip || fs[0].Role != "edit" || fs[0].Mine {
		t.Fatalf("member view: %+v", theirs)
	}
	if p := subin.pull(0); len(p.Folders) != 1 || len(p.Todos) != 1 {
		t.Fatalf("shared folder only: %+v", p)
	}
	// 친구에게는 사용자 id로도 공유한다. 친구가 아니면 id로 찾을 수 없다
	stranger := signup(t, srv, "stranger@example.com")
	if code := minji.do("POST", "/api/folders/"+private+"/members", map[string]string{"user_id": stranger.id, "role": "view"}, nil); code != 404 {
		t.Fatalf("share by id to non-friend: %d", code)
	}
	if code := minji.do("POST", "/api/folders/"+private+"/members", map[string]string{"user_id": subin.id, "role": "view"}, nil); code != 201 {
		t.Fatalf("share by id to friend: %d", code)
	}
	if fs := subin.friends().Friends[0].Folders; len(fs) != 2 {
		t.Fatalf("two shared folders: %+v", fs)
	}

	// 친구를 끊어도 공유는 남는다
	if code := subin.do("DELETE", "/api/friends/"+minji.id, nil, nil); code != 204 {
		t.Fatalf("unfriend: %d", code)
	}
	if code := subin.do("DELETE", "/api/friends/"+minji.id, nil, nil); code != 404 {
		t.Fatalf("unfriend twice: %d", code)
	}
	if f := minji.friends(); len(f.Friends) != 0 {
		t.Fatalf("still friends: %+v", f)
	}
	if p := subin.pull(0); len(p.Folders) != 2 || len(p.Todos) != 2 {
		t.Fatalf("shares must survive unfriend: %+v", p)
	}
}
