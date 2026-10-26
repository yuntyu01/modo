package api

import (
	"context"
	"encoding/json"
	"io"
	"math"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	testAdminToken = "test-admin-token-0123456789abcdef"
	// 앱이 실제로 보내는 User-Agent 꼴
	uaPC      = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) modo-desktop/1.0.43 Chrome/134.0.6998.205 Electron/35.7.5 Safari/537.36"
	uaAndroid = "okhttp/4.12.0"
)

func TestClientOf(t *testing.T) {
	long := strings.Repeat("1", 40)
	for _, c := range []struct {
		device, ua, header string
		platform, version  string
	}{
		{"Windows", uaPC, "", "windows", "1.0.43"},
		{"Desktop", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) modo/1.0.3 Chrome/134.0.0.0 Electron/35.7.5 Safari/537.36", "", "desktop", "1.0.3"},
		{"iPhone", "modo/12 CFNetwork/1568.100.1 Darwin/24.0.0", "", "ios", "12"},
		// Android(OkHttp)는 판이 없다: 2단계(X-Modo-Client) 전까지 ''
		{"Android", uaAndroid, "", "android", ""},
		{"Android", "Dalvik/2.1.0 (Linux; U; Android 14; Pixel 7 Build/UQ1A.240205.004)", "", "android", ""},
		{"test", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "", "other", ""},
		{"", "Go-http-client/1.1", "", "other", ""},
		{"Windows", strings.Replace(uaPC, "1.0.43", long, 1), "", "windows", ""},
		// X-Modo-Client가 있으면 판은 그것을 먼저 본다. 플랫폼은 세션 기기 이름을 모를 때만
		{"Android", uaAndroid, "android/1.0.44", "android", "1.0.44"},
		{"Windows", uaPC, "windows/1.0.50", "windows", "1.0.50"},
		{"", "", "ios/2.0.0", "ios", "2.0.0"},
		{"Android", uaAndroid, "desktop/1.0.9", "android", "1.0.9"},
		{"Android", uaAndroid, "android/<b>x</b>", "android", ""},
		{"Windows", uaPC, "windows/" + long, "windows", "1.0.43"},
		{"Windows", uaPC, "windows", "windows", "1.0.43"},
	} {
		h := http.Header{}
		h.Set("User-Agent", c.ua)
		if c.header != "" {
			h.Set("X-Modo-Client", c.header)
		}
		if p, v := clientOf(c.device, h); p != c.platform || v != c.version {
			t.Errorf("%q %q %q: %q %q, want %q %q", c.device, c.ua, c.header, p, v, c.platform, c.version)
		}
	}
	for device, want := range map[string]string{"Android": "android", "iPhone": "ios", "Windows": "windows", "Desktop": "desktop", " windows ": "windows", "test": "other", "": "other"} {
		if got := platformOf(device); got != want {
			t.Errorf("platformOf(%q) = %q, want %q", device, got, want)
		}
	}
}

// s를 직접 부를 수 있는 서버(FlushActivity · Cleanup)
func newActivityServer(t *testing.T, cfg Config) (*Server, *httptest.Server, *pgxpool.Pool) {
	t.Helper()
	_, pool := newTestServerDB(t)
	s := New(pool, cfg)
	mux := http.NewServeMux()
	s.Routes(mux)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return s, srv, pool
}

// 앱처럼 기기 이름을 보내 로그인한 계정(세션의 device = 플랫폼)
func signupOn(t *testing.T, srv *httptest.Server, email, device, ua string) *client {
	t.Helper()
	c := signup(t, srv, email)
	var r struct {
		Token string `json:"token"`
	}
	if code := c.do("POST", "/api/auth/login", map[string]string{"email": email, "password": "password123", "device": device}, &r); code != 200 {
		t.Fatalf("login %s: %d", email, code)
	}
	c.token, c.ua = r.Token, ua
	return c
}

type activityRow struct {
	Day, Platform, Version  string
	Requests, Syncs, Waits int
}

