package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"math"
	"sort"
	"time"

	"gorm.io/gorm"
)

// LedgerSplitLine is one part of a repayment on the main ledger's info popup: what part of the loan it paid
// (penal interest, interest, principal, processing fee) and the mode that part was paid by.
type LedgerSplitLine struct {
	Label  string  `json:"label"`
	Mode   string  `json:"mode,omitempty"`
	Amount float64 `json:"amount"`
}

// allocateToModes shows what a payment was applied to against the modes it was paid by. The parts are met from
// the modes in order, cash first, then UPI, then bank transfer: a part larger than what is left of one mode takes
// the rest of it and carries on with the next, and a mode that was not used is skipped, so the next one covers
// its share. A payment with no modes recorded uses fallbackMode.
func allocateToModes(comps []payComponent, parts splitParts, fallbackMode string, amount float64) []LedgerSplitLine {
	if len(comps) == 0 {
		return nil
	}
	modes := parts.components()
	if len(modes) == 0 {
		modes = []splitComponent{{fallbackMode, amount}}
	}
	var out []LedgerSplitLine
	mi, left := 0, modes[0].amount
	for _, c := range comps {
		need := c.amount
		for need > 0.004 && mi < len(modes) {
			take := math.Min(need, left)
			out = append(out, LedgerSplitLine{Label: c.label, Mode: modes[mi].mode, Amount: common.RoundMoney(take)})
			need -= take
			left -= take
			if left <= 0.004 {
				mi++
				if mi < len(modes) {
					left = modes[mi].amount
				}
			}
		}
	}
	return out
}

// loanRepaymentSplit is how a gold-loan repayment was applied, in the order the loan is paid down (processing fee,
// penal interest, interest, principal), each met from the modes in order. Nil for a payment that is not a repayment
// or whose recorded parts do not add up (an older row), and for an auction sale, whose rows already show each part.
func loanRepaymentSplit(paymentType string, penal, interest, principal, fee, amount float64, parts splitParts, method string) []LedgerSplitLine {
	if paymentType == "Auction Sale" || paymentComponents(paymentType, penal, interest, principal, fee, amount) == nil {
		return nil
	}
	var comps []payComponent
	for _, c := range []payComponent{{"Processing Fee", fee}, {"Penal Interest", penal}, {"Interest", interest}, {"Principal", principal}} {
		if c.amount > 0.004 {
			comps = append(comps, c)
		}
	}
	return allocateToModes(comps, parts, method, amount)
}

// PersonalPayment and PersonalCharge are the plain inputs of PersonalPaymentComponents.
type PersonalPayment struct {
	ID       uint
	At       time.Time
	Amount   float64
	Rollover bool
}

type PersonalCharge struct {
	At     time.Time
	Amount float64
}

// PersonalPaymentComponents works out what each collection on a personal loan paid: outstanding penal interest
// first, then the loan's interest charge until it is used up, then principal. Penal interest is outstanding from
// the moment it was applied. It is worked out from the loan's own entries, in the order the ledger shows them, so
// every payment, old ones included, splits the same way wherever it is shown. A renewal rollover moves no money
// and has no split.
func PersonalPaymentComponents(interestCharge float64, penal []PersonalCharge, payments []PersonalPayment) map[uint][]PayComponent {
	type event struct {
		at     time.Time
		rank   int
		id     uint
		charge float64
		pay    *PersonalPayment
	}
	events := make([]event, 0, len(penal)+len(payments))
	for _, h := range penal {
		events = append(events, event{at: h.At, rank: 3, charge: h.Amount})
	}
	for i := range payments {
		events = append(events, event{at: payments[i].At, rank: 4, id: payments[i].ID, pay: &payments[i]})
	}
	sort.SliceStable(events, func(i, j int) bool {
		a, b := events[i], events[j]
		if !a.at.Equal(b.at) {
			return a.at.Before(b.at)
		}
		if a.rank != b.rank {
			return a.rank < b.rank
		}
		return a.id < b.id
	})
	out := map[uint][]PayComponent{}
	var penalOwing float64
	interestOwing := interestCharge
	for _, e := range events {
		if e.pay == nil {
			penalOwing += e.charge
			continue
		}
		if e.pay.Rollover {
			continue
		}
		rest := e.pay.Amount
		take := func(owing *float64) float64 {
			t := math.Min(rest, math.Max(*owing, 0))
			*owing -= t
			rest -= t
			return t
		}
		pen := take(&penalOwing)
		intr := take(&interestOwing)
		var comps []PayComponent
		for _, c := range []PayComponent{{"Penal Interest", pen}, {"Interest", intr}, {"Principal", rest}} {
			if c.Amount > 0.004 {
				comps = append(comps, c)
			}
		}
		out[e.pay.ID] = comps
	}
	return out
}

