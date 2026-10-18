package api

import (
	"testing"

	"github.com/google/uuid"
)

func TestThemeSyncAndPopular(t *testing.T) {
	srv := newTestServer(t)
	a := signup(t, srv, "a@example.com")
	b := signup(t, srv, "b@example.com")
	c := signup(t, srv, "c@example.com")

	var st themeState
	if code := a.do("GET", "/api/me/theme", nil, &st); code != 200 || st.ID != nil || st.UpdatedAt != 0 {
		t.Fatalf("처음엔 테마 없음: %d %+v", code, st)
	}
	// 바꾼 시각이 늦은 쪽이 이긴다(PC에서 바꾼 뒤 휴대폰이 옛 값을 늦게 보내도 덮지 않는다)
	a.do("PUT", "/api/me/theme", map[string]any{"theme_id": "#87AA92", "updated_at": 200}, &st)
	if st.ID == nil || *st.ID != "#87AA92" || st.UpdatedAt != 200 {
		t.Fatalf("저장: %+v", st)
	}
	a.do("PUT", "/api/me/theme", map[string]any{"theme_id": "#85ADE2", "updated_at": 100}, &st)
	if *st.ID != "#87AA92" {
		t.Fatalf("옛 값이 덮었다: %+v", st)
	}
	if code := a.do("PUT", "/api/me/theme", map[string]any{"theme_id": "red", "updated_at": 300}, nil); code != 400 {
		t.Fatalf("잘못된 값: %d", code)
	}

	// 인기: 지금 쓰는 색 기준, 계정당 한 표(같은 계정이 여러 번 바꿔도 마지막 한 색만)
	b.do("PUT", "/api/me/theme", map[string]any{"theme_id": "#87AA92", "updated_at": 1}, nil)
	c.do("PUT", "/api/me/theme", map[string]any{"theme_id": "#9EA0D1", "updated_at": 1}, nil)
	c.do("PUT", "/api/me/theme", map[string]any{"theme_id": "#E4A38E", "updated_at": 2}, nil)
	var pop popularThemes
	if code := (&client{t: t, srv: srv}).do("GET", "/api/themes/popular", nil, &pop); code != 200 {
		t.Fatalf("popular: %d", code)
	}
	if pop.Total != 3 || len(pop.Themes) != 2 || pop.Themes[0].ID != "#87AA92" || pop.Themes[0].Users != 2 || pop.Themes[1].ID != "#E4A38E" {
		t.Fatalf("집계: %+v", pop)
	}
	// 하루 동안은 같은 순위(그 사이 바뀐 색은 다음 날 반영)
	a.do("PUT", "/api/me/theme", map[string]any{"theme_id": "#E4A38E", "updated_at": 500}, nil)
	var again popularThemes
	(&client{t: t, srv: srv}).do("GET", "/api/themes/popular", nil, &again)
	if again.Themes[0].ID != "#87AA92" || again.Themes[0].Users != 2 {
		t.Fatalf("하루 안에 순위가 바뀌었다: %+v", again)
	}
}

func TestDoneLogMergesAcrossDevices(t *testing.T) {
	srv := newTestServer(t)
	a := signup(t, srv, "a@example.com")
	id := uuid.NewString()
	a.push(create("todo", id, map[string]any{"text": "영양제", "position": "V", "created_at": 1, "updated_at": 1, "repeat_freq": "daily", "done_log": "2026-10-17"}))
	// 폰은 18일을, PC는 그사이 19일을 체크했다(둘 다 17일만 알던 상태에서) → 둘 다 남는다
	if r := a.push(update("todo", id, "done_log", "2026-10-17", "2026-10-17,2026-10-18")); r[0].Status != "ok" {
		t.Fatalf("phone: %+v", r)
	}
	if r := a.push(update("todo", id, "done_log", "2026-10-17", "2026-10-17,2026-10-19")); r[0].Status != "ok" {
		t.Fatalf("pc: %+v", r)
	}
	logOf := func() any {
		for _, row := range a.pull(0).Todos {
			if row["id"] == id {
				return row["done_log"]
			}
		}
		return nil
	}
	if got := logOf(); got != "2026-10-17,2026-10-18,2026-10-19" {
		t.Fatalf("합친 기록: %v", got)
	}
	// 한 기기가 17일 체크를 풀면 17일만 빠진다
	a.push(update("todo", id, "done_log", "2026-10-17,2026-10-18", "2026-10-18"))
	if got := logOf(); got != "2026-10-18,2026-10-19" {
		t.Fatalf("뺀 기록: %v", got)
	}
	// 잘못된 날짜는 받지 않는다
	if r := a.push(update("todo", id, "done_log", "2026-10-18,2026-10-19", "2026-13-01")); r[0].Status != "invalid" {
		t.Fatalf("잘못된 값: %+v", r)
	}
}
