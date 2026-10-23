package api

import (
	"encoding/json"
	"testing"
)

func TestLookSync(t *testing.T) {
	srv := newTestServer(t)
	a := signup(t, srv, "a@example.com")
	b := signup(t, srv, "b@example.com")

	var st lookState
	if code := a.do("GET", "/api/me/look", nil, &st); code != 200 || string(st.Look) != "null" || st.UpdatedAt != 0 {
		t.Fatalf("처음엔 꾸미기 없음: %d %s %d", code, st.Look, st.UpdatedAt)
	}
	// 휴대폰에서 PC 미니창 투명도를 바꿨다 → PC가 받는다. 늦게 바꾼 쪽이 이긴다
	look := map[string]any{"mini": map[string]any{"opacity": 0.5, "checkSide": "left"}, "size": "l"}
	if code := a.do("PUT", "/api/me/look", map[string]any{"look": look, "updated_at": 200}, &st); code != 200 || st.UpdatedAt != 200 {
		t.Fatalf("저장: %d %+v", code, st)
	}
	var got map[string]any
	if err := json.Unmarshal(st.Look, &got); err != nil || got["size"] != "l" || got["mini"].(map[string]any)["checkSide"] != "left" {
		t.Fatalf("내용: %s %v", st.Look, err)
	}
	a.do("PUT", "/api/me/look", map[string]any{"look": map[string]any{"size": "s"}, "updated_at": 100}, &st)
	if err := json.Unmarshal(st.Look, &got); err != nil || got["size"] != "l" || st.UpdatedAt != 200 {
		t.Fatalf("옛 값이 덮었다: %s", st.Look)
	}
	// 객체가 아니거나 시각이 없으면 거절
	for _, bad := range []map[string]any{{"look": "red", "updated_at": 300}, {"look": nil, "updated_at": 300}, {"look": look, "updated_at": 0}} {
		if code := a.do("PUT", "/api/me/look", bad, nil); code != 400 {
			t.Fatalf("잘못된 값 %v: %d", bad, code)
		}
	}
	// 계정마다 따로
	if code := b.do("GET", "/api/me/look", nil, &st); code != 200 || string(st.Look) != "null" {
		t.Fatalf("다른 계정: %d %s", code, st.Look)
	}
}
