package demoseed

// Report is what a reset did. It is returned to the CLI (which prints it) and
// serialised to the browser (which shows the operator that the wipe really
// happened and how much came back).
//
// Deleted and Created are separate maps rather than a net figure because they
// answer different questions: Deleted proves the client's edits are gone,
// Created proves the demo is usable again. A single "rows changed" number
// would hide a wipe that succeeded followed by a reseed that half-failed.
type Report struct {
	// Deleted maps table name to rows removed.
	Deleted map[string]int64 `json:"deleted"`
	// Created maps entity name to rows seeded. Keys are UI words
	// ("customers", "gold loans"), not table names, since this is read by a
	// person deciding whether the demo looks right.
	Created map[string]int `json:"created"`
	// FilesRemoved counts upload files deleted from disk.
	FilesRemoved int `json:"filesRemoved"`
	// AdminUsername echoes the login that was preserved. Stating it back is
	// the point: the operator's next action is to sign in again, and this is
	// the assurance that they still can.
	AdminUsername string `json:"adminUsername"`
	DurationMS    int64  `json:"durationMs"`
	SeededAt      string `json:"seededAt"`
}

func newReport() *Report {
	return &Report{
		Deleted: map[string]int64{},
		Created: map[string]int{},
	}
}

func (r *Report) created(entity string, n int) { r.Created[entity] += n }
