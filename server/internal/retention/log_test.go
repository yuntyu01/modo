package retention

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLogRotationExpiresOnlyApplicationFiles(t *testing.T) {
	dir := t.TempDir()
	l, err := NewLogs(dir)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
	l.now = func() time.Time { return now }
	for _, name := range []string{"2026-09-01.log", "2026-10-17.log", "unrelated.log"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("event"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := l.Write([]byte("request_failed\n")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "2026-09-01.log")); !os.IsNotExist(err) {
		t.Fatal("expired log survived")
	}
	for _, name := range []string{"2026-10-17.log", "2026-10-18.log", "unrelated.log"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatal(err)
		}
	}
}
