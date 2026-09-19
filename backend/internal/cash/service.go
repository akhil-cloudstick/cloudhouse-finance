package cash

import (
	"context"
	"fmt"
	"time"

	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

var (
	ErrMovementNotFound = httpx.NewNotFound("cash movement not found")
	ErrExpenseNotFound  = httpx.NewNotFound("expense not found")
	ErrInvalidAmount    = httpx.NewBadRequest("amount must be greater than zero")
	ErrInvalidType      = httpx.NewBadRequest("type must be \"in\" or \"out\"")
	ErrSourceRequired   = httpx.NewBadRequest("source is required for cash-in movements")
	ErrBankRequired     = httpx.NewBadRequest("bank is required when source is Loan")
	ErrPurposeRequired  = httpx.NewBadRequest("purpose is required for cash-out movements")
	ErrInvalidStatus    = httpx.NewBadRequest("status must be \"Open\" or \"Closed\"")
	ErrCategoryRequired = httpx.NewBadRequest("category is required")
	ErrModeRequired     = httpx.NewBadRequest("mode is required")
	ErrPayeeRequired    = httpx.NewBadRequest("payee is required")
	ErrBranchRequired   = httpx.NewBadRequest("branch is required")
	ErrBranchInvalid    = httpx.NewBadRequest("branch does not exist")
	// ErrExpenseNotPending is a state conflict (the expense was already
	// decided), not a malformed request.
	ErrExpenseNotPending = httpx.NewConflict("expense has already been approved or rejected")
	ErrRemarksRequired   = httpx.NewBadRequest("remarks are required when rejecting an expense")
	ErrInvalidBalance    = httpx.NewBadRequest("amount must be zero or greater")
	// ErrModeOfCashRequired/ErrBankRequiredForMode back the Mode/Bank
	// fields added to AddCashModal.tsx — distinct from ErrModeRequired/
	// ErrBankRequired above, which are Expense's/Loan-source's own errors.
	ErrModeOfCashRequired  = httpx.NewBadRequest("mode of cash is required for cash-in movements")
	ErrBankRequiredForMode = httpx.NewBadRequest("bank is required when mode is UPI or Bank Transfer")
)

// Cash-in Mode values for RecordMovementInput.Mode/CashMovement.Mode — free
// text like Expense.Mode. Cash/UPI/BankTransfer are what AddCashModal.tsx's
// own dropdown offers; Cheque is additionally one of the four split-payment
// modes recordSplitCashMovement writes (loan/personal-loan repayments and
// disbursement, investment payouts) but is not offered by AddCashModal.tsx
// itself.
const (
	CashModeCash         = "Cash"
	CashModeUPI          = "UPI"
	CashModeBankTransfer = "Bank Transfer"
	CashModeCheque       = "Cheque"
)

// RecordMovementInput mirrors the fields supplied by AddCashModal.tsx /
// CashOutModal.tsx.
type RecordMovementInput struct {
	Type    string // "in" | "out"
	Source  string // "Savings" | "Loan" — required when Type == "in"
	Purpose string // required when Type == "out"
	// Mode is required when Type == "in" — "Cash" | "UPI" | "Bank Transfer"
	// (see the CashMode* constants above).
	Mode       string
	Bank       string
	Amount     float64
	BranchID   *uint // optional — not every cash movement is tied to a till yet
	OccurredOn time.Time
}

// RecordExpenseInput mirrors the fields supplied by ExpenseModal.tsx.
type RecordExpenseInput struct {
	OccurredOn   time.Time
	Category     string
	Amount       float64
	Mode         string
	Payee        string
	BranchID     uint
	Remarks      string
	ReceiptImage string
}

// MovementService implements cash-movement business rules. It also carries
// expenseRepo so it can satisfy loan.CashRecorder's expense-writing method
// (RecordBankPledgeReleaseExpense) without loan having to depend on a second
// cash sub-service.
type MovementService struct {
	repo        *MovementRepository
	expenseRepo *ExpenseRepository
	branchRepo  *branch.Repository
}

func NewMovementService(repo *MovementRepository, expenseRepo *ExpenseRepository, branchRepo *branch.Repository) *MovementService {
	return &MovementService{repo: repo, expenseRepo: expenseRepo, branchRepo: branchRepo}
}

func (s *MovementService) Record(ctx context.Context, in RecordMovementInput) (*CashMovement, error) {
	if in.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	if in.Type != "in" && in.Type != "out" {
		return nil, ErrInvalidType
	}

	if in.BranchID != nil {
		ok, err := s.branchRepo.Exists(ctx, *in.BranchID)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, ErrBranchInvalid
		}
	}

	rec := &CashMovement{
		Type:     in.Type,
		Amount:   in.Amount,
		Mode:     in.Mode,
		Bank:     in.Bank,
		BranchID: in.BranchID,
	}
	if in.OccurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = in.OccurredOn
	}

	if in.Type == "in" {
		if in.Source == "" {
			return nil, ErrSourceRequired
		}
		if in.Mode == "" {
			return nil, ErrModeOfCashRequired
		}
		if in.Source == "Loan" && in.Bank == "" {
			return nil, ErrBankRequired
		}
		if (in.Mode == CashModeUPI || in.Mode == CashModeBankTransfer) && in.Bank == "" {
			return nil, ErrBankRequiredForMode
		}
		rec.Source = in.Source
		if in.Source == "Loan" {
			rec.Status = "Open"
		}
	} else {
		if in.Purpose == "" {
			return nil, ErrPurposeRequired
		}
		rec.Purpose = in.Purpose
	}

	if err := s.repo.Create(ctx, rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(ctx, rec.ID)
}

