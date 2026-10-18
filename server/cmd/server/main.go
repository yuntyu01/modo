package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/yuntyu01/modo/server/internal/api"
)

func main() {
	dsn := env("DATABASE_URL", "postgres://modo:modo@localhost:5432/modo?sslmode=disable")
	addr := ":" + env("PORT", "8080")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	srvAPI := api.New(pool, api.Config{
		KakaoKey:    os.Getenv("KAKAO_REST_API_KEY"),
		KakaoSecret: os.Getenv("KAKAO_CLIENT_SECRET"),
		PublicURL:   env("PUBLIC_URL", "http://127.0.0.1:"+env("PORT", "8080")),
		TrustProxy:  os.Getenv("TRUST_PROXY") == "1",
		RateLimit:   atoi(os.Getenv("RATE_LIMIT")),
	})
	if err := waitAndMigrate(ctx, srvAPI); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	// 오래된 재전송 기록·세션 정리(시작할 때 한 번, 그 뒤 6시간마다)
	go func() {
		for {
			if err := srvAPI.Cleanup(ctx); err != nil && ctx.Err() == nil {
				log.Printf("cleanup: %v", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(6 * time.Hour):
			}
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			http.Error(w, "db down", http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte("ok"))
	})
	srvAPI.Routes(mux)

	srv := &http.Server{Addr: addr, Handler: cors(mux), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		srv.Shutdown(shutdownCtx)
	}()

	log.Printf("listening on %s", addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

// DB 컨테이너가 서버보다 늦게 뜰 수 있어 잠깐 재시도한다.
func waitAndMigrate(ctx context.Context, store *api.Server) error {
	var err error
	for range 30 {
		if err = store.Migrate(ctx); err == nil {
			return nil
		}
		log.Printf("waiting for db: %v", err)
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
