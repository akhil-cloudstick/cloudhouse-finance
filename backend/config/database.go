package config

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	migrate "github.com/rubenv/sql-migrate"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *ConnPinner
var BaseDB *gorm.DB
var setupHooks []func()

func InitDB() {
	Env = LoadConfig()
	dbHost := getEnv("DB_HOST", "localhost")
	dbPort := getEnv("DB_PORT", "5432")
	dbUser := getEnv("DB_USER", "ambikagold")
	dbPassword := getEnv("DB_PASSWORD", "ambikagold")
	dbName := getEnv("DB_NAME", "ambikagold")
	sslMode := getEnv("DB_SSLMODE", "disable")
	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=%s",
		dbHost, dbPort, dbUser, dbPassword, dbName, sslMode,
	)
	var opts []string
	if v := strings.TrimSpace(os.Getenv("DB_STATEMENT_TIMEOUT")); v != "" {
		opts = append(opts, "-c statement_timeout="+v)
	}
	if v := strings.TrimSpace(os.Getenv("DB_IDLE_TX_TIMEOUT")); v != "" {
		opts = append(opts, "-c idle_in_transaction_session_timeout="+v)
	}
	if len(opts) > 0 {
		dsn += " options='" + strings.Join(opts, " ") + "'"
	}
	log.Printf("Connecting to database %s on %s:%s", dbName, dbHost, dbPort)
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Warn)})
	if err != nil {
		log.Fatalf("Unable to connect to the database: %s", err.Error())
	}
	log.Println("Successfully connected to the database")
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("Failed to get raw database connection: %s", err.Error())
	}
	sqlDB.SetMaxOpenConns(getEnvInt("DB_MAX_OPEN_CONNS", 25))
	sqlDB.SetMaxIdleConns(getEnvInt("DB_MAX_IDLE_CONNS", 5))
	sqlDB.SetConnMaxIdleTime(5 * time.Minute)
	sqlDB.SetConnMaxLifetime(30 * time.Minute)
	migrationsDir := "./migrations"
	if dir := os.Getenv("MIGRATIONS_DIR"); dir != "" {
		migrationsDir = dir
	}
	migrations := &migrate.FileMigrationSource{
		Dir: migrationsDir,
	}
	ctx := context.Background()
	lock, err := sqlDB.Conn(ctx)
	if err != nil {
		log.Fatalf("Failed to reserve a connection for the migration lock: %s", err.Error())
	}
	// poll instead of pg_advisory_lock: a blocked waiter would stall CREATE INDEX CONCURRENTLY forever
	for got := false; !got; {
		if err := lock.QueryRowContext(ctx, `SELECT pg_try_advisory_lock($1)`, 7281946301).Scan(&got); err != nil {
			log.Fatalf("Failed to take the migration lock: %s", err.Error())
		}
		if !got {
			time.Sleep(time.Second)
		}
	}
	migrate.SetIgnoreUnknown(true)
	n, err := migrate.Exec(sqlDB, "postgres", migrations, migrate.Up)
	lock.ExecContext(ctx, `SELECT pg_advisory_unlock($1)`, 7281946301)
	lock.Close()
	if err != nil {
		log.Fatalf("Migration failed: %s", err.Error())
	}
	log.Printf("Applied %d migrations", n)
	var isSuper bool
	var user string
	if err := db.Raw(`SELECT rolsuper, current_user FROM pg_roles WHERE rolname = current_user`).Row().Scan(&isSuper, &user); err != nil {
		log.Printf("Checking whether the database role is a superuser: %v", err)
	} else if isSuper {
		log.Printf("Row-level security is NOT enforced: %q is a PostgreSQL superuser. Point DB_USER at a NOSUPERUSER role so the tenant policies apply; tenant isolation currently rests on the application filter alone.", user)
	}
	if err := RegisterTenantScope(db); err != nil {
		log.Fatalf("Registering tenant isolation failed: %s", err.Error())
	}
	if err := Setup(db, Env); err != nil {
		log.Fatalf("Application setup failed: %s", err.Error())
	}
}

func AfterSetup(f func()) { setupHooks = append(setupHooks, f) }

func Setup(db *gorm.DB, cfg Config) error {
	settingsCipher, err := NewSettingsCipher(cfg.SettingsEncryptionKey)
	if err != nil {
		return fmt.Errorf("settings encryption setup: %w", err)
	}
	aadhaarCipher, err := NewAadhaarCipher(cfg.AadhaarEncryptionKey)
	if err != nil {
		return fmt.Errorf("aadhaar encryption setup: %w", err)
	}
	Env, BaseDB, DB = cfg, db, NewConnPinner(db)
	SettingsCipher, AadhaarCipher = settingsCipher, aadhaarCipher
	PAN, Digilocker, Esign, Razorpay = NewPANClient(cfg), NewDigilockerClient(cfg), NewEsignClient(cfg), NewRazorpayClient(cfg)
	if err := os.MkdirAll(cfg.UploadsDir, 0o755); err != nil {
		return fmt.Errorf("preparing uploads directory: %w", err)
	}
	for _, f := range setupHooks {
		f()
	}
	return nil
}
