package loan

import (
	"log"
	"math"
	"regexp"
	"strconv"

	"cloudhouse/backend/internal/goldrate"
	"cloudhouse/backend/internal/puritystandard"

	"gorm.io/gorm"
)

// Purity is stored as a plain, unit-suffixed string — "22K" (karat mode)
// or "91.6%" (fineness mode) — rather than a foreign key into
// puritystandard.PurityStandard (a suggestion-only lookup, see that
// package's doc comment). karatRe/finenessRe parse the two accepted
// shapes; range bounds are shared with puritystandard so a value can never
// be stored outside [MinKarat, MaxKarat] / (0, 100] regardless of entry
// point (NewLoan.tsx's ornament rows, the purity re-test flow, or this
// backend validation being hit directly).
var (
	karatRe    = regexp.MustCompile(`^(\d+)K$`)
	finenessRe = regexp.MustCompile(`^(\d+(?:\.\d+)?)%$`)
)

// ParsePurity parses a stored/submitted purity string into its unit and
// numeric value, range-checking it against puritystandard's bounds.
// Returns ErrInvalidPurity for anything that doesn't match either shape or
// falls outside range.
func ParsePurity(purity string) (karat *int, finenessPercent *float64, err error) {
	if m := karatRe.FindStringSubmatch(purity); m != nil {
		k, convErr := strconv.Atoi(m[1])
		if convErr != nil {
			return nil, nil, ErrInvalidPurity
		}
		if vErr := puritystandard.ValidateKarat(k); vErr != nil {
			return nil, nil, ErrInvalidPurity
		}
		return &k, nil, nil
	}
	if m := finenessRe.FindStringSubmatch(purity); m != nil {
		f, convErr := strconv.ParseFloat(m[1], 64)
		if convErr != nil {
			return nil, nil, ErrInvalidPurity
		}
		if vErr := puritystandard.ValidateFineness(f); vErr != nil {
			return nil, nil, ErrInvalidPurity
		}
		return nil, &f, nil
	}
	return nil, nil, ErrInvalidPurity
}

// rateForPurity resolves the per-gram rate for a purity string off the
// day's 24K benchmark: K24 × karat/24 (karat mode) or K24 × fineness%/100
// (fineness mode), rounded to the nearest whole rupee — matching how K24
// itself, and the old independently-entered K22/K18 rates, were always
// whole-rupee figures.
func rateForPurity(gr *goldrate.GoldRate, purity string) (float64, error) {
	karat, fineness, err := ParsePurity(purity)
	if err != nil {
		return 0, err
	}
	switch {
	case karat != nil:
		return math.Round(gr.K24 * float64(*karat) / 24), nil
	case fineness != nil:
		return math.Round(gr.K24 * *fineness / 100), nil
	default:
		return 0, ErrInvalidPurity
	}
}

// normalizedPurityString reformats a parsed purity back into its canonical
// form — "<int>K" or trims a fineness% to its parsed numeric value with a
// "%" suffix — used by NormalizeLegacyPurities so historical rows are
// re-serialized through the exact same path new entries go through.
func normalizedPurityString(karat *int, fineness *float64) string {
	if karat != nil {
		return strconv.Itoa(*karat) + "K"
	}
	return strconv.FormatFloat(*fineness, 'f', -1, 64) + "%"
}

// NormalizeLegacyPurities is a one-time, idempotent migration step run at
// startup (see main.go) that re-parses every existing Ornament.Purity /
// OrnamentPurityTest.TestedPurity string through ParsePurity and
// re-serializes it via normalizedPurityString (e.g. uppercasing/trimming
// legacy "24k"/" 24K " into the canonical "24K"). Historical values like
// "24K"/"22K"/"18K" already conform and round-trip unchanged. Any row that
// fails to parse or falls outside puritystandard's range is left
// untouched and logged for manual review — these already have a computed
// GoldValue tied to history, so an outlier is flagged, never silently
// coerced or recalculated.
func NormalizeLegacyPurities(db *gorm.DB) error {
	if err := normalizeOrnamentPurities(db); err != nil {
		return err
	}
	return normalizePurityTestValues(db)
}

func normalizeOrnamentPurities(db *gorm.DB) error {
	var rows []Ornament
	if err := db.Select("id", "purity").Find(&rows).Error; err != nil {
		return err
	}
	for _, o := range rows {
		karat, fineness, err := ParsePurity(o.Purity)
		if err != nil {
			log.Printf("legacy purity normalization: ornaments.id=%d has unparseable/out-of-range purity %q — left untouched, needs manual review", o.ID, o.Purity)
			continue
		}
		normalized := normalizedPurityString(karat, fineness)
		if normalized == o.Purity {
			continue
		}
		if err := db.Model(&Ornament{}).Where("id = ?", o.ID).Update("purity", normalized).Error; err != nil {
			return err
		}
	}
	return nil
}

func normalizePurityTestValues(db *gorm.DB) error {
	var rows []OrnamentPurityTest
	if err := db.Select("id", "tested_purity").Find(&rows).Error; err != nil {
		return err
	}
	for _, t := range rows {
		karat, fineness, err := ParsePurity(t.TestedPurity)
		if err != nil {
			log.Printf("legacy purity normalization: ornament_purity_tests.id=%d has unparseable/out-of-range tested purity %q — left untouched, needs manual review", t.ID, t.TestedPurity)
			continue
		}
		normalized := normalizedPurityString(karat, fineness)
		if normalized == t.TestedPurity {
			continue
		}
		if err := db.Model(&OrnamentPurityTest{}).Where("id = ?", t.ID).Update("tested_purity", normalized).Error; err != nil {
			return err
		}
	}
	return nil
}