// List returns cash movements, optionally scoped to branchID (nil = all
// branches — Administrator only, see platform.GetBranchScope) and to
// [fromDate, toDate] (zero value on either end means "no bound" on that
// side — the Cash Movements table's default, unfiltered view).
func (s *MovementService) List(ctx context.Context, branchID *uint, fromDate, toDate time.Time, category string, limit, offset int) ([]CashMovement, int64, error) {
	return s.repo.FindAll(ctx, branchID, fromDate, toDate, category, limit, offset)
}

// PartyTotals is the Party Transactions page's KPI row — Total In / Total
// Out / Net across every movement matching the same filter as the list
// beneath it (not just the current page), plus how many transactions each
// side represents.
type PartyTotals struct {
	TotalIn  float64 `json:"totalIn"`
	TotalOut float64 `json:"totalOut"`
	Net      float64 `json:"net"`
	InCount  int     `json:"inCount"`
	OutCount int     `json:"outCount"`
}

func sumPartyTotals(rows []CashMovement) PartyTotals {
	var t PartyTotals
	for _, m := range rows {
		if m.Type == "in" {
			t.TotalIn += m.Amount
			t.InCount++
		} else {
			t.TotalOut += m.Amount
			t.OutCount++
		}
	}
	t.Net = t.TotalIn - t.TotalOut
	return t
}

// ListCashMovementsByBank returns one page of every cash movement tagged to
// bankID, newest first, plus the TOTAL row count and PartyTotals across
// every matching row (not just the page) — backs the Party Transactions
// page's bank drill-down (GET /cash/parties/bank/:bankId).
func (s *MovementService) ListCashMovementsByBank(ctx context.Context, bankID uint, fromDate, toDate time.Time, limit, offset int) ([]CashMovement, int64, PartyTotals, error) {
	rows, total, err := s.repo.ListByBank(ctx, bankID, fromDate, toDate, limit, offset)
	if err != nil {
		return nil, 0, PartyTotals{}, err
	}
	all, _, err := s.repo.ListByBank(ctx, bankID, fromDate, toDate, 0, 0)
	if err != nil {
		return nil, 0, PartyTotals{}, err
	}
	return rows, total, sumPartyTotals(all), nil
}

// ListCashMovementsByCustomer is ListCashMovementsByBank's counterpart for
// CashMovement.PartyCustomerID — backs the Party Transactions page's
// customer drill-down and CustomerDetail.tsx's "Transactions" tab.
func (s *MovementService) ListCashMovementsByCustomer(ctx context.Context, customerID uint, fromDate, toDate time.Time, limit, offset int) ([]CashMovement, int64, PartyTotals, error) {
	rows, total, err := s.repo.ListByCustomer(ctx, customerID, fromDate, toDate, limit, offset)
	if err != nil {
		return nil, 0, PartyTotals{}, err
	}
	all, _, err := s.repo.ListByCustomer(ctx, customerID, fromDate, toDate, 0, 0)
	if err != nil {
		return nil, 0, PartyTotals{}, err
	}
	return rows, total, sumPartyTotals(all), nil
}

// Get returns the movement by id, or ErrMovementNotFound if it doesn't
// exist OR (when branchID is non-nil) belongs to a different branch (or has
// no branch at all) — a non-admin gets the same "not found" for another
// branch's movement as for a genuinely missing id.
func (s *MovementService) Get(ctx context.Context, id uint, branchID *uint) (*CashMovement, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrMovementNotFound
	}
	if branchID != nil && (rec.BranchID == nil || *rec.BranchID != *branchID) {
		return nil, ErrMovementNotFound
	}
	return rec, nil
}

// splitComponent pairs one payment mode's name with its rupee amount — the
// shape recordSplitCashMovement iterates over.
type splitComponent struct {
	mode   string
	amount float64
}

