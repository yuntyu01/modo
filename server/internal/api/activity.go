package api

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

// 활동 기록 1단계(사용자 승인 2026-10-26): 누가(계정 id) 어느 날(서울 날짜) 어느 플랫폼·앱 판으로 몇 번 요청·동기화했는지만 센다.
// 일간·주간 사용자 수, 다시 온 비율, PC·휴대폰 비율, 옛 PC 판(바로 받기 없음)을 아직 쓰는 사람을 보려고.
// 할 일·폴더 이름 같은 내용, IP, User-Agent 원문은 남기지 않는다(User-Agent에서 판 번호만 뽑는다).
// 계정을 지우면 FK CASCADE로 함께 지워지고, 400일이 지난 날은 Cleanup이 지운다(deploy/README.md '활동 기록').
//
// 요청마다 DB에 쓰지 않는다: 메모리에 모아 5분마다 한 번에 더한다(서버가 하나라 프로세스 안에서 모으면 된다).
// 정상 종료 때는 main이 FlushActivity로 마저 쓴다. 갑자기 죽으면 마지막 5분 치까지는 잃는다(통계라 감수한다).
const (
	activityFlushEvery = 5 * time.Minute
	activityKeepDays   = 400 // schema.sql 주석, Cleanup의 DELETE와 같다
)

// 한국은 서머타임이 없어 +9 고정(서버 이미지에 시간대 자료가 없어도 된다)
var seoul = time.FixedZone("KST", 9*60*60)

// 한 줄 = daily_activity의 기본 키
type activityKey struct {
	user     uuid.UUID
	day      string // 서울 날짜 YYYY-MM-DD
	platform string // android | ios | windows | desktop | other
	version  string // 앱 판. 모르면 ''
}

type activityCount struct {
	requests, syncs, waits int
	first, last            time.Time
}

type activityLog struct {
	mu      sync.Mutex
	pending map[activityKey]activityCount
}

func (l *activityLog) add(k activityKey, c activityCount) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.pending == nil {
		l.pending = map[activityKey]activityCount{}
	}
	if p, ok := l.pending[k]; ok {
		c.requests += p.requests
		c.syncs += p.syncs
		c.waits += p.waits
		if p.first.Before(c.first) {
			c.first = p.first
		}
		if p.last.After(c.last) {
			c.last = p.last
		}
	}
	l.pending[k] = c
}

// 모아 둔 것을 꺼내고 비운다
func (l *activityLog) take() map[activityKey]activityCount {
	l.mu.Lock()
	defer l.mu.Unlock()
	p := l.pending
	l.pending = nil
	return p
}

// 쓰지 못한 것을 되돌려 둔다(그사이 쌓인 것과 더한다)
func (l *activityLog) putBack(batch map[activityKey]activityCount) {
	for k, c := range batch {
		l.add(k, c)
	}
}

// 지운 계정의 아직 안 쓴 숫자를 버린다
func (l *activityLog) forget(user uuid.UUID) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for k := range l.pending {
		if k.user == user {
			delete(l.pending, k)
		}
	}
}

// auth를 지난 요청 하나를 센다(auth 미들웨어가 부른다). 모든 요청은 requests,
// 동기화(push·pull)는 syncs, 바로 받기(/api/sync/wait, 최대 25초 기다리는 요청)는 waits에도 센다.
// waits가 있으면 그 기기는 바로 받기가 있는 판이다(Android처럼 판 번호를 모를 때도 옛 판인지 가린다).
func (s *Server) countActivity(r *http.Request, user uuid.UUID, device string) {
	now := time.Now()
	c := activityCount{requests: 1, first: now, last: now}
	switch r.URL.Path {
	case "/api/sync/push", "/api/sync/pull":
		c.syncs = 1
	case "/api/sync/wait":
		c.waits = 1
	}
	platform, version := clientOf(device, r.Header)
	s.activity.add(activityKey{user, now.In(seoul).Format(time.DateOnly), platform, version}, c)
}

