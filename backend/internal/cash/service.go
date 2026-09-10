package cash

import (
	"fmt"
	"time"

	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/platform/httpx"
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
// text like Expense.Mode, but these three are what AddCashModal.tsx's own
// dropdown offers.
const (
	CashModeCash         = "Cash"
	CashModeUPI          = "UPI"
	CashModeBankTransfer = "Bank Transfer"
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

func (s *MovementService) Record(in RecordMovementInput) (*CashMovement, error) {
	if in.Amount <= 0 {
		return nil, ErrInvalidAmount
	}
	if in.Type != "in" && in.Type != "out" {
		return nil, ErrInvalidType
	}

	if in.BranchID != nil {
		ok, err := s.branchRepo.Exists(*in.BranchID)
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

	if err := s.repo.Create(rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(rec.ID)
}

// List returns cash movements, optionally scoped to branchID (nil = all
// branches — Administrator only, see platform.GetBranchScope) and to
// [fromDate, toDate] (zero value on either end means "no bound" on that
// side — the Cash Movements table's default, unfiltered view).
func (s *MovementService) List(branchID *uint, fromDate, toDate time.Time, category string, limit, offset int) ([]CashMovement, int64, error) {
	return s.repo.FindAll(branchID, fromDate, toDate, category, limit, offset)
}

// Get returns the movement by id, or ErrMovementNotFound if it doesn't
// exist OR (when branchID is non-nil) belongs to a different branch (or has
// no branch at all) — a non-admin gets the same "not found" for another
// branch's movement as for a genuinely missing id.
func (s *MovementService) Get(id uint, branchID *uint) (*CashMovement, error) {
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrMovementNotFound
	}
	if branchID != nil && (rec.BranchID == nil || *rec.BranchID != *branchID) {
		return nil, ErrMovementNotFound
	}
	return rec, nil
}

// RecordBankPledgeCashIn creates the cash-in movement for a loan's gold
// being pledged to a bank (loan.CashRecorder, called from
// loan.Service.RecordBankPledge). Source "Bank" mirrors the existing
// "Savings"/"Loan" sources so it renders in the same Cash Movements table
// without special-casing on the frontend. Returns the new movement's ID so
// the caller can store it on the pledge record and reverse it later.
func (s *MovementService) RecordBankPledgeCashIn(loanID uint, bankName string, amount float64, occurredOn time.Time) (uint, error) {
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
	if err := s.repo.Create(rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

// RecordLoanDisbursementCashOut creates the cash-out movement for a loan's
// principal being handed to the customer (loan.CashRecorder, called from
// loan.Service.Approve once a loan clears its final approval stage).
// Purpose carries the loan number so it reads sensibly in the Cash
// Movements table without a dedicated column.
func (s *MovementService) RecordLoanDisbursementCashOut(loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (uint, error) {
	rec := &CashMovement{
		Type:     "out",
		Purpose:  "Loan disbursement — " + loanNumber,
		Amount:   amount,
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = occurredOn
	}
	if err := s.repo.Create(rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

// RecordLoanPaymentCashIn creates the cash-in movement for a customer's loan
// repayment (loan.CashRecorder, called from loan.Service.RecordPayment).
// Source is "Collection" — distinct from the "Savings"/"Loan" sources
// AddCashModal.tsx offers for manually topping up the till (that "Loan"
// source means the branch itself borrowed cash from a bank, unrelated to a
// customer repaying their gold loan).
func (s *MovementService) RecordLoanPaymentCashIn(loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time, paymentType string) (uint, error) {
	rec := &CashMovement{
		Type:     "in",
		Source:   "Collection",
		Purpose:  fmt.Sprintf("%s — %s", paymentType, loanNumber),
		Amount:   amount,
		BranchID: &branchID,
	}
	if occurredOn.IsZero() {
		rec.OccurredOn = time.Now()
	} else {
		rec.OccurredOn = occurredOn
	}
	if err := s.repo.Create(rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

// RecordBankPledgeCashOut creates the cash-out movement for a loan's gold
// being released/returned from a bank (loan.CashRecorder, called from
// loan.Service.ReleaseBankPledge). It does NOT touch the original cash-in
// movement recorded at pledge time — that stays as permanent history —
// this books the release as its own, separately visible transaction.
func (s *MovementService) RecordBankPledgeCashOut(loanID uint, bankName string, amount float64, occurredOn time.Time, branchID uint) (uint, error) {
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
	if err := s.repo.Create(rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
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
func (s *MovementService) RecordAuctionSaleCashIn(loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (uint, error) {
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
	if err := s.repo.Create(rec); err != nil {
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
func (s *MovementService) RecordAuctionSurplusCashOut(loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (uint, error) {
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
	if err := s.repo.Create(rec); err != nil {
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
func (s *MovementService) RecordBankPledgeReleaseExpense(loanID uint, bankName string, amount float64, occurredOn time.Time, branchID uint) (uint, error) {
	return s.recordSystemExpense("Bank Pledge Release", bankName, amount, occurredOn, branchID)
}

// recordSystemExpense creates a pre-approved Expense row for a system-driven
// event (as opposed to a manually entered one, which always starts
// "Pending" — see ExpenseService.Record) since there's no staff member to
// approve it and the amount is already validated by the caller.
func (s *MovementService) recordSystemExpense(category, bankName string, amount float64, occurredOn time.Time, branchID uint) (uint, error) {
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
	if err := s.expenseRepo.Create(rec); err != nil {
		return 0, err
	}
	return rec.ID, nil
}

func strPtr(s string) *string { return &s }

// DeleteCashMovement removes a cash movement outright. No longer called by
// loan.Service (bank-pledge release now books a reversing cash-out entry
// instead of deleting history), kept for any other future caller.
func (s *MovementService) DeleteCashMovement(id uint) error {
	return s.repo.Delete(id)
}

// SetLoanStatus updates the Open/Closed status of a loan-sourced cash-in
// movement, mirroring legacy's setCashLoanStatus/toggleCashLoan. branchID
// (nil for Administrator) must match the movement's branch or
// ErrMovementNotFound is returned before any other validation runs, same
// not-found-on-mismatch guard as Get.
func (s *MovementService) SetLoanStatus(id uint, status string, branchID *uint) (*CashMovement, error) {
	if status != "Open" && status != "Closed" {
		return nil, ErrInvalidStatus
	}
	rec, err := s.repo.FindByID(id)
	if err != nil {
		return nil, ErrMovementNotFound
	}
	if branchID != nil && (rec.BranchID == nil || *rec.BranchID != *branchID) {
		return nil, ErrMovementNotFound
	}
	rec.Status = status
	if err := s.repo.Update(rec); err != nil {
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

func (s *ExpenseService) Record(in RecordExpenseInput) (*Expense, error) {
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
	if ok, err := s.branchRepo.Exists(in.BranchID); err != nil {
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
	if err := s.repo.Create(rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(rec.ID)
}

// List returns expenses, optionally scoped to branchID (nil = all branches
// — Administrator only, see platform.GetBranchScope).
func (s *ExpenseService) List(branchID *uint, limit, offset int) ([]Expense, int64, error) {
	return s.repo.FindAll(branchID, limit, offset)
}

// Get returns the expense by id, or ErrExpenseNotFound if it doesn't exist
// OR (when branchID is non-nil) belongs to a different branch — a
// non-admin gets the same "not found" for another branch's expense as for
// a genuinely missing id.
func (s *ExpenseService) Get(id uint, branchID *uint) (*Expense, error) {
	rec, err := s.repo.FindByID(id)
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
func (s *ExpenseService) Approve(id uint, approvedBy string, branchID *uint) (*Expense, error) {
	rec, err := s.repo.FindByID(id)
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
	if err := s.repo.Update(rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// Reject marks a Pending expense as Rejected. Remarks are required so a
// rejection always carries a reason. branchID (nil for Administrator) must
// match the expense's branch or ErrExpenseNotFound is returned, same
// not-found-on-mismatch guard as Get.
func (s *ExpenseService) Reject(id uint, approvedBy, remarks string, branchID *uint) (*Expense, error) {
	if remarks == "" {
		return nil, ErrRemarksRequired
	}
	rec, err := s.repo.FindByID(id)
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
	if err := s.repo.Update(rec); err != nil {
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

func (s *OpeningBalanceService) Set(branchID uint, date time.Time, amount float64) (*OpeningCashBalance, error) {
	if amount < 0 {
		return nil, ErrInvalidBalance
	}
	if branchID == 0 {
		return nil, ErrBranchRequired
	}
	if ok, err := s.branchRepo.Exists(branchID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ErrBranchInvalid
	}
	if date.IsZero() {
		date = time.Now()
	}
	rec := &OpeningCashBalance{BranchID: branchID, BalanceDate: date, Amount: amount}
	if err := s.repo.Upsert(rec); err != nil {
		return nil, err
	}
	rec.IsSet = true
	return rec, nil
}

// Get returns the opening balance for a branch/date, or a zero-amount
// record with IsSet false if none has been entered yet — the frontend
// always gets a number, plus a way to tell an entered 0 from no entry.
func (s *OpeningBalanceService) Get(branchID uint, date time.Time) (*OpeningCashBalance, error) {
	if date.IsZero() {
		date = time.Now()
	}
	rec, err := s.repo.FindByBranchAndDate(branchID, date)
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

func (s *SummaryService) GetExpectedCash(branchID *uint, date time.Time) (Summary, error) {
	if date.IsZero() {
		date = time.Now()
	}
	var opening float64
	var openingSet bool
	if branchID != nil {
		ob, err := s.openingSvc.Get(*branchID, date)
		if err != nil {
			return Summary{}, err
		}
		opening = ob.Amount
		openingSet = ob.IsSet
	}
	in, out, err := s.movementRepo.SumByTypeAndDate(branchID, date)
	if err != nil {
		return Summary{}, err
	}
	inBreakdown, outBreakdown, err := s.movementRepo.SumBreakdownByDate(branchID, date)
	if err != nil {
		return Summary{}, err
	}
	cashExpenses, err := s.expenseRepo.SumCashByDate(branchID, date)
	if err != nil {
		return Summary{}, err
	}
	expensesToday, err := s.expenseRepo.SumAllByDate(branchID, date)
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
