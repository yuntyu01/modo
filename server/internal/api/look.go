package api

import (
	"encoding/json"
	"net/http"
)

// 꾸미기(화면 · 홈 위젯 · 잠금 위젯 · PC 미니창 설정): 계정에 한 벌을 두어 휴대폰에서 PC 미니창을, PC에서 위젯을 고칠 수 있게 한다
// (사용자 요청 2026-10-24). 무엇을 담을지는 앱이 정하고(app/src/core/look.ts) 서버는 JSON 객체 하나로 둔다.
// 테마색(theme.go)처럼 기기가 바꾼 시각(updated_at, 밀리초)이 늦은 쪽이 이긴다.

// 꾸미기 한 벌의 크기 한도(지금은 1KB 남짓)
const maxLook = 16 << 10

type lookState struct {
	Look      json.RawMessage `json:"look"`
	UpdatedAt int64           `json:"updated_at"`
}

func (s *Server) myLook(w http.ResponseWriter, r *http.Request) (lookState, bool) {
	var raw *string
	t := lookState{Look: json.RawMessage("null")}
	err := s.db.QueryRow(r.Context(), `SELECT look::text, look_updated_at FROM users WHERE id = $1`, userFrom(r.Context()).ID).Scan(&raw, &t.UpdatedAt)
	if err != nil {
		serverError(w, err)
		return t, false
	}
	if raw != nil {
		t.Look = json.RawMessage(*raw)
	}
	return t, true
}

// GET /api/me/look: 계정의 꾸미기(없으면 look = null, updated_at = 0)
func (s *Server) getLook(w http.ResponseWriter, r *http.Request) {
	if t, ok := s.myLook(w, r); ok {
		writeJSON(w, http.StatusOK, t)
	}
}

// PUT /api/me/look {look, updated_at}: 지금 저장된 것보다 늦게 바꾼 것만 받는다. 응답은 받은 뒤의 계정 꾸미기.
func (s *Server) putLook(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Look      json.RawMessage `json:"look"`
		UpdatedAt int64           `json:"updated_at"`
	}
	if !decode(w, r, &in) {
		return
	}
	var obj map[string]json.RawMessage
	if in.UpdatedAt <= 0 || len(in.Look) == 0 || len(in.Look) > maxLook || json.Unmarshal(in.Look, &obj) != nil || obj == nil {
		badRequest(w, "꾸미기 값이 잘못됐습니다")
		return
	}
	if _, err := s.db.Exec(r.Context(),
		`UPDATE users SET look = $2::jsonb, look_updated_at = $3 WHERE id = $1 AND look_updated_at < $3`,
		userFrom(r.Context()).ID, string(in.Look), in.UpdatedAt); err != nil {
		serverError(w, err)
		return
	}
	if t, ok := s.myLook(w, r); ok {
		writeJSON(w, http.StatusOK, t)
	}
}