// recordSplitCashMovement writes one CashMovement row per non-zero
// component in components — the "1 row per mode, not 1 row per payment"
// design Phase 2 settled on, so a plain row-filter+sum still answers "total
// cash in today" / "total UPI in today" without unpacking per-mode columns
// across rows. All rows written for one call share a single
// TransactionGroupID, so the Cash & Expenses / Party Transactions pages can
// still show or collapse them as one logical event.
//
// When every component is zero — a caller with no mode information at all,
// e.g. personal-loan disbursement, which Phase 2's split-payment UI does not
// cover — falls back to writing exactly one legacy-style row for the full
// amount with Mode left blank, matching this codebase's behavior before
// split-mode recording existed. This never silently drops the movement.
//
// base supplies every field except Mode/Amount/TransactionGroupID (Type,
// Source/Purpose, BranchID, OccurredOn, PartyCustomerID, …), pre-populated
// by the caller. Returns the ID of the FIRST row written (so existing
// single-ID callers, e.g. InvestmentPayout.CashMovementID, keep working
// unchanged) plus the shared TransactionGroupID every written row carries —
// callers that need to trace back to the FULL set of rows a split produced
// (not just the first) store the group ID instead of/alongside the single
// ID (see LoanPayment.CashTransactionGroupID).
func (s *MovementService) recordSplitCashMovement(ctx context.Context, base CashMovement, amount float64, components []splitComponent) (uint, string, error) {
	groupID := platform.NewTransactionGroupID()
	var firstID uint
	var wrote int
	for _, c := range components {
		if c.amount <= 0 {
			continue
		}
		rec := base
		rec.Mode = c.mode
		rec.Amount = c.amount
		rec.TransactionGroupID = groupID
		if err := s.repo.Create(ctx, &rec); err != nil {
			return 0, "", err
		}
		if wrote == 0 {
			firstID = rec.ID
		}
		wrote++
	}
	if wrote == 0 {
		rec := base
		rec.Amount = amount
		rec.TransactionGroupID = groupID
		if err := s.repo.Create(ctx, &rec); err != nil {
			return 0, "", err
		}
		firstID = rec.ID
	}
	return firstID, groupID, nil
}

