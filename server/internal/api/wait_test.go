package api

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
)

// 고루틴에서도 쓸 수 있게 t 없이 기다린다
func waitChanged(c *client, since int64, max int) (bool, time.Duration, error) {
	start := time.Now()
	req, _ := http.NewRequest("GET", c.srv.URL+"/api/sync/wait?since="+itoa(since)+"&max="+itoa(int64(max)), nil)
	req.Header.Set("Authorization", "Bearer "+c.token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		return false, 0, err
	}
	defer res.Body.Close()
	var out struct {
		Changed bool `json:"changed"`
	}
	err = json.NewDecoder(res.Body).Decode(&out)
	return out.Changed, time.Since(start), err
}

func TestSyncWait(t *testing.T) {
	srv := newTestServer(t)
	a := signup(t, srv, "a@example.com")
	b := signup(t, srv, "b@example.com")

	// 바뀐 것이 없으면 정한 만큼 기다렸다가 changed=false
	if changed, took, err := waitChanged(a, 0, 1); err != nil || changed || took < 900*time.Millisecond {
		t.Fatalf("변경 없음: %v %v %v", changed, took, err)
	}

	// 기다리는 동안 다른 기기(같은 계정)가 push하면 바로 깬다
	type result struct {
		changed bool
		took    time.Duration
		err     error
	}
	got := make(chan result, 1)
	go func() {
		changed, took, err := waitChanged(a, 0, 20)
		got <- result{changed, took, err}
	}()
	time.Sleep(300 * time.Millisecond)
	a.push(todo(uuid.NewString(), "", "휴대폰에서 적음"))
	r := <-got
	if r.err != nil || !r.changed || r.took > 5*time.Second {
		t.Fatalf("push에 깨지 않았다: %+v", r)
	}
	// 받은 뒤 커서로는 다시 기다린다
	cur := a.pull(0).Cursor
	if changed, _, err := waitChanged(a, cur, 1); err != nil || changed {
		t.Fatalf("이미 받은 변경: %v %v", changed, err)
	}
	// 지운 것(휴지통으로 보냄)도 변경
	id := uuid.NewString()
	a.push(todo(id, "", "지울 할 일"))
	cur = a.pull(cur).Cursor
	a.push(update("todo", id, "deleted_at", nil, 5))
	if changed, _, err := waitChanged(a, cur, 1); err != nil || !changed {
		t.Fatalf("지운 것: %v %v", changed, err)
	}

	// 남의 push로는 깨어도 내 것이 아니면 계속 기다린다
	bCur := b.pull(0).Cursor
	go func() {
		changed, took, err := waitChanged(b, bCur, 2)
		got <- result{changed, took, err}
	}()
	time.Sleep(300 * time.Millisecond)
	a.push(todo(uuid.NewString(), "", "나만 보는 할 일"))
	if r := <-got; r.err != nil || r.changed || r.took < 1900*time.Millisecond {
		t.Fatalf("남의 변경에 답했다: %+v", r)
	}

	// 공유받은 폴더에 든 것은 함께 쓰는 사람에게도 변경
	work := uuid.NewString()
	a.push(create("folder", work, map[string]any{"name": "함께", "position": "V", "created_at": 1, "updated_at": 1}))
	if code := a.do("POST", "/api/folders/"+work+"/members", map[string]string{"email": "b@example.com", "role": "edit"}, nil); code != 201 {
		t.Fatalf("invite: %d", code)
	}
	bCur = b.pull(bCur).Cursor
	if changed, _, err := waitChanged(b, bCur, 1); err != nil || changed {
		t.Fatalf("받은 뒤: %v %v", changed, err)
	}
	a.push(todo(uuid.NewString(), work, "같이 할 일"))
	if changed, _, err := waitChanged(b, bCur, 1); err != nil || !changed {
		t.Fatalf("공유 폴더 변경: %v %v", changed, err)
	}
}