// 세션의 기기 이름(앱이 로그인할 때 보낸다: app/src/state/AppContext.tsx deviceName, desktop/main.cjs) → 플랫폼
func platformOf(device string) string {
	switch strings.ToLower(strings.TrimSpace(device)) {
	case "android":
		return "android"
	case "iphone", "ipad", "ios":
		return "ios"
	case "windows":
		return "windows"
	case "desktop":
		return "desktop"
	}
	return "other"
}

var (
	// 판 번호: 숫자로 시작하는 32자 이내(1.0.43, 12, 1.0.43-beta). 그 밖의 값은 남기지 않는다
	clientVersion = regexp.MustCompile(`^\d[0-9A-Za-z.+_-]{0,31}$`)
	// PC(Electron net.fetch·화면): Electron 기본 User-Agent는 '(KHTML, like Gecko) <앱 이름>/<판> Chrome/… Electron/…'
	electronUA = regexp.MustCompile(`\(KHTML, like Gecko\) [^()/]+/(\d[0-9A-Za-z.+_-]{0,31}) Chrome/`)
	// iPhone(CFNetwork): '<번들 이름>/<빌드 번호> CFNetwork/… Darwin/…'. 마케팅 판이 아니라 빌드 번호(CFBundleVersion)다
	cfnetworkUA = regexp.MustCompile(`^[^/\s]+/(\d[0-9A-Za-z.+_-]{0,31}) CFNetwork/`)
)

// 플랫폼과 앱 판. 플랫폼은 세션의 기기 이름을 따른다.
// X-Modo-Client: <플랫폼>/<판>(예: android/1.0.44)이 있으면 판은 이것을 먼저 본다. 아직 어느 앱도 안 보낸다:
// 2단계에서 앱이 붙이면 Android(OkHttp는 'okhttp/4.x'라 판이 없다)도 판을 안다. 세션 기기 이름을 모를 때만 플랫폼도 이것을 쓴다.
func clientOf(device string, h http.Header) (platform, version string) {
	platform = platformOf(device)
	if p, v, ok := strings.Cut(h.Get("X-Modo-Client"), "/"); ok {
		if platform == "other" {
			platform = platformOf(p)
		}
		if v = strings.TrimSpace(v); clientVersion.MatchString(v) {
			return platform, v
		}
	}
	return platform, userAgentVersion(h.Get("User-Agent"))
}

func userAgentVersion(ua string) string {
	if len(ua) > 512 {
		ua = ua[:512]
	}
	if strings.Contains(ua, " Electron/") {
		if m := electronUA.FindStringSubmatch(ua); m != nil {
			return m[1]
		}
	}
	if m := cfnetworkUA.FindStringSubmatch(ua); m != nil {
		return m[1]
	}
	return ""
}

// RunActivity: 5분마다 모아 둔 활동을 DB에 쓴다. ctx가 끝나면 멈춘다(마지막 쓰기는 main이 서버를 닫은 뒤 FlushActivity로).
func (s *Server) RunActivity(ctx context.Context) {
	t := time.NewTicker(activityFlushEvery)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := s.FlushActivity(ctx); err != nil && ctx.Err() == nil {
				log.Print("activity_flush_failed_retry_pending")
			}
		}
	}
}

const activityUpsert = `
	INSERT INTO daily_activity AS a (user_id, day, platform, app_version, requests, syncs, waits, first_at, last_at)
	SELECT x.u, x.d::date, x.p, x.v, x.r, x.s, x.w, x.f, x.l
	FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::int[], $6::int[], $7::int[], $8::timestamptz[], $9::timestamptz[])
		AS x(u, d, p, v, r, s, w, f, l)
	%s
	ON CONFLICT (user_id, day, platform, app_version) DO UPDATE SET
		requests = a.requests + EXCLUDED.requests,
		syncs = a.syncs + EXCLUDED.syncs,
		waits = a.waits + EXCLUDED.waits,
		first_at = LEAST(a.first_at, EXCLUDED.first_at),
		last_at = GREATEST(a.last_at, EXCLUDED.last_at)`