func activityOf(t *testing.T, pool *pgxpool.Pool, user string) []activityRow {
	t.Helper()
	rows, err := pool.Query(context.Background(), `
		SELECT to_char(day, 'YYYY-MM-DD'), platform, app_version, requests, syncs, waits FROM daily_activity
		WHERE user_id = $1 AND first_at <= last_at ORDER BY day, platform, app_version`, user)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := []activityRow{}
	for rows.Next() {
		var r activityRow
		if err := rows.Scan(&r.Day, &r.Platform, &r.Version, &r.Requests, &r.Syncs, &r.Waits); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

func seoulDay(back int) string { return time.Now().In(seoul).AddDate(0, 0, -back).Format(time.DateOnly) }

func TestActivityFlushAddsUp(t *testing.T) {
	s, srv, pool := newActivityServer(t, Config{})
	ctx := context.Background()
	pc := signupOn(t, srv, "pc@example.test", "Windows", uaPC)
	phone := signupOn(t, srv, "phone@example.test", "Android", uaAndroid)
	// 로그인 전 요청은 세지 않는다
	if n := len(s.activity.take()); n != 0 {
		t.Fatalf("unauthenticated requests counted: %d", n)
	}
	for range 2 {
		pc.do("GET", "/api/me", nil, nil)
		pc.push(todo(uuid.NewString(), "", "PC에서 적은 비밀 할 일"))
		pc.pull(0)
		if code := pc.do("GET", "/api/sync/wait?since=0&max=1", nil, nil); code != 200 {
			t.Fatalf("wait: %d", code)
		}
		phone.pull(0)
		// 5분마다 쓰는 것과 같다: 두 번 쓰면 더해진다
		if err := s.FlushActivity(ctx); err != nil {
			t.Fatal(err)
		}
	}
	today := seoulDay(0)
	if got := activityOf(t, pool, pc.id); len(got) != 1 || got[0] != (activityRow{today, "windows", "1.0.43", 8, 4, 2}) {
		t.Fatalf("pc: %+v", got)
	}
	if got := activityOf(t, pool, phone.id); len(got) != 1 || got[0] != (activityRow{today, "android", "", 2, 2, 0}) {
		t.Fatalf("phone: %+v", got)
	}
	if n := len(s.activity.take()); n != 0 {
		t.Fatalf("pending after flush: %d", n)
	}
	if err := s.FlushActivity(ctx); err != nil {
		t.Fatalf("empty flush: %v", err)
	}
	// 내용은 남지 않는다: 할 일 글이 활동 기록 어디에도 없다
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM daily_activity a WHERE to_jsonb(a)::text LIKE '%비밀%'`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("content leaked: %d %v", n, err)
	}
	// PC를 새 판으로 올리면 그 판 줄이 따로 생긴다(옛 판을 쓰는 기기를 가린다)
	pc.ua = strings.Replace(uaPC, "1.0.43", "1.0.44", 1)
	pc.do("GET", "/api/me", nil, nil)
	if err := s.FlushActivity(ctx); err != nil {
		t.Fatal(err)
	}
	if got := activityOf(t, pool, pc.id); len(got) != 2 || got[0].Version != "1.0.43" || got[1] != (activityRow{today, "windows", "1.0.44", 1, 0, 0}) {
		t.Fatalf("pc upgrade: %+v", got)
	}
}

func TestActivityFlushSkipsDeletedAccount(t *testing.T) {
	s, srv, pool := newActivityServer(t, Config{})
	ctx := context.Background()
	keep := signupOn(t, srv, "keep@example.test", "Windows", uaPC)
	gone := signupOn(t, srv, "gone@example.test", "Android", uaAndroid)
	keep.do("GET", "/api/me", nil, nil)
	gone.do("GET", "/api/me", nil, nil)
	// 운영 도구(modo-ops delete-account)처럼 users 행을 바로 지웠다: 메모리에 남은 숫자는 FK에 걸린다
	if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, gone.id); err != nil {
		t.Fatal(err)
	}
	if err := s.FlushActivity(ctx); err != nil {
		t.Fatalf("flush failed for deleted account: %v", err)
	}
	if got := activityOf(t, pool, keep.id); len(got) != 1 || got[0].Requests != 1 {
		t.Fatalf("kept account: %+v", got)
	}
	if got := activityOf(t, pool, gone.id); len(got) != 0 {
		t.Fatalf("deleted account written: %+v", got)
	}
	// 버렸다(다음에 다시 쓰려고 되돌려 두지 않는다)
	if n := len(s.activity.take()); n != 0 {
		t.Fatalf("deleted account kept pending: %d", n)
	}
}

func TestActivityDeletedWithAccount(t *testing.T) {
	j, err := OpenErasureJournal(filepath.Join(t.TempDir(), "journal.json"))
	if err != nil {
		t.Fatal(err)
	}
	s, srv, pool := newActivityServer(t, Config{Erasures: j})
	ctx := context.Background()
	a := signupOn(t, srv, "erase@example.test", "Windows", uaPC)
	b := signupOn(t, srv, "stay@example.test", "Android", uaAndroid)
	a.do("GET", "/api/me", nil, nil)
	b.do("GET", "/api/me", nil, nil)
	if err := s.FlushActivity(ctx); err != nil {
		t.Fatal(err)
	}
	a.do("GET", "/api/me", nil, nil) // 아직 메모리에만 있는 숫자
	if code := a.do("DELETE", "/api/me", map[string]string{"confirmation": "DELETE"}, nil); code != 204 {
		t.Fatalf("delete: %d", code)
	}
	if got := activityOf(t, pool, a.id); len(got) != 0 {
		t.Fatalf("activity survived account deletion: %+v", got)
	}
	for k := range s.activity.take() {
		if k.user.String() == a.id {
			t.Fatal("pending activity of deleted account kept")
		}
	}
	if got := activityOf(t, pool, b.id); len(got) != 1 {
		t.Fatalf("other account: %+v", got)
	}
}

func TestActivityRetention(t *testing.T) {
	s, srv, pool := newActivityServer(t, Config{})
	ctx := context.Background()
	a := signup(t, srv, "old@example.test")
	for _, back := range []int{401, 399, 0} {
		if _, err := pool.Exec(ctx, `INSERT INTO daily_activity (user_id, day, platform, requests) VALUES ($1, current_date - $2::int, 'android', 1)`, a.id, back); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Cleanup(ctx); err != nil {
		t.Fatal(err)
	}
	var n, old int
	if err := pool.QueryRow(ctx, `SELECT count(*), count(*) FILTER (WHERE day < current_date - 400) FROM daily_activity`).Scan(&n, &old); err != nil || n != 2 || old != 0 {
		t.Fatalf("retention: %d rows, %d old, %v", n, old, err)
	}
}

func TestAdminActivity(t *testing.T) {
	// 토큰이 없거나 짧으면 주소가 없다
	for _, token := range []string{"", "short-admin-token"} {
		s := New(nil, Config{AdminToken: token})
		mux := http.NewServeMux()
		s.Routes(mux)
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/api/admin/activity", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		mux.ServeHTTP(rec, req)
		if rec.Code != 404 {
			t.Fatalf("disabled admin %q: %d", token, rec.Code)
		}
	}

	_, srv, pool := newActivityServer(t, Config{AdminToken: testAdminToken})
	ctx := context.Background()
	pc := signupOn(t, srv, "pc@example.test", "Windows", uaPC)
	phone := signupOn(t, srv, "phone@example.test", "Android", uaAndroid)
	pc.do("GET", "/api/me", nil, nil)
	pc.pull(0)
	phone.pull(0)
	// 지난 기록: PC는 9 · 8 · 2일 전(옛 판 1.0.30), 휴대폰은 9 · 2일 전
	for _, r := range []struct {
		user, platform, version string
		back                    int
	}{{pc.id, "windows", "1.0.30", 9}, {pc.id, "windows", "1.0.30", 8}, {pc.id, "windows", "1.0.30", 2}, {phone.id, "android", "", 9}, {phone.id, "android", "", 2}} {
		if _, err := pool.Exec(ctx, `INSERT INTO daily_activity (user_id, day, platform, app_version, requests, syncs, first_at, last_at)
			VALUES ($1, $2::date, $3, $4, 5, 2, now() - make_interval(days => $5), now() - make_interval(days => $5))`,
			r.user, seoulDay(r.back), r.platform, r.version, r.back); err != nil {
			t.Fatal(err)
		}
	}

	get := func(token, query string) (int, string) {
		req, _ := http.NewRequest("GET", srv.URL+"/api/admin/activity"+query, nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		b, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(b)
	}
	if code, _ := get("", ""); code != 401 {
		t.Fatalf("no token: %d", code)
	}
	if code, _ := get(testAdminToken+"x", ""); code != 401 {
		t.Fatalf("wrong token: %d", code)
	}
	code, body := get(testAdminToken, "?days=10")
	if code != 200 {
		t.Fatalf("admin: %d %s", code, body)
	}
	// 숫자만: 계정 id · 이메일이 없다
	for _, secret := range []string{pc.id, phone.id, "pc@example.test", "phone@example.test"} {
		if strings.Contains(body, secret) {
			t.Fatalf("admin response leaks %q: %s", secret, body)
		}
	}
	var out struct {
		Days  int           `json:"days"`
		Today string        `json:"today"`
		Daily []activityDay `json:"daily"`
		Lat   struct {
			Day string `json:"day"`
			DAU int    `json:"dau"`
			WAU int    `json:"wau"`
			MAU int    `json:"mau"`
		} `json:"latest"`
		Versions []activityVersion        `json:"versions"`
		Return   map[string]activityReturn `json:"return"`
	}
	if err := json.Unmarshal([]byte(body), &out); err != nil {
		t.Fatal(err)
	}
	if out.Days != 10 || out.Today != seoulDay(0) || len(out.Daily) != 10 || out.Daily[0].Day != seoulDay(9) {
		t.Fatalf("window: %d %s %d %+v", out.Days, out.Today, len(out.Daily), out.Daily[0])
	}
	// 오늘: 아직 메모리에만 있던 것도 보인다(보기 전에 쓴다)
	last := out.Daily[9]
	if last.Day != seoulDay(0) || last.Users != 2 || last.Platforms["windows"] != 1 || last.Platforms["android"] != 1 || last.Requests != 3 || last.Syncs != 2 {
		t.Fatalf("today: %+v", last)
	}
	if d := out.Daily[0]; d.Users != 2 || d.Requests != 10 || d.Syncs != 4 || len(d.Platforms) != 2 {
		t.Fatalf("9 days ago: %+v", d)
	}
	if d := out.Daily[1]; d.Users != 1 || d.Platforms["windows"] != 1 || d.Platforms["android"] != 0 {
		t.Fatalf("8 days ago: %+v", d)
	}
	if d := out.Daily[5]; d.Users != 0 || len(d.Platforms) != 0 {
		t.Fatalf("empty day: %+v", d)
	}
	if out.Lat.Day != seoulDay(0) || out.Lat.DAU != 2 || out.Lat.WAU != 2 || out.Lat.MAU != 2 {
		t.Fatalf("latest: %+v", out.Lat)
	}
	// 최근 7일, 사람마다 플랫폼별 마지막 판: PC는 오늘 1.0.43으로 올렸다
	if len(out.Versions) != 2 || out.Versions[0] != (activityVersion{"android", "", 1}) || out.Versions[1] != (activityVersion{"windows", "1.0.43", 1}) {
		t.Fatalf("versions: %+v", out.Versions)
	}
	// 다시 온 비율(어제까지): 다음 날 = PC 9→8일 전 하나 / 비교 5, 7일 뒤 = PC · 휴대폰 9→2일 전 / 비교 3
	check := func(name string, base, returned int) {
		r := out.Return[name]
		if r.Base != base || r.Returned != returned || r.Rate == nil || math.Abs(*r.Rate-float64(returned)/float64(base)) > 1e-9 {
			t.Fatalf("return %s: %+v", name, r)
		}
	}
	check("d1", 5, 1)
	check("d7", 3, 2)
	if code, body := get(testAdminToken, "?days=1000"); code != 200 || !strings.Contains(body, `"days":400`) {
		t.Fatalf("days capped: %d", code)
	}
}
