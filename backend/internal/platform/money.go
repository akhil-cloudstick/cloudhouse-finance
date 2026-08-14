package platform

import "math"

// RoundMoney rounds a rupee amount to 2 decimal places (half-away-from-zero).
//
// Every monetary field in this codebase is a float64, which cannot represent
// most decimal fractions exactly — 0.1 + 0.2 lands on 0.30000000000000004.
// Left unchecked, those artifacts accumulate through the payment-allocation
// waterfall and leave fractions of a paisa clinging to balances that should
// read as settled, so a loan looks perpetually a hair short of closed.
//
// Call this at every write of a computed money value. It is a mitigation, not
// a cure: the real fix is fixed-point decimals (shopspring/decimal backed by
// NUMERIC(16,2)) across loan/cash/expense/packet, tracked as technical debt.
// Comparisons against zero should still use a small epsilon (the codebase uses
// 0.01) rather than testing for exact equality.
func RoundMoney(f float64) float64 {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return math.Round(f*100) / 100
}
