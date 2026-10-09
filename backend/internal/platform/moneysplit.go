package platform

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math"

	"cloudhouse/backend/internal/platform/httpx"
)

// splitEpsilon is the tolerance used when comparing a payment's mode
// components against its total — same 0.01 tolerance every package in this
// codebase already uses for money comparisons (see RoundMoney's doc
// comment), centralized here since split-payment validation is now shared
// across loan/personalloan/investment instead of each reimplementing it.
const splitEpsilon = 0.01

// ValidateSplit rejects unless cash+upi+bank+cheque sum to total within
// RoundMoney's usual tolerance — the same "reject, don't clamp" convention
// already used by every overpayment check in this codebase (e.g.
// personalloan.Service.RecordPayment). Call this from every RecordPayment/
// disbursement function that accepts a per-mode breakdown before persisting
// it.
func ValidateSplit(cash, upi, bank, cheque, total float64) error {
	sum := RoundMoney(cash + upi + bank + cheque)
	total = RoundMoney(total)
	if math.Abs(sum-total) > splitEpsilon {
		return httpx.NewBadRequest(fmt.Sprintf(
			"payment breakdown (%.2f) does not match the amount (%.2f)", sum, total))
	}
	return nil
}

// NormalizeSplit is ValidateSplit for callers that also accept "no breakdown
// sent": an all-zero split (older clients) becomes the whole total in Cash,
// which is what those flows always booked before a mode could be chosen. It
// then validates the sum and requires a bank whenever UPI/Bank Transfer/
// Cheque carries money, since those modes land in a bank account.
func NormalizeSplit(cash, upi, bank, cheque, total float64, bankID *uint) (float64, float64, float64, float64, error) {
	if RoundMoney(cash+upi+bank+cheque) == 0 {
		cash = total
	}
	if err := ValidateSplit(cash, upi, bank, cheque, total); err != nil {
		return 0, 0, 0, 0, err
	}
	if upi+bank+cheque > 0 && bankID == nil {
		return 0, 0, 0, 0, httpx.NewBadRequest("bank is required when the payment breakdown includes UPI, Bank Transfer, or Cheque")
	}
	return cash, upi, bank, cheque, nil
}

// DeriveMethod returns the display-only Method/Mode string for a set of
// split amounts: the single mode's name when exactly one component is
// non-zero, "Split" when more than one is, or "" when all are zero. This is
// the one place this logic lives — LoanPayment.Method, PersonalLoanPayment.
// Method, and InvestmentPayout's equivalent are all written through this
// rather than accepting free-text input, per the decision that Method
// becomes derived/display-only going forward.
func DeriveMethod(cash, upi, bank, cheque float64) string {
	type component struct {
		amount float64
		name   string
	}
	components := [...]component{
		{cash, "Cash"},
		{upi, "UPI"},
		{bank, "Bank Transfer"},
		{cheque, "Cheque"},
	}
	var nonZero int
	var only string
	for _, c := range components {
		if c.amount > splitEpsilon {
			nonZero++
			only = c.name
		}
	}
	switch nonZero {
	case 0:
		return ""
	case 1:
		return only
	default:
		return "Split"
	}
}

// NewTransactionGroupID returns a random identifier for CashMovement.
// TransactionGroupID — grouping the several CashMovement rows one split
// payment/disbursement writes (one row per non-zero mode component) as a
// single logical event. Plain random hex, same crypto/rand + hex convention
// already used by internal/upload's randomID, rather than adding a new
// google/uuid dependency for one string field.
func NewTransactionGroupID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		// crypto/rand failing is effectively unrecoverable (no entropy
		// source) — every other caller of rand.Read in this codebase (see
		// internal/upload.randomID) treats it as a real error instead, but
		// this helper's callers all discard errors for a display grouping
		// id that is never a correctness requirement (see CashMovement.
		// TransactionGroupID's doc comment), so degrade instead of failing
		// the whole payment.
		return "tg-fallback"
	}
	return "tg-" + hex.EncodeToString(b)
}
