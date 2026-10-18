package retention

import (
	"net/url"
	"strings"
)

// KoDeploy's PostgreSQL service is private to the app namespace and has TLS
// disabled. Apply that setting only to its injected internal service URL.
func DatabaseURL(dsn string) string {
	managed := strings.HasPrefix(dsn, "postgresql+psycopg2://")
	dsn = strings.Replace(dsn, "postgresql+psycopg2://", "postgresql://", 1)
	u, err := url.Parse(dsn)
	if err == nil && managed && u.Hostname() == "postgres" && u.Query().Get("sslmode") == "" {
		q := u.Query()
		q.Set("sslmode", "disable")
		u.RawQuery = q.Encode()
		return u.String()
	}
	return dsn
}
