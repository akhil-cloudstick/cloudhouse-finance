package platform

import (
	"fmt"
	"time"

	"gorm.io/gorm"
)

// Sequence allocates the human-readable codes (LN-00001, CUST-01, …) that
// staff read off screens and documents.
//
// It replaces the previous approach of counting every row that had ever
// existed and adding one, which had three separate faults:
//
//  1. It collided the moment a second business existed — every business's
//     first loan is LN-00001.
//  2. It LEAKED COMMERCIAL INFORMATION across businesses. With a global
//     count, one business's next customer code reveals roughly how many
//     customers the others have. Your paying customers could size each other
//     up from their own screens.
//  3. It was already racy before any of this: two concurrent creates read the
//     same count, generated the same code, and the second died on the unique
//     index as a 500 rather than retrying.
//
// Allocation is a single atomic upsert, so concurrent callers are serialized
// by the row lock and each gets a distinct value.
type Sequence struct {
	TenantID uint   `gorm:"primaryKey"`
	Kind     string `gorm:"primaryKey;size:24"`
	// LastValue is the most recently ALLOCATED value, not the next one — so
	// a fresh sequence starts at 0 and the first Next() returns 1.
	LastValue uint64    `gorm:"not null;default:0"`
	UpdatedAt time.Time `gorm:"autoUpdateTime"`
}

func (Sequence) TableName() string { return "sequences" }

// Sequence kinds. One per human-readable code in the system.
const (
	SeqLoan     = "loan"
	SeqCustomer = "customer"
	SeqEmployee = "employee"
	SeqPacket   = "packet"
	SeqScheme   = "scheme"
)

// NextSequence atomically allocates the next value for (tenant, kind),
// creating the row on first use.
//
// The INSERT ... ON CONFLICT DO UPDATE is what makes this safe: Postgres
// takes a row lock for the duration, so two concurrent callers cannot read
// the same value. Do NOT rewrite this as a read followed by a write.
//
// Pass a transaction as db when the code must be allocated in the same
// transaction as the row that uses it, so a rolled-back create doesn't burn
// a number. Gaps are harmless — a sequence guarantees uniqueness, not
// contiguity — but pointless gaps confuse staff reading a register.
func NextSequence(db *gorm.DB, tenantID uint, kind string) (uint64, error) {
	if tenantID == 0 {
		return 0, fmt.Errorf("platform: NextSequence requires a tenant (kind %q)", kind)
	}
	var next uint64
	err := db.Raw(`
		INSERT INTO sequences (tenant_id, kind, last_value, updated_at)
		VALUES (?, ?, 1, now())
		ON CONFLICT (tenant_id, kind)
		DO UPDATE SET last_value = sequences.last_value + 1, updated_at = now()
		RETURNING last_value`, tenantID, kind).Scan(&next).Error
	if err != nil {
		return 0, err
	}
	return next, nil
}

// SeedSequenceFrom initialises a sequence so the next allocation continues
// after codes that already exist, rather than colliding with them.
//
// Called once per (tenant, kind) during the multi-tenancy backfill: the
// existing installation already has LN-00021, so its loan sequence must
// start from 21, not 0. Only ever raises the value — re-running it, or
// running it after the sequence has moved further on, cannot rewind a
// sequence and hand out a code twice.
func SeedSequenceFrom(db *gorm.DB, tenantID uint, kind string, highest uint64) error {
	if tenantID == 0 {
		return fmt.Errorf("platform: SeedSequenceFrom requires a tenant (kind %q)", kind)
	}
	return db.Exec(`
		INSERT INTO sequences (tenant_id, kind, last_value, updated_at)
		VALUES (?, ?, ?, now())
		ON CONFLICT (tenant_id, kind)
		DO UPDATE SET last_value = GREATEST(sequences.last_value, EXCLUDED.last_value),
		              updated_at = now()`, tenantID, kind, highest).Error
}
