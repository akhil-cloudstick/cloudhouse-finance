package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/modules/Loan/models"
	"fmt"
	"math"
	"strings"
)

// The pure rules of editing an auction's entries: what a sale applies to the loan, the surplus or shortfall it
// leaves, the state the case and the loan end up in, and which already-booked entries a change leaves stale.

const (
	DependentSurplusSettlement = "surplus_settlement"
	DependentShortfallDecision = "shortfall_decision"
	DependentWriteOff          = "write_off"

	decisionKindShortfall  = "Shortfall"
	decisionStatusPursue   = "PursueBalance"
	decisionStatusWriteOff = "WriteOff"
	auctionFinalPending    = "Pending"
	auctionFinalToLoanCo   = "SettledToLoanCo"
	auctionFinalToCustomer = "SettledToCustomer"
	auctionFinalWrittenOff = "WrittenOff"
	auctionMoneyTolerance  = 0.01
)

// saleOutcome is what a sale does to the loan: the money left after expenses, set against what was owed.
type saleOutcome struct {
	Sale      float64 `json:"sale_amount"`
	Expenses  float64 `json:"auction_expenses"`
	Net       float64 `json:"net_proceeds"`
	Debt      float64 `json:"total_debt"`
	Applied   float64 `json:"applied_to_loan"`
	Diff      float64 `json:"surplus_shortfall"` // net - debt, negative for a shortfall
	Surplus   float64 `json:"surplus"`
	Shortfall float64 `json:"shortfall"`
	Covered   bool    `json:"fully_covered"`
}

// computeSaleOutcome mirrors what SaveAuctionSale works out when a sale is first recorded.
func computeSaleOutcome(sale, expenses, debt float64) saleOutcome {
	o := saleOutcome{Sale: common.RoundMoney(sale), Expenses: common.RoundMoney(expenses), Debt: common.RoundMoney(debt)}
	o.Net = common.RoundMoney(o.Sale - o.Expenses)
	o.Covered = o.Net >= o.Debt-auctionMoneyTolerance
	o.Applied = o.Net
	if o.Applied > o.Debt {
		o.Applied = o.Debt
	}
	if o.Applied < 0 {
		o.Applied = 0
	}
	o.Diff = common.RoundMoney(o.Net - o.Debt)
	o.Surplus = common.RoundMoney(math.Max(0, o.Net-o.Debt))
	if !o.Covered {
		o.Shortfall = common.RoundMoney(o.Debt - o.Net)
	}
	return o
}

// AuctionDependent is an entry that was booked because of the sale and no longer agrees with it after a change.
type AuctionDependent struct {
	Kind        string `json:"kind"`
	ID          uint   `json:"id"`
	Description string `json:"description"`
	Current     string `json:"current"`
	Suggested   string `json:"suggested"`
	// Required is true when leaving the entry as it is would make the books disagree, so the change is refused
	// unless the entry is updated too.
	Required bool `json:"required"`
}

// AppliedDependent is one dependent the user chose to update as well.
type AppliedDependent struct {
	Kind string `json:"kind"`
	ID   uint   `json:"id"`
}

type decisionSnap struct {
	ID          uint
	Status      string
	AmountPaid  float64
	Outstanding float64
}

type writeOffSnap struct {
	ID     uint
	Amount float64
}

// auctionSnapshot is what the auction had booked after the sale, before a change. RecordID identifies the
// surplus settlement, which belongs to the auction case itself.
type auctionSnapshot struct {
	RecordID           uint
	SurplusDisposition string
	SurplusAmount      float64
	Decision           *decisionSnap
	WriteOff           *writeOffSnap
}

// auctionMoney writes an amount the way the screens do: ₹ and Indian digit grouping, e.g. ₹1,69,780.00
func auctionMoney(v float64) string {
	whole, frac := math.Modf(math.Abs(v))
	digits := fmt.Sprintf("%.0f", whole)
	if n := len(digits); n > 3 {
		head, tail := digits[:n-3], digits[n-3:]
		var parts []string
		for len(head) > 2 {
			parts = append([]string{head[len(head)-2:]}, parts...)
			head = head[:len(head)-2]
		}
		if head != "" {
			parts = append([]string{head}, parts...)
		}
		digits = strings.Join(parts, ",") + "," + tail
	}
	sign := ""
	if v < 0 {
		sign = "-"
	}
	return fmt.Sprintf("%s₹%s.%02d", sign, digits, int(math.Round(frac*100)))
}

// surplusWording names a surplus settlement the way a person would say it.
func surplusWording(disposition string) string {
	switch disposition {
	case AuctionSurplusRefundedToCustomer:
		return "refunded to the customer"
	case "RecordedAsIncome":
		return "kept as company income"
	}
	return disposition
}

func differs(a, b float64) bool { return math.Abs(a-b) > auctionMoneyTolerance }

