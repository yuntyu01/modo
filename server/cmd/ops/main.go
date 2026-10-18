package main

import (
	"context"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/yuntyu01/modo/server/internal/api"
	"github.com/yuntyu01/modo/server/internal/retention"
	"log"
	"os"
	"path/filepath"
	"time"
)

func main() {
	if dir := os.Getenv("LOG_DIR"); dir != "" {
		logs, err := retention.NewLogs(dir)
		if err != nil {
			log.Fatal("log_storage_unavailable")
		}
		log.SetOutput(logs)
	}
	if len(os.Args) < 2 {
		log.Fatal("operation_required")
	}
	dir := os.Getenv("BACKUP_DIR")
	if dir == "" {
		dir = "/var/lib/modo-backups"
	}
	ctx := context.Background()
	dsn := retention.DatabaseURL(os.Getenv("DATABASE_URL"))
	switch os.Args[1] {
	case "delete-account":
		if len(os.Args) != 3 || os.Getenv("MODO_ACCOUNT_VERIFIED") != os.Args[2] {
			log.Fatal("verified_account_confirmation_required")
		}
		if _, err := uuid.Parse(os.Args[2]); err != nil {
			log.Fatal("invalid_account_id")
		}
		if err := api.QueueErasureRequest(os.Getenv("ERASURE_JOURNAL"), os.Args[2], time.Now()); err != nil {
			log.Fatal("durable_erasure_request_failed")
		}
		pool, err := pgxpool.New(ctx, dsn)
		if err != nil {
			log.Fatal("account_blocked_database_retry_required")
		}
		defer pool.Close()
		if _, err := pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, os.Args[2]); err != nil {
			log.Fatal("account_blocked_erasure_retry_required")
		}
		log.Print("verified_account_erased")
	case "backup-health":
		if !retention.BackupHealthy(dir, time.Now()) {
			os.Exit(1)
		}
	case "backup-once":
		if err := retention.Backup(ctx, dir, dsn, time.Now()); err != nil {
			log.Fatal("backup_failed")
		}
	case "prune-backups":
		if err := retention.PruneBackups(dir, time.Now()); err != nil {
			log.Fatal("backup_expiry_failed")
		}
	case "backups":
		for {
			if err := retention.PruneBackups(dir, time.Now()); err != nil {
				log.Print("backup_expiry_failed")
			}
			b, err := os.ReadFile(filepath.Join(dir, ".last-success"))
			last, _ := time.Parse(time.RFC3339, string(b))
			if err != nil || time.Since(last) >= 24*time.Hour {
				if err := retention.Backup(ctx, dir, dsn, time.Now()); err != nil {
					log.Print("backup_failed_retry_pending")
				}
			}
			time.Sleep(retention.BackupSweep)
		}
	case "restore":
		if len(os.Args) != 3 || os.Getenv("MODO_RESTORE_CONFIRM") != "restore-modo-only" {
			log.Fatal("explicit_modo_restore_confirmation_required")
		}
		journalPath := os.Getenv("ERASURE_JOURNAL")
		if journalPath == "" {
			log.Fatal("separate_erasure_journal_required")
		}
		// Never silently create an empty journal when restoring old account data.
		if _, err := os.Stat(journalPath); err != nil {
			log.Fatal("existing_erasure_journal_required_before_restore")
		}
		marker := filepath.Join(filepath.Dir(journalPath), "maintenance")
		if err := retention.Restore(ctx, os.Args[2], dsn, marker, time.Now()); err != nil {
			log.Fatal("restore_failed_maintenance_remains")
		}
		journal, err := api.OpenErasureJournal(journalPath)
		if err != nil {
			log.Fatal("erasure_journal_failed_maintenance_remains")
		}
		pool, err := pgxpool.New(ctx, dsn)
		if err != nil {
			log.Fatal("database_failed_maintenance_remains")
		}
		defer pool.Close()
		s := api.New(pool, api.Config{Erasures: journal})
		if err := s.Migrate(ctx); err != nil {
			log.Fatal("migration_failed_maintenance_remains")
		}
		if err := s.ApplyErasures(ctx); err != nil {
			log.Fatal("erasure_reapply_failed_maintenance_remains")
		}
		if err := os.Remove(marker); err != nil {
			log.Fatal("maintenance_release_failed")
		}
	default:
		log.Fatal("unknown_operation")
	}
}