// FlushActivity: 모아 둔 숫자를 한 문장으로 DB에 더한다(같은 날·플랫폼·판 줄이 있으면 더하기).
// 그사이 지워진 계정(운영 도구가 users를 바로 지운 경우 등)이 있어 FK에 걸리면, 남아 있는 계정 것만 다시 쓰고 그 계정 것은 버린다.
// 그 밖의 실패는 되돌려 두었다가 다음에 다시 쓴다.
func (s *Server) FlushActivity(ctx context.Context) error {
	batch := s.activity.take()
	if len(batch) == 0 {
		return nil
	}
	n := len(batch)
	users := make([]uuid.UUID, 0, n)
	days, platforms, versions := make([]string, 0, n), make([]string, 0, n), make([]string, 0, n)
	requests, syncs, waits := make([]int32, 0, n), make([]int32, 0, n), make([]int32, 0, n)
	firsts, lasts := make([]time.Time, 0, n), make([]time.Time, 0, n)
	for k, c := range batch {
		users = append(users, k.user)
		days, platforms, versions = append(days, k.day), append(platforms, k.platform), append(versions, k.version)
		requests, syncs, waits = append(requests, int32(c.requests)), append(syncs, int32(c.syncs)), append(waits, int32(c.waits))
		firsts, lasts = append(firsts, c.first), append(lasts, c.last)
	}
	args := []any{users, days, platforms, versions, requests, syncs, waits, firsts, lasts}
	_, err := s.db.Exec(ctx, fmt.Sprintf(activityUpsert, "WHERE true"), args...)
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23503" {
		_, err = s.db.Exec(ctx, fmt.Sprintf(activityUpsert, "WHERE EXISTS (SELECT 1 FROM users WHERE id = x.u)"), args...)
	}
	if err != nil {
		s.activity.putBack(batch)
	}
	return err
}

type activityDay struct {
	Day       string         `json:"day"`
	Users     int            `json:"users"`     // 그날 쓴 계정 수(DAU)
	Platforms map[string]int `json:"platforms"` // 플랫폼별 계정 수(한 사람이 PC·휴대폰을 다 쓰면 양쪽에 센다)
	Requests  int64          `json:"requests"`
	Syncs     int64          `json:"syncs"`
	Waits     int64          `json:"waits"`
}

type activityVersion struct {
	Platform string `json:"platform"`
	Version  string `json:"version"` // ''은 판을 모름(Android는 2단계 전까지 늘 '')
	Users    int    `json:"users"`
}

type activityReturn struct {
	Base     int      `json:"base"`     // 비교할 수 있는 (계정, 날) 수
	Returned int      `json:"returned"` // 그중 1일(7일) 뒤에도 쓴 수
	Rate     *float64 `json:"rate"`     // returned / base. base가 0이면 null
}

func returnRate(base, returned int) activityReturn {
	r := activityReturn{Base: base, Returned: returned}
	if base > 0 {
		v := float64(returned) / float64(base)
		r.Rate = &v
	}
	return r
}

// 주인용 집계 토큰. 짐작할 수 있는 짧은 값이면 켜지 않는다
func (s *Server) adminEnabled() bool { return len(s.cfg.AdminToken) >= 32 }

