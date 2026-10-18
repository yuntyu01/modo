package api

import (
	"net/http"
	"regexp"
	"sync"
	"time"
)

// 테마(테마색): 계정에 지금 쓰는 색 하나(theme_id = '#RRGGBB')를 두어 PC·휴대폰이 이어 쓴다.
// 여러 기기가 엇갈려 바꾸면 기기가 바꾼 시각(updated_at, 밀리초)이 늦은 쪽이 이긴다.
// 인기 색은 '지금 그 색을 쓰는 계정 수'로 센다(계정당 한 표, 누른 횟수가 아니라). 순위는 하루에 한 번만 새로 만든다.

var themeID = regexp.MustCompile(`^#[0-9A-F]{6}$`)

type themeState struct {
	ID        *string `json:"theme_id"`
	UpdatedAt int64   `json:"theme_updated_at"`
}

func (s *Server) myTheme(w http.ResponseWriter, r *http.Request) (themeState, bool) {
	var t themeState
	err := s.db.QueryRow(r.Context(), `SELECT theme_id, theme_updated_at FROM users WHERE id = $1`, userFrom(r.Context()).ID).Scan(&t.ID, &t.UpdatedAt)
	if err != nil {
		serverError(w, err)
		return t, false
	}
	return t, true
}

func (s *Server) getTheme(w http.ResponseWriter, r *http.Request) {
	if t, ok := s.myTheme(w, r); ok {
		writeJSON(w, http.StatusOK, t)
	}
}

// PUT /api/me/theme {theme_id, updated_at}: 지금 저장된 것보다 늦게 바꾼 것만 받는다. 응답은 받은 뒤의 계정 테마.
func (s *Server) putTheme(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID        string `json:"theme_id"`
		UpdatedAt int64  `json:"updated_at"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !themeID.MatchString(in.ID) || in.UpdatedAt <= 0 {
		badRequest(w, "테마 값이 잘못됐습니다")
		return
	}
	if _, err := s.db.Exec(r.Context(),
		`UPDATE users SET theme_id = $2, theme_updated_at = $3 WHERE id = $1 AND theme_updated_at < $3`,
		userFrom(r.Context()).ID, in.ID, in.UpdatedAt); err != nil {
		serverError(w, err)
		return
	}
	if t, ok := s.myTheme(w, r); ok {
		writeJSON(w, http.StatusOK, t)
	}
}

type popularTheme struct {
	ID    string `json:"id"`
	Users int    `json:"users"`
}

type popularThemes struct {
	Day    string         `json:"day"`
	Total  int            `json:"total"`
	Themes []popularTheme `json:"themes"`
}

// 하루 동안 같은 순위를 돌려준다(보는 중에 추천 색 순서가 바뀌지 않게, 매번 세지 않게).
type popularCache struct {
	mu   sync.Mutex
	data *popularThemes
}

// GET /api/themes/popular: 로그인 없이 볼 수 있는 집계(색별 계정 수)만. 누가 어떤 색인지는 내보내지 않는다.
func (s *Server) popularThemes(w http.ResponseWriter, r *http.Request) {
	day := time.Now().UTC().Format("2006-01-02")
	s.popular.mu.Lock()
	defer s.popular.mu.Unlock()
	if s.popular.data == nil || s.popular.data.Day != day {
		rows, err := s.db.Query(r.Context(), `
			SELECT theme_id, count(*) FROM users WHERE theme_id IS NOT NULL
			GROUP BY theme_id ORDER BY count(*) DESC, theme_id LIMIT 20`)
		if err != nil {
			serverError(w, err)
			return
		}
		out := popularThemes{Day: day, Themes: []popularTheme{}}
		for rows.Next() {
			var t popularTheme
			if err := rows.Scan(&t.ID, &t.Users); err != nil {
				rows.Close()
				serverError(w, err)
				return
			}
			out.Total += t.Users
			out.Themes = append(out.Themes, t)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			serverError(w, err)
			return
		}
		s.popular.data = &out
	}
	w.Header().Set("Cache-Control", "public, max-age=3600")
	writeJSON(w, http.StatusOK, s.popular.data)
}
