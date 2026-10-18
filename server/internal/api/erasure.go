package api

import (
	"context"
	"encoding/json"
	"errors"
	"log"
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
	if ok {
		return true
	}
	_, err := os.Stat(filepath.Join(j.path+".requests", id+".json"))
	return !errors.Is(err, os.ErrNotExist)
}

// Operators write a separate inbox; only the running server writes the journal.
// This prevents an external request from replacing concurrent in-app deletions.
func QueueErasureRequest(path, id string, now time.Time) error {
	if _, err := uuid.Parse(id); err != nil {
		return err
	}
	if _, err := os.Stat(path); err != nil {
		return err
	}
	dir := path + ".requests"
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	b, err := json.Marshal(ErasureEntry{RequestedAt: now.UTC()})
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".request-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
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
	if err := os.Rename(f.Name(), filepath.Join(dir, id+".json")); err != nil {
		return err
	}
	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
	return nil
}

func (j *ErasureJournal) importRequests() error {
	files, err := os.ReadDir(j.path + ".requests")
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, f := range files {
		if f.IsDir() || filepath.Ext(f.Name()) != ".json" {
			continue
		}
		id := f.Name()[:len(f.Name())-5]
		if _, err := uuid.Parse(id); err != nil {
			return err
		}
		path := filepath.Join(j.path+".requests", f.Name())
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var e ErasureEntry
		if err := json.Unmarshal(b, &e); err != nil {
			return err
		}
		if e.RequestedAt.IsZero() {
			return errors.New("invalid erasure request")
		}
		if err := j.Request(id, e.RequestedAt); err != nil {
			return err
		}
		if err := os.Remove(path); err != nil {
			return err
		}
	}
	return nil
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
		// The hourly sweep still finishes within 30 days. Backups expire sooner.
		if !e.CompletedAt.IsZero() && !e.CompletedAt.After(now.Add(-(29*24+23)*time.Hour)) {
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
	if err := s.cfg.Erasures.importRequests(); err != nil {
		return err
	}
	for id, entry := range s.cfg.Erasures.Entries() {
		if err := s.eraseAccount(ctx, id, entry.CompletedAt.IsZero()); err != nil {
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
	if err := s.eraseAccount(r.Context(), u.ID.String(), true); err != nil {
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
	if s.cfg.KakaoAdmin != "" {
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if s.retryKakaoUnlinks(ctx) != nil {
				log.Print("kakao_unlink_retry_pending")
			}
		}()
	}
}
