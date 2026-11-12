package localstore

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// ExportedEntry is one outbox entry as it is handed from one PC's store to another's: when a PC that already has unsent
// entries joins the main PC, they move to the main PC's outbox so they are still sent (see desktop/migrate.go).
type ExportedEntry struct {
	Line      string `json:"line"`
	Status    string `json:"status"` // pending or review
	Message   string `json:"message"`
	Attempts  int    `json:"attempts"`
	CreatedAt int64  `json:"createdAt"`
	ReviewAt  int64  `json:"reviewAt"`
}

// ExportEntries returns every entry the server has not confirmed, oldest first, with its status and the server's reason
// when it was refused. It changes nothing.
func (s *Store) ExportEntries() ([]ExportedEntry, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(`SELECT payload, status, last_error, attempts, created_at, review_at FROM entries ORDER BY seq`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ExportedEntry
	for rows.Next() {
		var e ExportedEntry
		if err := rows.Scan(&e.Line, &e.Status, &e.Message, &e.Attempts, &e.CreatedAt, &e.ReviewAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ImportEntry adds an entry handed over from another PC at the end of the queue, keeping its status (an entry the server
// refused stays in review, with the reason). It returns false, and changes nothing, when the entry is already here, so a
// hand-over that was interrupted can simply be run again.
func (s *Store) ImportEntry(e ExportedEntry) (bool, error) {
	id, targets, err := entryHead(e.Line)
	if err != nil {
		return false, err
	}
	status := e.Status
	if status != statusReview {
		status = statusPending
	}
	msg := e.Message
	if len(msg) > maxMessage {
		msg = msg[:maxMessage]
	}
	created := e.CreatedAt
	if created <= 0 {
		created = time.Now().UnixMilli()
	}
	db, err := s.conn()
	if err != nil {
		return false, err
	}
	added := false
	err = inTx(db, func(tx *sql.Tx) error {
		res, err := tx.Exec(`INSERT INTO entries (entry_id, payload, status, attempts, last_error, created_at, review_at)
			VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(entry_id) DO NOTHING`,
			id, strings.TrimRight(e.Line, "\r\n"), status, e.Attempts, msg, created, e.ReviewAt)
		if err != nil {
			return err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if n == 0 {
			return nil // already here
		}
		added = true
		for _, t := range targets {
			if _, err := tx.Exec(`INSERT OR IGNORE INTO entry_targets (entry_id, target) VALUES (?, ?)`, id, t); err != nil {
				return fmt.Errorf("entry %s: %w", id, err)
			}
		}
		return nil
	})
	if err == nil && added {
		_, _ = db.Exec(`PRAGMA wal_checkpoint(PASSIVE)`)
	}
	return added, err
}
