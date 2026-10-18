package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yuntyu01/modo/server/internal/api"
	"github.com/yuntyu01/modo/server/internal/retention"
)

func main() {
	var logs *retention.Logs
	if dir := os.Getenv("LOG_DIR"); dir != "" {
		var err error
		logs, err = retention.NewLogs(dir)
		if err != nil {
			log.Fatal("log_storage_unavailable")
		}
		log.SetOutput(logs)
	}
	if os.Getenv("APP_ENV") == "production" && (logs == nil || os.Getenv("ERASURE_JOURNAL") == "") {
		log.Fatal("production_retention_configuration_missing")
	}
	journal, err := api.OpenErasureJournal(env("ERASURE_JOURNAL", "var/erasure/journal.json"))
	if err != nil {
		log.Fatal("erasure_journal_unavailable")
	}
	dsn := env("DATABASE_URL", "postgres://modo:modo@localhost:5432/modo?sslmode=disable")
	// KoDeploy injects a SQLAlchemy URL for its managed PostgreSQL dependency.
	dsn = retention.DatabaseURL(dsn)
	addr := ":" + env("PORT", "8080")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatal("database_configuration_failed")
	}
	defer pool.Close()

	srvAPI := api.New(pool, api.Config{
		Erasures:    journal,
		KakaoKey:    os.Getenv("KAKAO_REST_API_KEY"),
		KakaoSecret: os.Getenv("KAKAO_CLIENT_SECRET"),
		PublicURL:   env("PUBLIC_URL", "http://127.0.0.1:"+env("PORT", "8080")),
		TrustProxy:  os.Getenv("TRUST_PROXY") == "1",
		RateLimit:   atoi(os.Getenv("RATE_LIMIT")),
	})
	if err := waitAndMigrate(ctx, srvAPI); err != nil {
		log.Fatal("database_migration_failed")
	}
	if err := srvAPI.ApplyErasures(ctx); err != nil {
		log.Fatal("erasure_reconciliation_failed")
	}
	if os.Getenv("ERASURE_RECONCILE_ONLY") == "1" {
		return
	}

	// Maintenance retries failed erasures hourly and expires operational data.
	go func() {
		for {
			if err := srvAPI.Cleanup(ctx); err != nil && ctx.Err() == nil {
				log.Print("maintenance_failed_retry_pending")
			}
			if logs != nil {
				if err := logs.Prune(); err != nil {
					log.Print("log_expiry_failed")
				}
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Hour):
			}
		}
	}()
	backupsEnabled := os.Getenv("MODO_BACKUPS_ENABLED") == "1"
	backupDir := env("BACKUP_DIR", "/var/lib/modo/backups")
	if backupsEnabled {
		go func() {
			for {
				if err := retention.PruneBackups(backupDir, time.Now()); err != nil {
					log.Print("backup_expiry_failed")
				}
				b, err := os.ReadFile(filepath.Join(backupDir, ".last-success"))
				last, _ := time.Parse(time.RFC3339, string(b))
				if err != nil || time.Since(last) >= 24*time.Hour {
					backupCtx, cancel := context.WithTimeout(ctx, 30*time.Minute)
					if err := retention.Backup(backupCtx, backupDir, dsn, time.Now()); err != nil && ctx.Err() == nil {
						log.Print("backup_failed_retry_pending")
					}
					cancel()
				}
				select {
				case <-ctx.Done():
					return
				case <-time.After(retention.BackupSweep):
				}
			}
		}()
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			http.Error(w, "db down", http.StatusServiceUnavailable)
			return
		}
		for _, entry := range journal.Entries() {
			if entry.CompletedAt.IsZero() && time.Since(entry.RequestedAt) > 7*24*time.Hour {
				http.Error(w, "erasure overdue", 503)
				return
			}
		}
		if backupsEnabled && !retention.BackupHealthy(backupDir, time.Now()) {
			http.Error(w, "backup unhealthy", 503)
			return
		}
		w.Write([]byte("ok"))
	})
	srvAPI.Routes(mux)

	maintenance := filepath.Join(filepath.Dir(env("ERASURE_JOURNAL", "var/erasure/journal.json")), "maintenance")
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := os.Stat(maintenance); err == nil {
			http.Error(w, "maintenance", http.StatusServiceUnavailable)
			return
		}
		cors(mux).ServeHTTP(w, r)
	})
	srv := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	log.Printf("listening on %s", addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal("http_server_failed")
	}
}

// DB 컨테이너가 서버보다 늦게 뜰 수 있어 잠깐 재시도한다.
func waitAndMigrate(ctx context.Context, store *api.Server) error {
	var err error
	for range 30 {
		if err = store.Migrate(ctx); err == nil {
			return nil
		}
		log.Print("database_not_ready_retrying")
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Second):
		}
	}
	return err
}

// 데스크톱(Electron)과 웹 개발용. 네이티브 앱은 CORS를 안 본다.
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