// RecordBankPledgeCashIn creates the cash-in movement for a loan's gold
// being pledged to a bank (loan.CashRecorder, called from
// loan.Service.RecordBankPledge). Source "Bank" mirrors the existing
// "Savings"/"Loan" sources so it renders in the same Cash Movements table
// without special-casing on the frontend. Returns the new movement's ID so
// the caller can store it on the pledge record and reverse it later.
func (s *MovementService) RecordBankPledgeCashIn(ctx context.Context, loanID uint, bankName string, amount float64, occurredOn time.Time) (uint, error) {
	rec := &CashMovement{
		Type:   "in",
		Source: "Bank",
		Bank:   bankName,
		Amount: amount,
	}
	if occurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = occurredOn
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

// RecordServiceChargeCashIn creates the cash-in movement for a
// WithheldFromPayout scheme service charge, booked as company income the
// moment a loan disburses (loan.CashRecorder, called from
// loan.Service.Approve's FinalSanction branch, right alongside the
// disbursement cash-out). Source "Service Charge" is its own value —
// distinct from "Collection" (a customer repayment) — since this is a fee
// the branch itself keeps, not money coming back on a loan already lent.
func (s *MovementService) RecordServiceChargeCashIn(ctx context.Context, loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (uint, error) {
	rec := &CashMovement{
		Type:     "in",
		Source:   "Service Charge",
		Purpose:  "Service charge — " + loanNumber,
		Amount:   amount,
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = occurredOn
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

// RecordLoanDisbursementCashOut creates the cash-out movement(s) for a
// loan's principal being handed to the customer (loan.CashRecorder, called
// from loan.Service.Approve once a loan clears its final approval stage;
// also personalloan.CashRecorder, called from personalloan.Service.
// CreateLoan's disbursement, which has no split-mode UI in Phase 2's scope
// and so always passes all-zero split amounts — recordSplitCashMovement's
// legacy fallback handles that transparently). cashAmount/upiAmount/
// bankTransferAmount/chequeAmount split amount across up to four
// CashMovement rows sharing one TransactionGroupID; customerID (0 = none)
// populates PartyCustomerID for the Party Transactions ledger. Purpose
// carries the loan number so it reads sensibly in the Cash Movements table
// without a dedicated column.
func (s *MovementService) RecordLoanDisbursementCashOut(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, customerID uint) (uint, string, error) {
	base := CashMovement{
		Type:     "out",
		Purpose:  "Loan disbursement — " + loanNumber,
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		base.OccurredOn = time.Now()
	} else {
		base.OccurredOn = occurredOn
	}
	if customerID != 0 {
		base.PartyCustomerID = &customerID
	}
	return s.recordSplitCashMovement(ctx, base, amount, []splitComponent{
		{CashModeCash, cashAmount},
		{CashModeUPI, upiAmount},
		{CashModeBankTransfer, bankTransferAmount},
		{CashModeCheque, chequeAmount},
	})
}

// RecordLoanTopUpCashOut creates the cash-out movement(s) for a gold-loan
// top-up (loan.CashRecorder, called from loan.Service.TopUpLoan) — the same
// per-mode-row + TransactionGroupID convention as
// RecordLoanDisbursementCashOut, since a top-up is functionally an
// additional disbursement.
func (s *MovementService) RecordLoanTopUpCashOut(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, customerID uint) (uint, string, error) {
	base := CashMovement{
		Type:     "out",
		Purpose:  "Loan top-up — " + loanNumber,
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		base.OccurredOn = time.Now()
	} else {
		base.OccurredOn = occurredOn
	}
	if customerID != 0 {
		base.PartyCustomerID = &customerID
	}
	return s.recordSplitCashMovement(ctx, base, amount, []splitComponent{
		{CashModeCash, cashAmount},
		{CashModeUPI, upiAmount},
		{CashModeBankTransfer, bankTransferAmount},
		{CashModeCheque, chequeAmount},
	})
}

// RecordLoanPaymentCashIn creates the cash-in movement(s) for a customer's
// loan repayment (loan.CashRecorder, called from loan.Service.RecordPayment;
// also personalloan.CashRecorder, called from personalloan.Service.
// RecordPayment). Source is "Collection" — distinct from the "Savings"/
// "Loan" sources AddCashModal.tsx offers for manually topping up the till
// (that "Loan" source means the branch itself borrowed cash from a bank,
// unrelated to a customer repaying their gold loan). See
// RecordLoanDisbursementCashOut for the split/customerID parameters.
func (s *MovementService) RecordLoanPaymentCashIn(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, paymentType string, customerID uint) (uint, string, error) {
	base := CashMovement{
		Type:     "in",
		Source:   "Collection",
		Purpose:  fmt.Sprintf("%s — %s", paymentType, loanNumber),
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		base.OccurredOn = time.Now()
	} else {
		base.OccurredOn = occurredOn
	}
	if customerID != 0 {
		base.PartyCustomerID = &customerID
	}
	return s.recordSplitCashMovement(ctx, base, amount, []splitComponent{
		{CashModeCash, cashAmount},
		{CashModeUPI, upiAmount},
		{CashModeBankTransfer, bankTransferAmount},
		{CashModeCheque, chequeAmount},
	})
}

// RecordBankPledgeCashOut creates the cash-out movement for a loan's gold
// being released/returned from a bank (loan.CashRecorder, called from
// loan.Service.ReleaseBankPledge). It does NOT touch the original cash-in
// movement recorded at pledge time — that stays as permanent history —
// this books the release as its own, separately visible transaction.
func (s *MovementService) RecordBankPledgeCashOut(ctx context.Context, loanID uint, bankName string, amount float64, occurredOn time.Time, branchID uint) (uint, error) {
	rec := &CashMovement{
		Type:     "out",
		Purpose:  "Bank pledge release — " + bankName,
		Bank:     bankName,
		Amount:   amount,
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = occurredOn
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

// RecordInvestmentDepositCashIn creates the cash-in movement for an
// investor's deposit (investment.CashRecorder, called from
// investment.Service.CreateInvestment). Source "Investment" is distinct
// from "Collection"/"Loan"/"Savings" so deposits are told apart from
// ordinary loan repayments in the Cash Movements table and in reports —
// money coming IN from a depositor is a fundamentally different event from
// money coming IN as a loan repayment.
func (s *MovementService) RecordInvestmentDepositCashIn(ctx context.Context, investmentID uint, investmentNumber string, amount float64, branchID uint, occurredOn time.Time) (uint, error) {
	rec := &CashMovement{
		Type:     "in",
		Source:   "Investment",
		Purpose:  "Investment deposit — " + investmentNumber,
		Amount:   amount,
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = occurredOn
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

// RecordInvestmentPayoutCashOut creates the cash-out movement(s) for an
// interest payout or final principal return on an investment
// (investment.CashRecorder, called from investment.Service.MarkPayoutPaid).
// payoutType carries "Interest payout" or "Principal return" so it reads
// sensibly in the Cash Movements table without a dedicated column —
// mirrors RecordLoanDisbursementCashOut's Purpose-carries-context approach.
// See RecordLoanDisbursementCashOut for the split/customerID parameters.
func (s *MovementService) RecordInvestmentPayoutCashOut(ctx context.Context, investmentID uint, investmentNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, payoutType string, customerID uint) (uint, string, error) {
	base := CashMovement{
		Type:     "out",
		Purpose:  fmt.Sprintf("%s — %s", payoutType, investmentNumber),
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		base.OccurredOn = time.Now()
	} else {
		base.OccurredOn = occurredOn
	}
	if customerID != 0 {
		base.PartyCustomerID = &customerID
	}
	return s.recordSplitCashMovement(ctx, base, amount, []splitComponent{
		{CashModeCash, cashAmount},
		{CashModeUPI, upiAmount},
		{CashModeBankTransfer, bankTransferAmount},
		{CashModeCheque, chequeAmount},
	})
}

// RecordAuctionSaleCashIn creates the cash-in movement for the NET proceeds of
// an auction — sale price less auction expenses (loan.CashRecorder, called
// from loan.Service.RecordAuctionSale).
//
// Before this existed, an auction recorded no cash movement of any kind: staff
// entered what the gold sold for, the loan balance was forced to zero, and
// money the branch genuinely received never appeared in the books at all.
//
// Source is "Auction" rather than "Collection" so auction realisations can be
// told apart from ordinary customer repayments in the Cash Movements table and
// in reports — they are a fundamentally different event, being the proceeds of
// selling a customer's asset rather than a payment made by them.
func (s *MovementService) RecordAuctionSaleCashIn(ctx context.Context, loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (uint, error) {
	rec := &CashMovement{
		Type:     "in",
		Source:   "Auction",
		Purpose:  "Auction sale proceeds — " + loanNumber,
		Amount:   amount,
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = occurredOn
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

// RecordAuctionSurplusCashOut books the refund of an auction surplus back to
// the customer (loan.CashRecorder, called from loan.Service.SettleAuction for
// the RefundedToCustomer disposition only).
//
// Where gold fetched more than the debt, the excess is the customer's money.
// The full net proceeds were already booked in by RecordAuctionSaleCashIn, so
// this cash-out is what actually takes the surplus back out of the till when it
// is handed over. Retaining the surplus as company income deliberately books
// NO movement — the money is already in the till, and booking it again would
// count the same rupees twice.
func (s *MovementService) RecordAuctionSurplusCashOut(ctx context.Context, loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (uint, error) {
	rec := &CashMovement{
		Type:     "out",
		Purpose:  "Auction surplus refunded to customer — " + loanNumber,
		Amount:   amount,
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = occurredOn
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

// RecordGoldSaleCashIn creates the cash-in movement for the business selling
// gold it owns (called from GoldSaleService.Create). Source "GoldSale" is
// distinct from "Collection"/"Auction"/"Savings"/"Loan" so it is told apart
// from a customer repayment or an auction realisation in the Cash Movements
// table, in reports, and in SumBreakdownByDate's GoldSales bucket.
func (s *MovementService) RecordGoldSaleCashIn(ctx context.Context, ornamentType string, amount float64, branchID uint, occurredOn time.Time) (uint, error) {
	rec := &CashMovement{
		Type:     "in",
		Source:   "GoldSale",
		Purpose:  "Gold sale — " + ornamentType,
		Amount:   amount,
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = occurredOn
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

// RecordGoldSaleCashOut creates the cash-out movement for what the business
// originally paid to acquire the gold it just sold (called from
// GoldSaleService.Create, alongside RecordGoldSaleCashIn's cash-in for the
// sale proceeds) — so the acquisition cost shows up in the Cash Movements
// table and offsets Expected Cash the same way any other cash-out does,
// not just the net profit. Purpose's "Gold purchase cost — " prefix is
// what SumBreakdownByDate's GoldPurchases bucket matches on.
func (s *MovementService) RecordGoldSaleCashOut(ctx context.Context, ornamentType string, amount float64, branchID uint, occurredOn time.Time) (uint, error) {
	rec := &CashMovement{
		Type:     "out",
		Purpose:  "Gold purchase cost — " + ornamentType,
		Amount:   amount,
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = occurredOn
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

// RecordBankPledgeReleaseExpense books a bank pledge's release/cash-out as
// an auto-approved Expense entry (loan.CashRecorder, called from
// loan.Service.ReleaseBankPledge), alongside RecordBankPledgeCashOut. This
// is the ONLY expense in the pledge cycle — pledging books cash in and
// nothing else, since the bank's advance is borrowing rather than spending.
//
// Mode is "Bank" (not "Cash") so it is excluded from
// ExpenseRepository.SumCashByDate and doesn't double-count against Expected
// Cash in Hand, which already reflects the matching cash-out movement.
func (s *MovementService) RecordBankPledgeReleaseExpense(ctx context.Context, loanID uint, bankName string, amount float64, occurredOn time.Time, branchID uint) (uint, error) {
	return s.recordSystemExpense(ctx, "Bank Pledge Release", bankName, amount, occurredOn, branchID)
}

// recordSystemExpense creates a pre-approved Expense row for a system-driven
// event (as opposed to a manually entered one, which always starts
// "Pending" — see ExpenseService.Record) since there's no staff member to
// approve it and the amount is already validated by the caller.
func (s *MovementService) recordSystemExpense(ctx context.Context, category, bankName string, amount float64, occurredOn time.Time, branchID uint) (uint, error) {
	now := time.Now()
	rec := &Expense{
		Category:   category,
		Amount:     amount,
		Mode:       "Bank",
		Payee:      bankName,
		BranchID:   branchID,
		Status:     "Approved",
		Remarks:    "Auto-recorded from bank pledge workflow",
		ApprovedBy: strPtr("System"),
		ApprovedAt: &now,
	}
	if occurredOn.IsZero() {
		rec.OccurredOn = now
	} else {
		rec.OccurredOn = occurredOn
	}
	if err := s.expenseRepo.Create(ctx, rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

func strPtr(s string) *string { return &s }

// DeleteCashMovement removes a cash movement outright. No longer called by
// loan.Service (bank-pledge release now books a reversing cash-out entry
// instead of deleting history), kept for any other future caller.
func (s *MovementService) DeleteCashMovement(ctx context.Context, id uint) error {
	return s.repo.Delete(ctx, id)
}

// DeleteLoanDisbursementCashMovements retracts the cash-out entry (or
// entries, if the payout was split across modes) recorded for a loan's
// disbursement, plus the withheld-service-charge cash-in if there was
// one — the exact set RecordLoanDisbursementCashOut/
// RecordServiceChargeCashIn together write at FinalSanction. Called by
// loan.Service.UpdateLoan (loan.CashRecorder) right before a materially
// edited, already-disbursed loan is resubmitted for approval: it will be
// disbursed again at the new amount once it clears the chain, so the old
// figure must not linger alongside the new one in Cash & Expenses.
func (s *MovementService) DeleteLoanDisbursementCashMovements(ctx context.Context, loanNumber string) error {
	return s.repo.DeleteByPurposes(ctx, []string{
		"Loan disbursement — " + loanNumber,
		"Service charge — " + loanNumber,
	})
}

// SetLoanStatus updates the Open/Closed status of a loan-sourced cash-in
// movement, mirroring legacy's setCashLoanStatus/toggleCashLoan. branchID
// (nil for Administrator) must match the movement's branch or
// ErrMovementNotFound is returned before any other validation runs, same
// not-found-on-mismatch guard as Get.
func (s *MovementService) SetLoanStatus(ctx context.Context, id uint, status string, branchID *uint) (*CashMovement, error) {
	if status != "Open" && status != "Closed" {
		return nil, ErrInvalidStatus
	}
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrMovementNotFound
	}
	if branchID != nil && (rec.BranchID == nil || *rec.BranchID != *branchID) {
		return nil, ErrMovementNotFound
	}
	rec.Status = status
	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// ExpenseService implements expense-register business rules.
type ExpenseService struct {
	repo       *ExpenseRepository
	branchRepo *branch.Repository
}

func NewExpenseService(repo *ExpenseRepository, branchRepo *branch.Repository) *ExpenseService {
	return &ExpenseService{repo: repo, branchRepo: branchRepo}
}

func (s *ExpenseService) Record(ctx context.Context, in RecordExpenseInput) (*Expense, error) {
	if in.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	if in.Category == "" {
		return nil, ErrCategoryRequired
	}
	if in.Mode == "" {
		return nil, ErrModeRequired
	}
	if in.Payee == "" {
		return nil, ErrPayeeRequired
	}
	if in.BranchID == 0 {
		return nil, ErrBranchRequired
	}
	if ok, err := s.branchRepo.Exists(ctx, in.BranchID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ErrBranchInvalid
	}

	occurredOn := in.OccurredOn
	if occurredOn.IsZero() {
		occurredOn = time.Now()
	}
	rec := &Expense{
		OccurredOn:   occurredOn,
		Category:     in.Category,
		Amount:       in.Amount,
		Mode:         in.Mode,
		Payee:        in.Payee,
		BranchID:     in.BranchID,
		Status:       "Pending",
		Remarks:      in.Remarks,
		ReceiptImage: in.ReceiptImage,
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(ctx, rec.ID)
}

// List returns expenses, optionally scoped to branchID (nil = all branches
// — Administrator only, see platform.GetBranchScope).
func (s *ExpenseService) List(ctx context.Context, branchID *uint, limit, offset int) ([]Expense, int64, error) {
	return s.repo.FindAll(ctx, branchID, limit, offset)
}

// Get returns the expense by id, or ErrExpenseNotFound if it doesn't exist
// OR (when branchID is non-nil) belongs to a different branch — a
// non-admin gets the same "not found" for another branch's expense as for
// a genuinely missing id.
func (s *ExpenseService) Get(ctx context.Context, id uint, branchID *uint) (*Expense, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrExpenseNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, ErrExpenseNotFound
	}
	return rec, nil
}

// Approve marks a Pending expense as Approved. Only Pending expenses can be
// approved — an already-decided expense must be re-recorded, not amended.
// branchID (nil for Administrator) must match the expense's branch or
// ErrExpenseNotFound is returned, same not-found-on-mismatch guard as Get.
func (s *ExpenseService) Approve(ctx context.Context, id uint, approvedBy string, branchID *uint) (*Expense, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrExpenseNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, ErrExpenseNotFound
	}
	if rec.Status != "Pending" {
		return nil, ErrExpenseNotPending
	}
	now := time.Now()
	rec.Status = "Approved"
	if approvedBy != "" {
		rec.ApprovedBy = &approvedBy
	}
	rec.ApprovedAt = &now
	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// Reject marks a Pending expense as Rejected. Remarks are required so a
// rejection always carries a reason. branchID (nil for Administrator) must
// match the expense's branch or ErrExpenseNotFound is returned, same
// not-found-on-mismatch guard as Get.
func (s *ExpenseService) Reject(ctx context.Context, id uint, approvedBy, remarks string, branchID *uint) (*Expense, error) {
	if remarks == "" {
		return nil, ErrRemarksRequired
	}
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrExpenseNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, ErrExpenseNotFound
	}
	if rec.Status != "Pending" {
		return nil, ErrExpenseNotPending
	}
	now := time.Now()
	rec.Status = "Rejected"
	rec.Remarks = remarks
	if approvedBy != "" {
		rec.ApprovedBy = &approvedBy
	}
	rec.ApprovedAt = &now
	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// OpeningBalanceService implements the opening-cash-balance business rules:
// one entry per branch per day, entered by authorized staff at day start.
type OpeningBalanceService struct {
	repo       *OpeningBalanceRepository
	branchRepo *branch.Repository
}

func NewOpeningBalanceService(repo *OpeningBalanceRepository, branchRepo *branch.Repository) *OpeningBalanceService {
	return &OpeningBalanceService{repo: repo, branchRepo: branchRepo}
}

func (s *OpeningBalanceService) Set(ctx context.Context, branchID uint, date time.Time, amount float64) (*OpeningCashBalance, error) {
	if amount < 0 {
		return nil, ErrInvalidBalance
	}
	if branchID == 0 {
		return nil, ErrBranchRequired
	}
	if ok, err := s.branchRepo.Exists(ctx, branchID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ErrBranchInvalid
	}
	if date.IsZero() {
		date = time.Now()
	}
	rec := &OpeningCashBalance{BranchID: branchID, BalanceDate: date, Amount: amount}
	if err := s.repo.Upsert(ctx, rec); err != nil {
		return nil, err
	}
	rec.IsSet = true
	return rec, nil
}

// Get returns the opening balance for a branch/date, or a zero-amount
// record with IsSet false if none has been entered yet — the frontend
// always gets a number, plus a way to tell an entered 0 from no entry.
func (s *OpeningBalanceService) Get(ctx context.Context, branchID uint, date time.Time) (*OpeningCashBalance, error) {
	if date.IsZero() {
		date = time.Now()
	}
	rec, err := s.repo.FindByBranchAndDate(ctx, branchID, date)
	if err != nil {
		return &OpeningCashBalance{BranchID: branchID, BalanceDate: date, Amount: 0}, nil
	}
	rec.IsSet = true
	return rec, nil
}

// Summary is the computed Expected Cash in Hand breakdown:
// Opening + Collections − Disbursements − Cash Expenses = Expected.
type Summary struct {
	OpeningCash float64 `json:"openingCash"`
	// OpeningCashSet mirrors OpeningCashBalance.IsSet for the requested
	// branch/day — false when no opening balance has been entered yet (or
	// when no branch was requested, since the figure is per-branch).
	OpeningCashSet bool    `json:"openingCashSet"`
	Collections    float64 `json:"collections"`
	Disbursements  float64 `json:"disbursements"`
	CashExpenses   float64 `json:"cashExpenses"`
	// ExpensesToday is every non-rejected expense for the day (any Mode —
	// Cash, UPI, Bank), unlike CashExpenses which only counts Mode "Cash"
	// and is the one that actually offsets ExpectedCash below. Exists so
	// the frontend's "Expenses (today)" KPI can show a true day total
	// without recomputing it client-side from the (branch-unscoped)
	// expense list.
	ExpensesToday float64 `json:"expensesToday"`
	ExpectedCash  float64 `json:"expectedCash"`

	// CollectionsBreakdown/DisbursementsBreakdown split Collections/
	// Disbursements above into the sources that actually feed them (see
	// MovementRepository.SumBreakdownByDate) — real numbers for the
	// frontend's KPI subtitles instead of a static label naming sources
	// without measuring them.
	CollectionsBreakdown   CashInBreakdown  `json:"collectionsBreakdown"`
	DisbursementsBreakdown CashOutBreakdown `json:"disbursementsBreakdown"`
}

// SummaryService computes Summary from the movement, expense, and opening
// balance repositories for a given day/branch.
type SummaryService struct {
	movementRepo *MovementRepository
	expenseRepo  *ExpenseRepository
	openingSvc   *OpeningBalanceService
}

func NewSummaryService(movementRepo *MovementRepository, expenseRepo *ExpenseRepository, openingSvc *OpeningBalanceService) *SummaryService {
	return &SummaryService{movementRepo: movementRepo, expenseRepo: expenseRepo, openingSvc: openingSvc}
}

func (s *SummaryService) GetExpectedCash(ctx context.Context, branchID *uint, date time.Time) (Summary, error) {
	if date.IsZero() {
		date = time.Now()
	}
	var opening float64
	var openingSet bool
	if branchID != nil {
		ob, err := s.openingSvc.Get(ctx, *branchID, date)
		if err != nil {
			return Summary{}, err
		}
		opening = ob.Amount
		openingSet = ob.IsSet
	}
	in, out, err := s.movementRepo.SumByTypeAndDate(ctx, branchID, date)
	if err != nil {
		return Summary{}, err
	}
	inBreakdown, outBreakdown, err := s.movementRepo.SumBreakdownByDate(ctx, branchID, date)
	if err != nil {
		return Summary{}, err
	}
	cashExpenses, err := s.expenseRepo.SumCashByDate(ctx, branchID, date)
	if err != nil {
		return Summary{}, err
	}
	expensesToday, err := s.expenseRepo.SumAllByDate(ctx, branchID, date)
	if err != nil {
		return Summary{}, err
	}
	return Summary{
		OpeningCash:            opening,
		OpeningCashSet:         openingSet,
		Collections:            in,
		Disbursements:          out,
		CashExpenses:           cashExpenses,
		ExpensesToday:          expensesToday,
		ExpectedCash:           opening + in - out - cashExpenses,
		CollectionsBreakdown:   inBreakdown,
		DisbursementsBreakdown: outBreakdown,
	}, nil
}

// RecordGoldSaleInput mirrors the fields supplied by the "Gold Sale" form on
// the Cash & Expenses page.
type RecordGoldSaleInput struct {
	OrnamentType string
	SoldAmount   float64
	// CostAmount is what the business paid to acquire this gold, entered by
	// staff at sale time — no separate purchase-inventory record exists to
	// look this up from yet (see GoldSale's own doc comment).
	CostAmount float64
	SoldOn     time.Time
	BranchID   uint
	Remarks    string
}

var (
	ErrOrnamentTypeRequired = httpx.NewBadRequest("ornament type is required")
	ErrInvalidSoldAmount    = httpx.NewBadRequest("sold amount must be greater than zero")
	ErrInvalidCostAmount    = httpx.NewBadRequest("cost amount must be zero or greater")
	ErrGoldSaleNotFound     = httpx.NewNotFound("gold sale not found")
)

// GoldSaleService implements gold-sale business rules: the business selling
// gold it owns and booking the proceeds into Cash-in-Hand.
type GoldSaleService struct {
	repo        *GoldSaleRepository
	movementSvc *MovementService
	branchRepo  *branch.Repository
}

func NewGoldSaleService(repo *GoldSaleRepository, movementSvc *MovementService, branchRepo *branch.Repository) *GoldSaleService {
	return &GoldSaleService{repo: repo, movementSvc: movementSvc, branchRepo: branchRepo}
}

// Create records a gold sale and books its matching cash-in movement in one
// step — profit is computed here (SoldAmount − CostAmount) rather than left
// for the frontend to derive, so it can never disagree with what's stored.
func (s *GoldSaleService) Create(ctx context.Context, in RecordGoldSaleInput) (*GoldSale, error) {
	if in.OrnamentType == "" {
		return nil, ErrOrnamentTypeRequired
	}
	if in.SoldAmount <= 0 {
		return nil, ErrInvalidSoldAmount
	}
	if in.CostAmount < 0 {
		return nil, ErrInvalidCostAmount
	}
	if in.BranchID == 0 {
		return nil, ErrBranchRequired
	}
	if ok, err := s.branchRepo.Exists(ctx, in.BranchID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ErrBranchInvalid
	}

	soldOn := in.SoldOn
	if soldOn.IsZero() {
		soldOn = time.Now()
	}

	movementID, err := s.movementSvc.RecordGoldSaleCashIn(ctx, in.OrnamentType, in.SoldAmount, in.BranchID, soldOn)
	if err != nil {
		return nil, err
	}

	// The cost cash-out is only booked when there's an actual cost to
	// record — a 0 cost genuinely moved no cash (e.g. gold received as a
	// gift or already owned before this feature existed), so booking a
	// ₹0 movement would just be noise in the Cash Movements table.
	var costMovementID *uint
	if in.CostAmount > 0 {
		id, err := s.movementSvc.RecordGoldSaleCashOut(ctx, in.OrnamentType, in.CostAmount, in.BranchID, soldOn)
		if err != nil {
			return nil, err
		}
		costMovementID = &id
	}

	rec := &GoldSale{
		OrnamentType:       in.OrnamentType,
		SoldAmount:         in.SoldAmount,
		CostAmount:         in.CostAmount,
		Profit:             in.SoldAmount - in.CostAmount,
		SoldOn:             soldOn,
		BranchID:           in.BranchID,
		CashMovementID:     &movementID,
		CostCashMovementID: costMovementID,
		Remarks:            in.Remarks,
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(ctx, rec.ID)
}

// List returns gold sales, optionally scoped to branchID (nil = all
// branches — Administrator only, see platform.GetBranchScope) and to
// [fromDate, toDate] (zero value on either end means "no bound" on that
// side).
func (s *GoldSaleService) List(ctx context.Context, branchID *uint, fromDate, toDate time.Time, limit, offset int) ([]GoldSale, int64, error) {
	return s.repo.FindAll(ctx, branchID, fromDate, toDate, limit, offset)
}

// Get returns the gold sale by id, or ErrGoldSaleNotFound if it doesn't
// exist OR (when branchID is non-nil) belongs to a different branch — a
// non-admin gets the same "not found" for another branch's sale as for a
// genuinely missing id.
func (s *GoldSaleService) Get(ctx context.Context, id uint, branchID *uint) (*GoldSale, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrGoldSaleNotFound
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, ErrGoldSaleNotFound
	}
	return rec, nil
}
