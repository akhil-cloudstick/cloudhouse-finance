package localapi

import (
	"context"
	"database/sql"
	"regexp"
	"strings"

	"gorm.io/gorm"
)

// The handlers were written for PostgreSQL. The few Postgres-only forms they use are rewritten here, on the way to
// SQLite, so the same handler code answers from the PC's copy. A query that still cannot run fails with an error and the
// app falls back to the answers it saved earlier.

var (
	reILike   = regexp.MustCompile(`(?i)\bILIKE\b`)
	reNow     = regexp.MustCompile(`(?i)\bNOW\(\)`)
	reCast    = regexp.MustCompile(`::[A-Za-z_]+(\([0-9, ]+\))?`)
	reForLock = regexp.MustCompile(`(?i)\s+FOR\s+(UPDATE|SHARE)(\s+(NOWAIT|SKIP\s+LOCKED))?`)
	reToChar  = regexp.MustCompile(`(?i)to_char\(\s*([A-Za-z0-9_."]+)\s*,\s*'([^']*)'\s*\)`)
	reEpoch   = regexp.MustCompile(`(?i)EXTRACT\(\s*EPOCH\s+FROM\s+([A-Za-z0-9_."]+)\s*\)`)
	reConcat  = regexp.MustCompile(`(?i)\bCONCAT_WS\(`)
)

var toCharParts = strings.NewReplacer("YYYY", "%Y", "MM", "%m", "DD", "%d", "HH24", "%H", "MI", "%M", "SS", "%S")

func rewrite(q string) string {
	q = reILike.ReplaceAllString(q, "LIKE")
	q = reNow.ReplaceAllString(q, "CURRENT_TIMESTAMP")
	q = reCast.ReplaceAllString(q, "")
	q = reForLock.ReplaceAllString(q, "")
	q = reToChar.ReplaceAllStringFunc(q, func(m string) string {
		parts := reToChar.FindStringSubmatch(m)
		return "strftime('" + toCharParts.Replace(parts[2]) + "', " + parts[1] + ")"
	})
	q = reEpoch.ReplaceAllString(q, "CAST(strftime('%s', $1) AS INTEGER)")
	q = reConcat.ReplaceAllString(q, "CONCAT_WS_UNSUPPORTED(")
	return q
}

// pool wraps the SQLite connection so every statement GORM sends goes through rewrite.
type pool struct{ db *sql.DB }

func (p *pool) PrepareContext(ctx context.Context, q string) (*sql.Stmt, error) {
	return p.db.PrepareContext(ctx, rewrite(q))
}

func (p *pool) ExecContext(ctx context.Context, q string, args ...any) (sql.Result, error) {
	return p.db.ExecContext(ctx, rewrite(q), args...)
}

func (p *pool) QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
	return p.db.QueryContext(ctx, rewrite(q), args...)
}

func (p *pool) QueryRowContext(ctx context.Context, q string, args ...any) *sql.Row {
	return p.db.QueryRowContext(ctx, rewrite(q), args...)
}

func (p *pool) BeginTx(ctx context.Context, opts *sql.TxOptions) (gorm.ConnPool, error) {
	tx, err := p.db.BeginTx(ctx, opts)
	if err != nil {
		return nil, err
	}
	return &txPool{tx: tx}, nil
}

type txPool struct{ tx *sql.Tx }

func (p *txPool) PrepareContext(ctx context.Context, q string) (*sql.Stmt, error) {
	return p.tx.PrepareContext(ctx, rewrite(q))
}

func (p *txPool) ExecContext(ctx context.Context, q string, args ...any) (sql.Result, error) {
	return p.tx.ExecContext(ctx, rewrite(q), args...)
}

func (p *txPool) QueryContext(ctx context.Context, q string, args ...any) (*sql.Rows, error) {
	return p.tx.QueryContext(ctx, rewrite(q), args...)
}

func (p *txPool) QueryRowContext(ctx context.Context, q string, args ...any) *sql.Row {
	return p.tx.QueryRowContext(ctx, rewrite(q), args...)
}

func (p *txPool) Commit() error   { return p.tx.Commit() }
func (p *txPool) Rollback() error { return p.tx.Rollback() }
