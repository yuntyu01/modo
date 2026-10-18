package retention

import (
	"context"
	"errors"
	"io"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// Expire at 29 days, with a 15-minute sweep, to stay below the 30-day ceiling.
const BackupLifetime = 29 * 24 * time.Hour
const BackupSweep = 15 * time.Minute

func PruneBackups(dir string, now time.Time) error {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	files, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, f := range files {
		if f.IsDir() || !strings.HasPrefix(f.Name(), "modo-") {
			continue
		}
		if !strings.HasSuffix(f.Name(), ".dump") && !strings.HasSuffix(f.Name(), ".partial") {
			continue
		}
		info, err := f.Info()
		if err != nil {
			return err
		}
		lifetime := BackupLifetime
		if strings.HasSuffix(f.Name(), ".partial") {
			lifetime = 24 * time.Hour
		}
		if !info.ModTime().After(now.Add(-lifetime)) {
			if err := os.Remove(filepath.Join(dir, f.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}

// Credentials go in child-process environment variables, never command arguments.
func databaseEnv(dsn string) ([]string, error) {
	u, err := url.Parse(dsn)
	if err != nil || u.User == nil || u.Hostname() == "" {
		return nil, errors.New("invalid database URL")
	}
	if u.Scheme != "postgres" && u.Scheme != "postgresql" {
		return nil, errors.New("invalid database scheme")
	}
	password, _ := u.User.Password()
	port := u.Port()
	if port == "" {
		port = "5432"
	}
	env := []string{}
	for _, value := range os.Environ() {
		if !strings.HasPrefix(value, "PG") {
			env = append(env, value)
		}
	}
	ssl := u.Query().Get("sslmode")
	if ssl == "" {
		ssl = "verify-full"
	}
	return append(env, "PGHOST="+u.Hostname(), "PGPORT="+port, "PGUSER="+u.User.Username(), "PGPASSWORD="+password, "PGDATABASE="+strings.TrimPrefix(u.Path, "/"), "PGSSLMODE="+ssl), nil
}

func Backup(ctx context.Context, dir, dsn string, now time.Time) error {
	if err := PruneBackups(dir, now); err != nil {
		return err
	}
	env, err := databaseEnv(dsn)
	if err != nil {
		return err
	}
	name := "modo-" + now.UTC().Format("20060102T150405.000000000Z") + ".dump"
	partial := filepath.Join(dir, strings.TrimSuffix(name, ".dump")+".partial")
	f, err := os.OpenFile(partial, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer os.Remove(partial)
	cmd := exec.CommandContext(ctx, "pg_dump", "--format=custom", "--no-owner", "--no-privileges")
	cmd.Env = env
	cmd.Stdout = f
	cmd.Stderr = io.Discard
	err = cmd.Run()
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil || closeErr != nil {
		_ = os.WriteFile(filepath.Join(dir, ".last-error"), []byte(now.UTC().Format(time.RFC3339)), 0600)
		return errors.New("backup failed; previous successful backups preserved")
	}
	if err := os.Rename(partial, filepath.Join(dir, name)); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, ".last-success"), []byte(now.UTC().Format(time.RFC3339)), 0600)
}

func BackupHealthy(dir string, now time.Time) bool {
	b, err := os.ReadFile(filepath.Join(dir, ".last-success"))
	if err != nil {
		return false
	}
	last, err := time.Parse(time.RFC3339, string(b))
	if err != nil || now.Sub(last) > 26*time.Hour {
		return false
	}
	if b, err := os.ReadFile(filepath.Join(dir, ".last-error")); err == nil {
		if failed, e := time.Parse(time.RFC3339, string(b)); e == nil && failed.After(last) {
			return false
		}
	}
	return true
}

// Restore refuses expired backups and leaves maintenance enabled after any error.
// The caller must reapply the separate erasure journal before removing the marker.
func Restore(ctx context.Context, path, dsn, marker string, now time.Time) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !strings.HasPrefix(filepath.Base(path), "modo-") || !strings.HasSuffix(path, ".dump") || now.Sub(info.ModTime()) > 30*24*time.Hour {
		return errors.New("invalid or expired backup")
	}
	if err := os.MkdirAll(filepath.Dir(marker), 0700); err != nil {
		return err
	}
	if err := os.WriteFile(marker, []byte("restore in progress"), 0600); err != nil {
		return err
	}
	env, err := databaseEnv(dsn)
	if err != nil {
		return err
	}
	cmd := exec.CommandContext(ctx, "pg_restore", "--clean", "--if-exists", "--single-transaction", "--no-owner", "--no-privileges", "--dbname", strings.TrimPrefix(mustURL(dsn).Path, "/"), path)
	cmd.Env = env
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if err := cmd.Run(); err != nil {
		return errors.New("restore failed; service remains in maintenance")
	}
	return nil
}

func mustURL(dsn string) *url.URL { u, _ := url.Parse(dsn); return u }
