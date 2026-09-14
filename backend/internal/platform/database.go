package platform

import (
	"fmt"
	"strings"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// NewDatabase opens a GORM connection to PostgreSQL using the given config.
func NewDatabase(cfg Config) (*gorm.DB, error) {
	dsn := fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		cfg.DBHost, cfg.DBPort, cfg.DBUser, cfg.DBPassword, cfg.DBName, cfg.DBSSLMode,
	)
	if opts := sessionOptions(cfg); opts != "" {
		dsn += " options='" + opts + "'"
	}

	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Warn),
	})
	if err != nil {
		return nil, fmt.Errorf("connect to postgres: %w", err)
	}

	// Pool limits matter more than they used to. platform.PinTenantConn holds
	// one connection for the whole of each authenticated request, so the pool
	// size — not CPU — is the ceiling on concurrent requests, and an unbounded
	// pool would simply push the failure into Postgres's max_connections as
	// refused connections instead of queueing here.
	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("resolving sql handle: %w", err)
	}
	sqlDB.SetMaxOpenConns(cfg.DBMaxOpenConns)
	sqlDB.SetMaxIdleConns(cfg.DBMaxIdleConns)
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)

	return db, nil
}

// sessionOptions builds the `options` DSN parameter carrying the per-
// connection guards from config.
//
// These bound the blast radius of one business's query on a shared database.
// Every tenant's rows live in the same tables on the same server, so a
// runaway report or a transaction left open by a crashed client does not
// degrade one customer — it degrades all of them, holding locks and a
// connection slot the others need. A statement timeout turns that from an
// outage into one failed request.
//
// Both are empty by default, because the same pool runs migrations: see the
// DBStatementTimeout field comment for why a value short enough to be useful
// here is short enough to abort an index build.
//
// Values are Postgres duration literals ("30s", "500ms", "0" for no limit).
// They are validated only loosely — a malformed one makes the connection
// fail loudly at boot, which is the right time to find out.
func sessionOptions(cfg Config) string {
	var opts []string
	if v := strings.TrimSpace(cfg.DBStatementTimeout); v != "" {
		opts = append(opts, "-c statement_timeout="+v)
	}
	if v := strings.TrimSpace(cfg.DBIdleTxTimeout); v != "" {
		opts = append(opts, "-c idle_in_transaction_session_timeout="+v)
	}
	return strings.Join(opts, " ")
}
