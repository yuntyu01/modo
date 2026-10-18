package retention

import "testing"

func TestManagedDatabaseURL(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"postgresql+psycopg2://u:p@postgres:5432/app", "postgresql://u:p@postgres:5432/app?sslmode=disable"},
		{"postgresql+psycopg2://u:p@public.example/app", "postgresql://u:p@public.example/app"},
		{"postgresql+psycopg2://u:p@postgres/app?sslmode=verify-full", "postgresql://u:p@postgres/app?sslmode=verify-full"},
		{"postgres://u:p@postgres/app", "postgres://u:p@postgres/app"},
	} {
		if got := DatabaseURL(tc.in); got != tc.want {
			t.Errorf("got %q, want %q", got, tc.want)
		}
	}
}
