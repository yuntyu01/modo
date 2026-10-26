package api

import (
	"context"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"
)

// 바로 받기(사용자 요청 2026-10-25: 휴대폰에서 지운 것이 PC에는 다음 동기화 주기(30초)에야 보였다).
// GET /api/sync/wait?since=커서 : 커서 뒤에 이 사람이 받을 변경이 생기면 바로, 없으면 최대 25초 기다렸다가 답한다.
// changed=true면 앱이 바로 동기화(pull)한다. 기다리는 동안 DB 연결은 쥐지 않는다.
// 누가 push하면 기다리는 요청을 모두 깨워 각자 자기 것이 있는지 한 번 확인한다(서버가 하나라 프로세스 안 알림으로 충분).
// push 말고 다른 길로 바뀐 것(공유 · 삭제 정리 등)도 놓치지 않게 몇 초마다 한 번 더 본다.
const (
	waitMax     = 25 * time.Second
	waitRecheck = 10 * time.Second
)

// changeHub: 바뀜 알림. 기다리는 쪽은 next()로 받은 채널이 닫히기를 기다리고, bump()가 그 채널을 닫는다(다음 기다림은 새 채널).
type changeHub struct {
	mu sync.Mutex
	ch chan struct{}
}

func (h *changeHub) next() <-chan struct{} {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.ch == nil {
		h.ch = make(chan struct{})
	}
	return h.ch
}

func (h *changeHub) bump() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.ch != nil {
		close(h.ch)
		h.ch = nil
	}
}

func (s *Server) wait(w http.ResponseWriter, r *http.Request) {
	u := userFrom(r.Context())
	since, _ := strconv.ParseInt(r.URL.Query().Get("since"), 10, 64)
	// max(초): 더 짧게 기다리기(테스트·느린 프록시). 25초보다 길게는 못 한다
	limit := waitMax
	if sec, err := strconv.Atoi(r.URL.Query().Get("max")); err == nil && sec > 0 && time.Duration(sec)*time.Second < limit {
		limit = time.Duration(sec) * time.Second
	}
	deadline := time.Now().Add(limit)
	for {
		// 확인하기 전에 받아 둔다: 확인과 기다림 사이에 들어온 push도 깨운다
		woke := s.changes.next()
		changed, err := s.hasChanges(r.Context(), u.ID, since)
		if err != nil {
			if r.Context().Err() == nil {
				serverError(w, err)
			}
			return
		}
		left := time.Until(deadline)
		if changed || left <= 0 {
			writeJSON(w, http.StatusOK, map[string]any{"changed": changed})
			return
		}
		timer := time.NewTimer(min(left, waitRecheck))
		select {
		case <-woke:
		case <-timer.C:
		case <-r.Context().Done():
		}
		timer.Stop()
		if r.Context().Err() != nil {
			return
		}
	}
}

// 커서 뒤에 이 사람이 받을 변경이 있는지. pull과 같은 범위: 내 것 + 내 폴더 · 공유받은 폴더에 든 것
// + 공유받은 '전체'(주인의 폴더 없는 항목과 그 가짜 폴더 행 = 공유 행의 seq, 사용자 요청 2026-10-26)
func (s *Server) hasChanges(ctx context.Context, user uuid.UUID, since int64) (bool, error) {
	var changed bool
	err := s.db.QueryRow(ctx, `
		WITH f AS (SELECT folder_id AS id FROM folder_members WHERE user_id = $1 UNION ALL SELECT id FROM folders WHERE owner_id = $1),
			o AS (SELECT owner_id AS id FROM base_members WHERE user_id = $1)
		SELECT EXISTS (SELECT 1 FROM folders WHERE seq > $2 AND (owner_id = $1 OR id IN (SELECT id FROM f)))
			OR EXISTS (SELECT 1 FROM base_members WHERE user_id = $1 AND seq > $2)
			OR EXISTS (SELECT 1 FROM todos WHERE owner_id = $1 AND seq > $2)
			OR EXISTS (SELECT 1 FROM todos WHERE folder_id IN (SELECT id FROM f) AND seq > $2)
			OR EXISTS (SELECT 1 FROM todos WHERE owner_id IN (SELECT id FROM o) AND seq > $2)
			OR EXISTS (SELECT 1 FROM paragraphs WHERE owner_id = $1 AND seq > $2)
			OR EXISTS (SELECT 1 FROM paragraphs WHERE folder_id IN (SELECT id FROM f) AND seq > $2)
			OR EXISTS (SELECT 1 FROM paragraphs WHERE owner_id IN (SELECT id FROM o) AND seq > $2)
			OR EXISTS (SELECT 1 FROM tombstones WHERE owner_id = $1 AND seq > $2)
			OR EXISTS (SELECT 1 FROM tombstones WHERE folder_id IN (SELECT id FROM f) AND seq > $2)
			OR EXISTS (SELECT 1 FROM tombstones WHERE owner_id IN (SELECT id FROM o) AND seq > $2)`, user, since).Scan(&changed)
	return changed, err
}
