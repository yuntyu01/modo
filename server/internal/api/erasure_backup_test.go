package api

import (
	"context"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/yuntyu01/modo/server/internal/retention"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestActualBackupRestoreReappliesAccountDeletion(t *testing.T) {
	if _, err := exec.LookPath("pg_dump"); err != nil {
		t.Skip("pg_dump required for restore integration")
	}
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("isolated test database required")
	}
	dir := t.TempDir()
	journal, err := OpenErasureJournal(filepath.Join(dir, "erasures", "journal.json"))
	if err != nil {
		t.Fatal(err)
	}
	previous := testConfig
	testConfig.Erasures = journal
	t.Cleanup(func() { testConfig = previous })
	srv, pool := newTestServerDB(t)
	user := signup(t, srv, "restore-test@example.test")
	ctx := context.Background()
	backupDir := filepath.Join(dir, "backups")
	if err := retention.Backup(ctx, backupDir, dsn, time.Now()); err != nil {
		t.Fatal(err)
	}
	files, err := filepath.Glob(filepath.Join(backupDir, "modo-*.dump"))
	if err != nil || len(files) != 1 {
		t.Fatalf("backup missing: %v", err)
	}
	if code := user.do("DELETE", "/api/me", map[string]string{"confirmation": "DELETE"}, nil); code != 204 {
		t.Fatalf("delete: %d", code)
	}
	srv.Close()
	pool.Close()
	marker := filepath.Join(dir, "erasures", "maintenance")
	if err := retention.Restore(ctx, files[0], dsn, marker, time.Now()); err != nil {
		t.Fatal(err)
	}
	restored, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer restored.Close()
	var n int
	if err := restored.QueryRow(ctx, `SELECT count(*) FROM users WHERE id=$1`, user.id).Scan(&n); err != nil || n != 1 {
		t.Fatalf("fixture did not actually restore deleted user: %d %v", n, err)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatal("restore must keep service in maintenance until reconciliation")
	}
	if err := New(restored, Config{Erasures: journal}).ApplyErasures(ctx); err != nil {
		t.Fatal(err)
	}
	if err := restored.QueryRow(ctx, `SELECT count(*) FROM users WHERE id=$1`, user.id).Scan(&n); err != nil || n != 0 {
		t.Fatalf("restored user resurrected: %d %v", n, err)
	}
}
