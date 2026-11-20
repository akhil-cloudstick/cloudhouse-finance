package localstore

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// The mirror is a copy of the server's business tables in this PC's database, with the same table and column names.
// mirror_schema.sql and mirror_tables.json are written by the backend (go run ./cmd/mirrorschema) from its models, so
// the two sides cannot disagree about a column. The mirror only ever holds what the server sent: when the schema
// changes, the mirror tables are dropped and filled again by the next download.

//go:embed mirror_schema.sql
var mirrorDDL string

//go:embed mirror_tables.json
var mirrorTablesJSON []byte

type mirrorColumn struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

type mirrorRelation struct {
	Table  string `json:"table"`
	Column string `json:"column"`
}

type mirrorTable struct {
	Name       string           `json:"name"`
	Columns    []mirrorColumn   `json:"columns"`
	PrimaryKey []string         `json:"primary_key"`
	Children   []mirrorRelation `json:"children"`
	colSet     map[string]bool
}

// mirrorDataVersion is raised when what is stored in the mirror tables was wrong (not only when a table changes shape), so
// every PC drops what it holds and downloads again. v2: rows had lost every column whose name has an underscore.
const mirrorDataVersion = "2"

var mirrorTables = map[string]*mirrorTable{}

func init() {
	var list []*mirrorTable
	if err := json.Unmarshal(mirrorTablesJSON, &list); err != nil {
		panic("mirror_tables.json: " + err.Error())
	}
	for _, t := range list {
		t.colSet = map[string]bool{}
		for _, c := range t.Columns {
			t.colSet[c.Name] = true
		}
		mirrorTables[t.Name] = t
	}
}

var uuidLike = regexp.MustCompile(`^[0-9a-fA-F-]{8,64}$`)

const mirrorStateTable = `CREATE TABLE IF NOT EXISTS mirror_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`

