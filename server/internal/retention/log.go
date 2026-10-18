package retention

import (
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Daily files are removed before their first byte can reach 30 days of age.
// Only this application's YYYY-MM-DD.log files are ever eligible for deletion.
type Logs struct {
	mu  sync.Mutex
	dir string
	now func() time.Time
}

func NewLogs(dir string) (*Logs, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	return &Logs{dir: dir, now: time.Now}, nil
}

func (l *Logs) Prune() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.pruneLocked()
}

func (l *Logs) pruneLocked() error {
	files, err := os.ReadDir(l.dir)
	if err != nil {
		return err
	}
	// Leave a full day of headroom for daily filenames and the hourly sweep.
	cutoff := l.now().UTC().Add(-29 * 24 * time.Hour)
	for _, f := range files {
		if f.IsDir() || !strings.HasSuffix(f.Name(), ".log") {
			continue
		}
		day, err := time.Parse("2006-01-02.log", f.Name())
		if err == nil && !day.After(cutoff) {
			if err := os.Remove(filepath.Join(l.dir, f.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}

func (l *Logs) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := l.pruneLocked(); err != nil {
		return 0, err
	}
	f, err := os.OpenFile(filepath.Join(l.dir, l.now().UTC().Format("2006-01-02.log")), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	return f.Write(p)
}

var _ io.Writer = (*Logs)(nil)
