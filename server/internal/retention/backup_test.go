package retention

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestBackupExpiryAndFailureHealth(t *testing.T) {
	dir := t.TempDir()
	now := time.Now().UTC()
	for _, name := range []string{"modo-old.dump", "modo-current.dump", "modo-failed.partial", "unrelated.dump"} {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte("synthetic"), 0600); err != nil {
			t.Fatal(err)
		}
		if name != "modo-current.dump" {
			old := now.Add(-31 * 24 * time.Hour)
			if err := os.Chtimes(path, old, old); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := PruneBackups(dir, now); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"modo-old.dump", "modo-failed.partial"} {
		if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Fatal("expired data survived", name)
		}
	}
	for _, name := range []string{"modo-current.dump", "unrelated.dump"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatal(err)
		}
	}
	if BackupHealthy(dir, now) {
		t.Fatal("missing backups must not be healthy")
	}
	if err := os.WriteFile(filepath.Join(dir, ".last-success"), []byte(now.Add(-time.Hour).Format(time.RFC3339)), 0600); err != nil {
		t.Fatal(err)
	}
	if !BackupHealthy(dir, now) {
		t.Fatal("fresh backup unhealthy")
	}
	if err := os.WriteFile(filepath.Join(dir, ".last-error"), []byte(now.Format(time.RFC3339)), 0600); err != nil {
		t.Fatal(err)
	}
	if BackupHealthy(dir, now) {
		t.Fatal("failed backup hidden")
	}
}