// ensureMirror creates the mirror tables, or drops and recreates them when the schema is not the one in this build.
func ensureMirror(db *sql.DB) error {
	sum := sha256.Sum256([]byte(mirrorDDL + "|data v" + mirrorDataVersion))
	want := hex.EncodeToString(sum[:])
	if _, err := db.Exec(mirrorStateTable); err != nil {
		return err
	}
	if _, err := db.Exec(mirrorTempTable); err != nil {
		return err
	}
	var have string
	err := db.QueryRow(`SELECT value FROM mirror_state WHERE key = 'schema_hash'`).Scan(&have)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if have == want {
		return nil
	}
	return inTx(db, func(tx *sql.Tx) error {
		for name := range mirrorTables {
			if _, err := tx.Exec(`DROP TABLE IF EXISTS ` + name); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`DELETE FROM mirror_state`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM mirror_temp`); err != nil {
			return err
		}
		if _, err := tx.Exec(mirrorDDL); err != nil {
			return fmt.Errorf("mirror schema: %w", err)
		}
		_, err := tx.Exec(`INSERT INTO mirror_state (key, value) VALUES ('schema_hash', ?)`, want)
		return err
	})
}

// MirrorTableBatch is what one table gets in a batch.
type MirrorTableBatch struct {
	Table string `json:"table"`
	// Truncate empties the table before the rows go in (a table that is sent whole).
	Truncate bool `json:"truncate"`
	// Refresh removes everything that hangs off these rows (their child rows, and theirs) but keeps the rows themselves, so
	// a parent and its children can be replaced as a set; the new child rows come in the same batch.
	Refresh []int64 `json:"refresh"`
	// Delete removes rows by primary key, with everything that hangs off them.
	Delete []int64 `json:"delete"`
	// Rows are inserted, replacing a row with the same primary key.
	Rows []map[string]any `json:"rows"`
}

// MirrorBatch is applied in one transaction together with the state values (cursors) that go with it.
type MirrorBatch struct {
	Tables []MirrorTableBatch `json:"tables"`
	State  map[string]string  `json:"state"`
}

func mirrorValue(v any) any {
	switch x := v.(type) {
	case nil:
		return nil
	case json.Number:
		if i, err := x.Int64(); err == nil {
			return i
		}
		f, _ := x.Float64()
		return f
	case bool:
		if x {
			return int64(1)
		}
		return int64(0)
	case string:
		return x
	default:
		b, _ := json.Marshal(x)
		return string(b)
	}
}

// MirrorApply writes a batch of rows, deletions and state values in one transaction: all of it, or none.
func (s *Store) MirrorApply(batchJSON string) error {
	db, err := s.conn()
	if err != nil {
		return err
	}
	if len(batchJSON) > maxFile {
		return errors.New("batch is too large")
	}
	var batch MirrorBatch
	dec := json.NewDecoder(bytes.NewReader([]byte(batchJSON)))
	dec.UseNumber()
	if err := dec.Decode(&batch); err != nil {
		return fmt.Errorf("reading the batch: %w", err)
	}
	for _, tb := range batch.Tables {
		if mirrorTables[tb.Table] == nil {
			return fmt.Errorf("table %q is not mirrored", tb.Table)
		}
	}
	for k := range batch.State {
		if !stateKey.MatchString(k) {
			return fmt.Errorf("state name %q is not allowed", k)
		}
	}
	return inTx(db, func(tx *sql.Tx) error {
		var tenant int64
		if err := tx.QueryRow(`SELECT CAST(value AS INTEGER) FROM mirror_state WHERE key = 'tenant'`).Scan(&tenant); err != nil || tenant <= 0 {
			return errors.New("the mirror is not bound to a business yet")
		}
		// removals first, for every table, then the rows: a parent's new children are never removed by its refresh
		for _, tb := range batch.Tables {
			t := mirrorTables[tb.Table]
			if tb.Truncate {
				if _, err := tx.Exec(`DELETE FROM ` + t.Name); err != nil {
					return err
				}
			}
			if err := removeDescendants(tx, t, tb.Refresh); err != nil {
				return err
			}
			if err := removeDescendants(tx, t, tb.Delete); err != nil {
				return err
			}
			for _, id := range tb.Delete {
				if _, err := tx.Exec(`DELETE FROM `+t.Name+` WHERE `+t.PrimaryKey[0]+` = ?`, id); err != nil {
					return err
				}
			}
		}
		for _, tb := range batch.Tables {
			t := mirrorTables[tb.Table]
			if len(tb.Rows) == 0 {
				continue
			}
			names := []string{"tenant_id"}
			marks := []string{"?"}
			for _, c := range t.Columns {
				names = append(names, c.Name)
				marks = append(marks, "?")
			}
			stmt, err := tx.Prepare(`INSERT OR REPLACE INTO ` + t.Name + ` (` + strings.Join(names, ", ") + `) VALUES (` + strings.Join(marks, ", ") + `)`)
			if err != nil {
				return err
			}
			for _, row := range tb.Rows {
				args := make([]any, 0, len(t.Columns)+1)
				args = append(args, tenant)
				for _, c := range t.Columns {
					args = append(args, mirrorValue(row[c.Name]))
				}
				if err := replaceLocalTwin(tx, t, row); err != nil {
					stmt.Close()
					return err
				}
				if _, err := stmt.Exec(args...); err != nil {
					stmt.Close()
					return fmt.Errorf("%s: %w", t.Name, err)
				}
			}
			stmt.Close()
		}
		for k, v := range batch.State {
			if _, err := tx.Exec(`INSERT OR REPLACE INTO mirror_state (key, value) VALUES (?, ?)`, k, v); err != nil {
				return err
			}
		}
		return nil
	})
}

// replaceLocalTwin is how a record made on this PC while offline gives way to the server's own row. A record made offline
// is kept under a negative id and its UUID; when the server's row with the same UUID and its real id arrives, the local
// one (and everything that hung off it) is removed first, so the real id replaces it and nothing is held twice.
func replaceLocalTwin(tx *sql.Tx, t *mirrorTable, row map[string]any) error {
	if !t.colSet["uuid"] {
		return nil
	}
	uuid, _ := row["uuid"].(string)
	if uuid == "" {
		return nil
	}
	pk := t.PrimaryKey[0]
	realID := mirrorValue(row[pk])
	rows, err := tx.Query(`SELECT `+pk+` FROM `+t.Name+` WHERE uuid = ? AND `+pk+` <> ?`, uuid, realID)
	if err != nil {
		return err
	}
	var twins []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		twins = append(twins, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	if err := removeDescendants(tx, t, twins); err != nil {
		return err
	}
	for _, id := range twins {
		if _, err := tx.Exec(`DELETE FROM `+t.Name+` WHERE `+pk+` = ?`, id); err != nil {
			return err
		}
	}
	return nil
}

// removeDescendants deletes the rows that hang off the given rows of table t, level by level.
func removeDescendants(tx *sql.Tx, t *mirrorTable, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	for _, rel := range t.Children {
		child := mirrorTables[rel.Table]
		if child == nil {
			continue
		}
		var childIDs []int64
		for _, id := range ids {
			rows, err := tx.Query(`SELECT `+child.PrimaryKey[0]+` FROM `+child.Name+` WHERE `+rel.Column+` = ?`, id)
			if err != nil {
				return err
			}
			for rows.Next() {
				var cid int64
				if err := rows.Scan(&cid); err != nil {
					rows.Close()
					return err
				}
				childIDs = append(childIDs, cid)
			}
			if err := rows.Err(); err != nil {
				rows.Close()
				return err
			}
			rows.Close()
		}
		if err := removeDescendants(tx, child, childIDs); err != nil {
			return err
		}
		for _, id := range ids {
			if _, err := tx.Exec(`DELETE FROM `+child.Name+` WHERE `+rel.Column+` = ?`, id); err != nil {
				return err
			}
		}
	}
	return nil
}

const mirrorTempTable = `CREATE TABLE IF NOT EXISTS mirror_temp (
	entry_id TEXT NOT NULL,
	tbl      TEXT NOT NULL,
	row_id   INTEGER NOT NULL,
	PRIMARY KEY (entry_id, tbl, row_id)
);`

// MirrorWriteTemp puts the rows an offline change made into the mirror, under temporary (negative) ids, and remembers which
// queued entry made them. The rows are what the screens read until the entry is sent; MirrorDropTemp removes them then.
func (s *Store) MirrorWriteTemp(entryID, batchJSON string) error {
	if !uuidLike.MatchString(entryID) {
		return errors.New("invalid entry id")
	}
	var batch MirrorBatch
	dec := json.NewDecoder(bytes.NewReader([]byte(batchJSON)))
	dec.UseNumber()
	if err := dec.Decode(&batch); err != nil {
		return fmt.Errorf("reading the batch: %w", err)
	}
	for _, tb := range batch.Tables {
		t := mirrorTables[tb.Table]
		if t == nil {
			return fmt.Errorf("table %q is not mirrored", tb.Table)
		}
		for _, row := range tb.Rows {
			if id, err := row[t.PrimaryKey[0]].(json.Number).Int64(); err != nil || id >= 0 {
				return fmt.Errorf("%s: a row made offline needs a negative id", t.Name)
			}
		}
	}
	if err := s.MirrorApply(batchJSON); err != nil {
		return err
	}
	db, err := s.conn()
	if err != nil {
		return err
	}
	return inTx(db, func(tx *sql.Tx) error {
		if _, err := tx.Exec(mirrorTempTable); err != nil {
			return err
		}
		for _, tb := range batch.Tables {
			t := mirrorTables[tb.Table]
			for _, row := range tb.Rows {
				id, _ := row[t.PrimaryKey[0]].(json.Number).Int64()
				if _, err := tx.Exec(`INSERT OR IGNORE INTO mirror_temp (entry_id, tbl, row_id) VALUES (?, ?, ?)`, entryID, t.Name, id); err != nil {
					return err
				}
			}
		}
		return nil
	})
}

// MirrorDropTemp removes the temporary rows a queued entry made, with everything that hangs off them. It is called once the
// entry has been sent, when the server's own rows come down in their place.
func (s *Store) MirrorDropTemp(entryID string) error {
	db, err := s.conn()
	if err != nil {
		return err
	}
	return inTx(db, func(tx *sql.Tx) error {
		if _, err := tx.Exec(mirrorTempTable); err != nil {
			return err
		}
		rows, err := tx.Query(`SELECT tbl, row_id FROM mirror_temp WHERE entry_id = ?`, entryID)
		if err != nil {
			return err
		}
		type ref struct {
			tbl string
			id  int64
		}
		var refs []ref
		for rows.Next() {
			var r ref
			if err := rows.Scan(&r.tbl, &r.id); err != nil {
				rows.Close()
				return err
			}
			refs = append(refs, r)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		for _, r := range refs {
			t := mirrorTables[r.tbl]
			if t == nil {
				continue
			}
			if err := removeDescendants(tx, t, []int64{r.id}); err != nil {
				return err
			}
			if _, err := tx.Exec(`DELETE FROM `+t.Name+` WHERE `+t.PrimaryKey[0]+` = ?`, r.id); err != nil {
				return err
			}
		}
		_, err = tx.Exec(`DELETE FROM mirror_temp WHERE entry_id = ?`, entryID)
		return err
	})
}

// MirrorBindTenant says which business the mirror holds. Every row is stamped with it. If the mirror already holds another
// business's data it is emptied first, so two businesses are never mixed in one file.
func (s *Store) MirrorBindTenant(tenant int64) error {
	if tenant <= 0 {
		return errors.New("invalid business")
	}
	db, err := s.conn()
	if err != nil {
		return err
	}
	return inTx(db, func(tx *sql.Tx) error {
		var have int64
		err := tx.QueryRow(`SELECT CAST(value AS INTEGER) FROM mirror_state WHERE key = 'tenant'`).Scan(&have)
		if err == nil && have == tenant {
			return nil
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		for name := range mirrorTables {
			if _, err := tx.Exec(`DELETE FROM ` + name); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`DELETE FROM mirror_temp`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM mirror_state WHERE key <> 'schema_hash'`); err != nil {
			return err
		}
		_, err = tx.Exec(`INSERT INTO mirror_state (key, value) VALUES ('tenant', ?)`, fmt.Sprint(tenant))
		return err
	})
}

// MirrorState returns a saved state value ("" when there is none).
func (s *Store) MirrorState(key string) (string, error) {
	db, err := s.conn()
	if err != nil {
		return "", err
	}
	var v string
	err = db.QueryRow(`SELECT value FROM mirror_state WHERE key = ?`, key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

// MirrorIDs returns the primary keys held for a table, for the check that drops rows the server no longer has.
func (s *Store) MirrorIDs(table string) ([]int64, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	t := mirrorTables[table]
	if t == nil {
		return nil, fmt.Errorf("table %q is not mirrored", table)
	}
	rows, err := db.Query(`SELECT ` + t.PrimaryKey[0] + ` FROM ` + t.Name)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// MirrorCounts returns how many rows each mirrored table holds.
func (s *Store) MirrorCounts() (map[string]int, error) {
	db, err := s.conn()
	if err != nil {
		return nil, err
	}
	out := map[string]int{}
	for name := range mirrorTables {
		var n int
		if err := db.QueryRow(`SELECT COUNT(*) FROM ` + name).Scan(&n); err != nil {
			return nil, err
		}
		out[name] = n
	}
	return out, nil
}
