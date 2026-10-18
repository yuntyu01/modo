package api

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestExternalErasureImmediatelyBlocksWithoutOverwritingJournal(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	j, err := OpenErasureJournal(path)
	if err != nil {
		t.Fatal(err)
	}
	inside, outside := uuid.NewString(), uuid.NewString()
	if err := j.Request(inside, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := QueueErasureRequest(path, outside, time.Now()); err != nil {
		t.Fatal(err)
	}
	if !j.Blocked(outside) {
		t.Fatal("running server must immediately block externally requested account")
	}
	if err := j.importRequests(); err != nil {
		t.Fatal(err)
	}
	j, err = OpenErasureJournal(path)
	if err != nil {
		t.Fatal(err)
	}
	if !j.Blocked(inside) || !j.Blocked(outside) {
		t.Fatal("external request lost an existing deletion")
	}
}

func TestJournalSurvivesRestartAndRetainsFailedRequests(t *testing.T) {
	path := filepath.Join(t.TempDir(), "erasure", "journal.json")
	j, err := OpenErasureJournal(path)
	if err != nil {
		t.Fatal(err)
	}
	completed, pending := uuid.NewString(), uuid.NewString()
	now := time.Now().UTC()
	if err := j.Request(completed, now); err != nil {
		t.Fatal(err)
	}
	if err := j.Complete(completed, now); err != nil {
		t.Fatal(err)
	}
	if err := j.Request(pending, now); err != nil {
		t.Fatal(err)
	}
	j, err = OpenErasureJournal(path)
	if err != nil {
		t.Fatal(err)
	}
	if !j.Blocked(completed) || !j.Blocked(pending) {
		t.Fatal("restart lost deletion block")
	}
	if err := j.Prune(now.Add(31 * 24 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	if j.Blocked(completed) || !j.Blocked(pending) {
		t.Fatal("pending deletions must never expire")
	}
	if err := os.WriteFile(path, []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenErasureJournal(path); err == nil {
		t.Fatal("corrupt journal must fail closed")
	}
}

func TestAccountDeletionCascadesAndRestoredAccountsStayDeleted(t *testing.T) {
	j, err := OpenErasureJournal(filepath.Join(t.TempDir(), "journal.json"))
	if err != nil {
		t.Fatal(err)
	}
	previous := testConfig
	testConfig.Erasures = j
	t.Cleanup(func() { testConfig = previous })
	srv, pool := newTestServerDB(t)
	a := signup(t, srv, "erased@example.test")
	b := signup(t, srv, "preserved@example.test")
	ctx := context.Background()
	owned, other := uuid.NewString(), uuid.NewString()
	for _, row := range [][2]string{{owned, a.id}, {other, b.id}} {
		if _, err := pool.Exec(ctx, `INSERT INTO folders(id,owner_id,name,position,created_at,updated_at) VALUES($1,$2,'private','a',1,1)`, row[0], row[1]); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO paragraphs(id,folder_id,text,position,created_at,updated_at) VALUES($1,$2,'private memo','a',1,1)`, uuid.NewString(), row[0]); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO folder_members(folder_id,user_id,role) VALUES($1,$2,'view')`, other, a.id); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO share_links(token,folder_id) VALUES('owned-link',$1)`, owned); err != nil {
		t.Fatal(err)
	}
	if code := a.do("DELETE", "/api/me", map[string]string{"confirmation": "DELETE"}, nil); code != 204 {
		t.Fatalf("delete: %d", code)
	}
	if code := a.do("GET", "/api/me", nil, nil); code != 401 {
		t.Fatalf("deleted session: %d", code)
	}
	if code := b.do("GET", "/api/me", nil, nil); code != 200 {
		t.Fatalf("other user: %d", code)
	}
	for _, table := range []string{"users", "sessions", "password_logins", "folders"} {
		var n int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM `+table).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Fatalf("%s: expected only other user's row, got %d", table, n)
		}
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM paragraphs`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("other memo lost: %d %v", n, err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM share_links`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("owned links remain: %d %v", n, err)
	}
	// Simulate old database contents being restored while the separate journal survives.
	if _, err := pool.Exec(ctx, `INSERT INTO users(id,email) VALUES($1,'restored@example.test')`, a.id); err != nil {
		t.Fatal(err)
	}
	service := New(pool, Config{Erasures: j})
	if err := service.ApplyErasures(ctx); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE id=$1`, a.id).Scan(&n); err != nil || n != 0 {
		t.Fatalf("restored account resurrected: %d %v", n, err)
	}
}

func TestFailedDatabaseDeletionImmediatelyBlocksSessionsAndRetries(t *testing.T) {
	j, err := OpenErasureJournal(filepath.Join(t.TempDir(), "journal.json"))
	if err != nil {
		t.Fatal(err)
	}
	previous := testConfig
	testConfig.Erasures = j
	t.Cleanup(func() { testConfig = previous })
	srv, pool := newTestServerDB(t)
	a := signup(t, srv, "retry@example.test")
	ctx := context.Background()
	_, err = pool.Exec(ctx, `CREATE FUNCTION test_block_erasure() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test outage'; END $$ LANGUAGE plpgsql; CREATE TRIGGER test_block_erasure BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION test_block_erasure()`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DROP FUNCTION IF EXISTS test_block_erasure() CASCADE`) })
	if code := a.do("DELETE", "/api/me", map[string]string{"confirmation": "DELETE"}, nil); code != 202 {
		t.Fatalf("accepted pending deletion: %d", code)
	}
	if code := a.do("GET", "/api/me", nil, nil); code != 401 {
		t.Fatalf("pending erasure session not blocked: %d", code)
	}
	if _, err := pool.Exec(ctx, `DROP FUNCTION test_block_erasure() CASCADE`); err != nil {
		t.Fatal(err)
	}
	if err := New(pool, Config{Erasures: j}).ApplyErasures(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE id=$1`, a.id).Scan(&n); err != nil || n != 0 {
		t.Fatalf("retry did not erase: %d %v", n, err)
	}
}
