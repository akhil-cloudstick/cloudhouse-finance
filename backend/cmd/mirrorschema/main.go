// mirrorschema writes the desktop's SQLite schema and table list from the server's models.
// Run it from the backend folder after a model changes:
//
//	go run ./cmd/mirrorschema -out ../frontend/desktop/localstore
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"cloudhouse/backend/common/mirror"
)

func main() {
	out := flag.String("out", ".", "folder to write mirror_schema.sql and mirror_tables.json into")
	flag.Parse()
	ddl, err := mirror.DDL()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	tables, _ := mirror.Tables()
	meta, err := json.MarshalIndent(tables, "", "  ")
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := os.WriteFile(filepath.Join(*out, "mirror_schema.sql"), []byte(ddl), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := os.WriteFile(filepath.Join(*out, "mirror_tables.json"), append(meta, '\n'), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("%d tables written to %s\n", len(tables), *out)
}
