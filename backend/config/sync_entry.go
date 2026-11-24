package config

import (
	"context"
	"time"
)

// SyncEntry describes a request that was queued offline and is now being replayed: the UUID the PC gave it
// and when the user actually clicked. A queued entry gets exactly the checks an online save gets; handlers
// only read it to give a new record the UUID the PC chose.
type SyncEntry struct {
	ClientUUID string
	OccurredAt time.Time
}

type syncEntryCtxKey struct{}

func WithSyncEntry(ctx context.Context, e SyncEntry) context.Context {
	return context.WithValue(ctx, syncEntryCtxKey{}, e)
}

func SyncEntryFromContext(ctx context.Context) (SyncEntry, bool) {
	if ctx == nil {
		return SyncEntry{}, false
	}
	e, ok := ctx.Value(syncEntryCtxKey{}).(SyncEntry)
	return e, ok && e.ClientUUID != ""
}