// detectDependents lists the entries a change to the sale leaves stale. undo is true when the sale is removed
// altogether (out is then ignored). newWriteOff is the amount the write-off would have to be after the change.
func detectDependents(snap auctionSnapshot, out saleOutcome, newWriteOff float64, undo bool) []AuctionDependent {
	deps := []AuctionDependent{}
	if snap.SurplusDisposition != "" {
		switch {
		case undo:
			deps = append(deps, AuctionDependent{Kind: DependentSurplusSettlement, ID: snap.RecordID, Description: "Surplus settlement, " + surplusWording(snap.SurplusDisposition),
				Current: auctionMoney(snap.SurplusAmount) + " settled", Suggested: "Remove this settlement", Required: true})
		case differs(out.Surplus, snap.SurplusAmount):
			sug := "Change it to " + auctionMoney(out.Surplus)
			if out.Surplus <= auctionMoneyTolerance {
				sug = "No surplus is left, so remove this settlement"
			}
			deps = append(deps, AuctionDependent{Kind: DependentSurplusSettlement, ID: snap.RecordID, Description: "Surplus settlement, " + surplusWording(snap.SurplusDisposition),
				Current: auctionMoney(snap.SurplusAmount) + " settled", Suggested: sug, Required: true})
		}
	}
	if d := snap.Decision; d != nil {
		switch {
		case undo || out.Covered:
			deps = append(deps, AuctionDependent{Kind: DependentShortfallDecision, ID: d.ID, Description: "Shortfall decision (" + d.Status + ")",
				Current: fmt.Sprintf("%s, shortfall %s", d.Status, auctionMoney(d.Outstanding)), Suggested: "Remove the decision", Required: true})
		case differs(out.Shortfall, d.Outstanding) || differs(out.Net, d.AmountPaid):
			deps = append(deps, AuctionDependent{Kind: DependentShortfallDecision, ID: d.ID, Description: "Shortfall decision (" + d.Status + ")",
				Current:   fmt.Sprintf("%s, shortfall %s", d.Status, auctionMoney(d.Outstanding)),
				Suggested: fmt.Sprintf("%s, shortfall %s", d.Status, auctionMoney(out.Shortfall)), Required: d.Status != decisionStatusPursue})
		}
	}
	if w := snap.WriteOff; w != nil {
		switch {
		case undo || out.Covered:
			deps = append(deps, AuctionDependent{Kind: DependentWriteOff, ID: w.ID, Description: "Write-off of the shortfall",
				Current: auctionMoney(w.Amount) + " written off", Suggested: "Remove the write-off", Required: true})
		case differs(newWriteOff, w.Amount):
			deps = append(deps, AuctionDependent{Kind: DependentWriteOff, ID: w.ID, Description: "Write-off of the shortfall",
				Current: auctionMoney(w.Amount) + " written off", Suggested: auctionMoney(newWriteOff) + " written off", Required: true})
		}
	}
	return deps
}

// missingRequired returns the required dependents the user did not choose to update.
func missingRequired(deps []AuctionDependent, applied []AppliedDependent) []AuctionDependent {
	var missing []AuctionDependent
	for _, d := range deps {
		if !d.Required || isApplied(applied, d.Kind, d.ID) {
			continue
		}
		missing = append(missing, d)
	}
	return missing
}

func isApplied(applied []AppliedDependent, kind string, id uint) bool {
	for _, a := range applied {
		if a.Kind == kind && (a.ID == id || a.ID == 0 || id == 0) {
			return true
		}
	}
	return false
}

func missingMessage(missing []AuctionDependent) string {
	parts := make([]string, 0, len(missing))
	for _, m := range missing {
		parts = append(parts, fmt.Sprintf("%s (%s -> %s)", m.Description, m.Current, m.Suggested))
	}
	return "this change also affects entries that were booked from the auction, and they must be updated with it: " + strings.Join(parts, "; ")
}

// casePlan is the state the auction case, its shortfall decision and the loan are left in.
type casePlan struct {
	Stage          string
	Final          string
	DecisionStatus string // "" when there is no shortfall decision
	LoanStatus     string
}

// planCase works out that state. decisionStatus is the existing shortfall decision's status ("" when there is
// none); keepSettlement is true when an already-settled surplus stays settled; autoPursue is true when no
// shortfall decision stage is configured, so a new shortfall is pursued at once.
func planCase(out saleOutcome, decisionStatus string, keepSettlement bool, disposition string, autoPursue bool) casePlan {
	if out.Covered {
		p := casePlan{LoanStatus: models.StatusAuctioned}
		switch {
		case out.Surplus > auctionMoneyTolerance && keepSettlement:
			p.Stage = models.AuctionStageSettled
			p.Final = auctionFinalToLoanCo
			if disposition == AuctionSurplusRefundedToCustomer {
				p.Final = auctionFinalToCustomer
			}
		case out.Surplus > auctionMoneyTolerance:
			p.Stage, p.Final = models.AuctionStageAuctioned, auctionFinalPending
		default:
			p.Stage, p.Final = models.AuctionStageSettled, auctionFinalToLoanCo
		}
		return p
	}
	status := decisionStatus
	if status == "" {
		status = AuctionDecisionPending
		if autoPursue {
			status = decisionStatusPursue
		}
	}
	p := casePlan{DecisionStatus: status}
	switch status {
	case decisionStatusPursue:
		p.Stage, p.Final, p.LoanStatus = models.AuctionStageWithdrawn, auctionFinalPending, models.StatusOverdue
	case decisionStatusWriteOff:
		p.Stage, p.Final, p.LoanStatus = models.AuctionStageSettled, auctionFinalWrittenOff, models.StatusClosed
	default:
		p.Stage, p.Final, p.LoanStatus = models.AuctionStageAuctioned, auctionFinalPending, models.StatusAuctionedBalanceDue
	}
	return p
}
