package config

import (
	"database/sql"

	migrate "github.com/rubenv/sql-migrate"
)

// migrationSource is the folder's migration files plus a do-nothing stand-in for every migration the
// database already records as applied but this checkout has no file for (one written on another branch).
//
// sql-migrate runs only the files that sort after the LAST applied migration, and it finds that
// position by looking the id up in the file list. When the database's newest entry has no file here
// the lookup fails and it applies nothing at all — every newer migration is silently skipped and the
// log just says "Applied 0 migrations". The stand-ins keep that lookup working, so new files after
// it still run. They are never executed: their ids are already recorded as applied.
func migrationSource(db *sql.DB, dir string) (migrate.MigrationSource, error) {
	files := &migrate.FileMigrationSource{Dir: dir}
	found, err := files.FindMigrations()
	if err != nil {
		return nil, err
	}
	have := make(map[string]bool, len(found))
	for _, m := range found {
		have[m.Id] = true
	}
	// The table does not exist before the first run; then there is nothing to stand in for.
	rows, err := db.Query(`SELECT id FROM gorp_migrations`)
	if err != nil {
		return &migrate.MemoryMigrationSource{Migrations: found}, nil
	}
	defer rows.Close()
	all := append([]*migrate.Migration(nil), found...)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		if !have[id] {
			all = append(all, &migrate.Migration{Id: id})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &migrate.MemoryMigrationSource{Migrations: all}, nil
}