// PayComponent is one part of a payment (a label and an amount).
type PayComponent struct {
	Label  string
	Amount float64
}

// PersonalSplitLines allocates a personal loan payment's components against its modes (cash, UPI, bank transfer).
func PersonalSplitLines(comps []PayComponent, cash, upi, bank, cheque float64, method string, amount float64) []LedgerSplitLine {
	inner := make([]payComponent, 0, len(comps))
	for _, c := range comps {
		inner = append(inner, payComponent{c.Label, c.Amount})
	}
	return allocateToModes(inner, splitParts{cash, upi, bank, cheque}, method, amount)
}

// personalSplitsForLoans is the split of every collection of the given personal loans, by payment id. It reads each
// loan's whole history (not just the period the ledger was asked for) because what a payment paid depends on the
// ones before it.
func personalSplitsForLoans(db *gorm.DB, loanIDs []uint) map[uint][]PayComponent {
	out := map[uint][]PayComponent{}
	if len(loanIDs) == 0 {
		return out
	}
	type loanRow struct {
		ID              uint
		InterestAmount  float64
		PrincipalAmount float64
		DisbursedAmount float64
	}
	var loans []loanRow
	if err := db.Table("personal_loans").Select("id, interest_amount, principal_amount, disbursed_amount").Where("id IN ?", loanIDs).Scan(&loans).Error; err != nil {
		return out
	}
	type penalRow struct {
		PersonalLoanID uint
		Amount         float64
		OccurredAt     time.Time
	}
	var penal []penalRow
	if err := db.Table("personal_loan_history").Select("personal_loan_id, amount, occurred_at").
		Where("personal_loan_id IN ? AND event = ?", loanIDs, "penal_applied").Scan(&penal).Error; err != nil {
		return out
	}
	type payRow struct {
		ID             uint
		PersonalLoanID uint
		PaidOn         time.Time
		Amount         float64
		Method         string
	}
	var pays []payRow
	if err := db.Table("personal_loan_payments").Select("id, personal_loan_id, paid_on, amount, method").
		Where("personal_loan_id IN ?", loanIDs).Scan(&pays).Error; err != nil {
		return out
	}
	for _, l := range loans {
		// the interest charged on the loan: what the ledger shows as its Interest line (capped by how much more the
		// principal is than what was handed over)
		interest := math.Max(0, math.Min(l.InterestAmount, l.PrincipalAmount-l.DisbursedAmount))
		var charges []PersonalCharge
		for _, h := range penal {
			if h.PersonalLoanID == l.ID {
				charges = append(charges, PersonalCharge{At: h.OccurredAt, Amount: h.Amount})
			}
		}
		var payments []PersonalPayment
		for _, p := range pays {
			if p.PersonalLoanID == l.ID {
				payments = append(payments, PersonalPayment{ID: p.ID, At: p.PaidOn, Amount: p.Amount, Rollover: p.Method == "Renewal Rollover"})
			}
		}
		for id, comps := range PersonalPaymentComponents(interest, charges, payments) {
			out[id] = comps
		}
	}
	return out
}
