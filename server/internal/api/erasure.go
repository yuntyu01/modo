package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"
)

// The journal lives on a separate persistent volume, outside database backups.
// It contains only account UUIDs and deletion times; never email or user content.
type ErasureEntry struct {
	RequestedAt time.Time `json:"requested_at"`
	CompletedAt time.Time `json:"completed_at,omitempty"`
}

type ErasureJournal struct {
	mu      sync.RWMutex
	path    string
	entries map[string]ErasureEntry
}

func OpenErasureJournal(path string) (*ErasureJournal, error) {
	if path == "" {
		return nil, errors.New("erasure journal path required")
	}
	j := &ErasureJournal{path: path, entries: map[string]ErasureEntry{}}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	b, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err == nil {
		if err := json.Unmarshal(b, &j.entries); err != nil {
			return nil, err
		}
		if j.entries == nil {
			return nil, errors.New("invalid erasure journal")
		}
		for id, e := range j.entries {
			if _, err := uuid.Parse(id); err != nil || e.RequestedAt.IsZero() {
				return nil, errors.New("invalid erasure entry")
			}
		}
	} else if err := j.saveLocked(); err != nil {
		return nil, err
	}
	return j, nil
}

func (j *ErasureJournal) saveLocked() error {
	b, err := json.Marshal(j.entries)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(j.path+".tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write(b); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Rename(j.path+".tmp", j.path); err != nil {
		return err
	}
	// Persist the directory entry on filesystems that support directory fsync.
	if dir, e := os.Open(filepath.Dir(j.path)); e == nil {
		_ = dir.Sync()
		_ = dir.Close()
	}
	return nil
}

func (j *ErasureJournal) Request(id string, now time.Time) error {
	if _, err := uuid.Parse(id); err != nil {
		return err
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if _, ok := j.entries[id]; ok {
		return nil
	}
	j.entries[id] = ErasureEntry{RequestedAt: now.UTC()}
	if err := j.saveLocked(); err != nil {
		delete(j.entries, id)
		return err
	}
	return nil
}

func (j *ErasureJournal) Blocked(id string) bool {
	if j == nil {
		return false
	}
	j.mu.RLock()
	defer j.mu.RUnlock()
	_, ok := j.entries[id]
	return ok
}

func (j *ErasureJournal) Entries() map[string]ErasureEntry {
	j.mu.RLock()
	defer j.mu.RUnlock()
	out := map[string]ErasureEntry{}
	for id, e := range j.entries {
		out[id] = e
	}
	return out
}

func (j *ErasureJournal) Complete(id string, now time.Time) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	e, ok := j.entries[id]
	if !ok || !e.CompletedAt.IsZero() {
		return nil
	}
	old := e
	e.CompletedAt = now.UTC()
	j.entries[id] = e
	if err := j.saveLocked(); err != nil {
		j.entries[id] = old
		return err
	}
	return nil
}

func (j *ErasureJournal) Prune(now time.Time) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	removed := map[string]ErasureEntry{}
	for id, e := range j.entries {
		if !e.CompletedAt.IsZero() && e.CompletedAt.Before(now.Add(-30*24*time.Hour)) {
			removed[id] = e
			delete(j.entries, id)
		}
	}
	if len(removed) == 0 {
		return nil
	}
	if err := j.saveLocked(); err != nil {
		for id, e := range removed {
			j.entries[id] = e
		}
		return err
	}
	return nil
}

// Reapply the journal before serving requests, including after restoring a backup.
// Failed deletes remain blocked and are retried hourly. Never expire pending work.
func (s *Server) ApplyErasures(ctx context.Context) error {
	if s.cfg.Erasures == nil {
		return nil
	}
	for id := range s.cfg.Erasures.Entries() {
		if _, err := s.db.Exec(ctx, `DELETE FROM users WHERE id = $1`, id); err != nil {
			return err
		}
		if err := s.cfg.Erasures.Complete(id, time.Now()); err != nil {
			return err
		}
	}
	return s.cfg.Erasures.Prune(time.Now())
}

func (s *Server) deleteAccount(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Confirmation string `json:"confirmation"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Confirmation != "DELETE" {
		badRequest(w, "삭제 확인이 필요합니다")
		return
	}
	if s.cfg.Erasures == nil {
		errJSON(w, 503, "server", "삭제 서비스를 사용할 수 없습니다")
		return
	}
	u := userFrom(r.Context())
	// Durable intent must precede deleting the DB. Auth blocks all sessions as soon
	// as this record exists, even if deletion fails and needs a retry.
	if err := s.cfg.Erasures.Request(u.ID.String(), time.Now()); err != nil {
		serverError(w, err)
		return
	}
	if _, err := s.db.Exec(r.Context(), `DELETE FROM users WHERE id = $1`, u.ID); err != nil {
		// Accepted durable request; access is revoked and maintenance retries it.
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "pending"})
		return
	}
	if err := s.cfg.Erasures.Complete(u.ID.String(), time.Now()); err != nil {
		writeJSON(w, http.StatusAccepted, map[string]string{"status": "pending"})
		return
	}
	s.popular.mu.Lock()
	s.popular.data = nil
	s.popular.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}