// GET /api/admin/activity?days=30 : 주인이 보는 집계(숫자만, 계정 id·이메일 없음). Authorization: Bearer <ADMIN_TOKEN>.
// ADMIN_TOKEN이 없으면(32자 미만이어도) 없는 주소처럼 404.
func (s *Server) adminActivity(w http.ResponseWriter, r *http.Request) {
	if !s.adminEnabled() {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if !s.limiter.allow("admin:" + s.clientIP(r)) {
		errJSON(w, http.StatusTooManyRequests, "rate_limited", "잠시 후 다시 시도해 주세요")
		return
	}
	// 길이까지 드러나지 않게 해시끼리 비교한다
	got, want := sha256.Sum256([]byte(bearer(r))), sha256.Sum256([]byte(s.cfg.AdminToken))
	if subtle.ConstantTimeCompare(got[:], want[:]) != 1 {
		errJSON(w, http.StatusUnauthorized, "login_required", "관리자 토큰이 필요합니다")
		return
	}
	days := 30
	if n, err := strconv.Atoi(r.URL.Query().Get("days")); err == nil && n > 0 {
		days = min(n, activityKeepDays)
	}
	ctx := r.Context()
	// 아직 메모리에만 있는 것까지 보이게 먼저 쓴다
	if err := s.FlushActivity(ctx); err != nil {
		log.Print("activity_flush_failed_retry_pending")
	}
	now := time.Now().In(seoul)
	day := func(back int) string { return now.AddDate(0, 0, -back).Format(time.DateOnly) }
	today, from := day(0), day(days-1)

	// 날마다: 전체(플랫폼 '') 한 줄과 플랫폼별 줄
	byDay := map[string]*activityDay{}
	list := make([]*activityDay, 0, days)
	for i := days - 1; i >= 0; i-- {
		d := &activityDay{Day: day(i), Platforms: map[string]int{}}
		byDay[d.Day] = d
		list = append(list, d)
	}
	rows, err := s.db.Query(ctx, `
		SELECT to_char(day, 'YYYY-MM-DD'), COALESCE(platform, ''), count(DISTINCT user_id), sum(requests), sum(syncs), sum(waits)
		FROM daily_activity WHERE day BETWEEN $1::date AND $2::date
		GROUP BY GROUPING SETS ((day), (day, platform))`, from, today)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var d, platform string
		var users int
		var req, syn, wai int64
		if err := rows.Scan(&d, &platform, &users, &req, &syn, &wai); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		e := byDay[d]
		if e == nil {
			continue
		}
		if platform != "" {
			e.Platforms[platform] = users
			continue
		}
		e.Users, e.Requests, e.Syncs, e.Waits = users, req, syn, wai
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}

	// 오늘 기준 DAU · WAU(7일) · MAU(30일)
	var dau, wau, mau int
	if err := s.db.QueryRow(ctx, `
		SELECT count(DISTINCT user_id) FILTER (WHERE day = $1::date),
			count(DISTINCT user_id) FILTER (WHERE day > $1::date - 7),
			count(DISTINCT user_id)
		FROM daily_activity WHERE day > $1::date - 30 AND day <= $1::date`, today).Scan(&dau, &wau, &mau); err != nil {
		serverError(w, err)
		return
	}

	// 최근 7일에 쓴 사람이 플랫폼마다 마지막으로 쓴 판(한 사람은 플랫폼마다 한 번만 센다)
	versions := []activityVersion{}
	rows, err = s.db.Query(ctx, `
		SELECT platform, app_version, count(*) FROM (
			SELECT DISTINCT ON (user_id, platform) platform, app_version
			FROM daily_activity WHERE day > $1::date - 7 AND day <= $1::date
			ORDER BY user_id, platform, last_at DESC
		) v GROUP BY platform, app_version ORDER BY platform, count(*) DESC, app_version DESC`, today)
	if err != nil {
		serverError(w, err)
		return
	}
	for rows.Next() {
		var v activityVersion
		if err := rows.Scan(&v.Platform, &v.Version, &v.Users); err != nil {
			rows.Close()
			serverError(w, err)
			return
		}
		versions = append(versions, v)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		serverError(w, err)
		return
	}

	// 다시 온 비율(기간 안, 다 찬 날만 = 어제까지): 어느 날 쓴 사람이 다음 날(d1) · 7일 뒤 그날(d7)에도 썼는지
	var base1, ret1, base7, ret7 int
	if err := s.db.QueryRow(ctx, `
		WITH d AS (SELECT DISTINCT user_id, day FROM daily_activity WHERE day BETWEEN $1::date AND $2::date)
		SELECT count(*) FILTER (WHERE a.day + 1 <= $2::date), count(n1.user_id),
			count(*) FILTER (WHERE a.day + 7 <= $2::date), count(n7.user_id)
		FROM d a
		LEFT JOIN d n1 ON n1.user_id = a.user_id AND n1.day = a.day + 1
		LEFT JOIN d n7 ON n7.user_id = a.user_id AND n7.day = a.day + 7`, from, day(1)).Scan(&base1, &ret1, &base7, &ret7); err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"days":     days,
		"today":    today,
		"daily":    list,
		"latest":   map[string]any{"day": today, "dau": dau, "wau": wau, "mau": mau},
		"versions": versions,
		"return":   map[string]activityReturn{"d1": returnRate(base1, ret1), "d7": returnRate(base7, ret7)},
	})
}
