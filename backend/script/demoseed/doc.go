// Package demoseed wipes a business's records and restores a fixed demo
// dataset.
//
// WHY THIS LIVES IN script/ AND NOT cmd/
//
// The eight existing seeders are `cmd/<name>/main.go` commands, which is the
// Go convention and where a ninth would normally go. This one is different in
// a way that forces a different shape: it must run from TWO places. The
// operator seeds a fresh database from a terminal, but after deployment there
// is no terminal — resets happen mid-day between client meetings, over HTTP,
// via internal/demoreset. A `package main` under cmd/ cannot be imported, so
// the logic would have had to be duplicated or shelled out to `go run`, and
// two copies of a 49-table delete order is exactly the kind of thing that
// rots. So the logic is an ordinary importable package, deliberately placed
// under script/ per instruction, with two thin callers:
//
//	script/demoreset/main.go   → CLI:  go run ./script/demoreset
//	internal/demoreset         → HTTP: POST /api/v1/demo/reset
//
// Go's internal/ rule constrains importERS of internal/, not importEES, so a
// package here can import every internal/* package and still be imported by
// one of them.
//
// WHAT IT GUARANTEES
//
//   - The bootstrap admin login is never touched. Not its row id, username,
//     password hash, role, role id or branch. Reset is safe to run while the
//     operator is logged in; they simply sign in again afterwards.
//   - The same data every time. Every visible value comes from a literal
//     table in fixtures.go, so two resets produce identical records and a
//     rehearsed demo script always matches what is on screen.
//   - Dates relative to the reset. Due-soon, overdue, defaulted and scheduled
//     records are computed from today, so the dashboards demonstrate
//     correctly whenever the demo happens rather than drifting into history.
//
// # WHAT IT IS NOT
//
// Not a test fixture and not a migration. It assumes the schema is already
// current (callers check migrate.CheckSchemaVersion) and it only ever touches
// one business — the one named by the tenant on the context.
package demoseed
