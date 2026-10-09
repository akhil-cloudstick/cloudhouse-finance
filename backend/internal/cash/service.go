package cash

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
	"cloudhouse/backend/internal/workflow"
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
	ErrFromBankRequired    = httpx.NewBadRequest("from bank is required when mode is not Cash")
	ErrExpenseBankRequired = httpx.NewBadRequest("from bank is required when mode is UPI or Bank")

	// Loan Details block errors (AddCashModal.tsx's "Source of Cash" ==
	// "Loan") — Bank/Loan Number/Principal Amount are required; Interest
	// Rate/Duration are optional (see LoanCashSource's own doc comment).
	ErrLoanBankRequired      = httpx.NewBadRequest("bank is required for a loan-sourced cash entry")
	ErrLoanNumberRequired    = httpx.NewBadRequest("loan number is required for a loan-sourced cash entry")
	ErrLoanPrincipalRequired = httpx.NewBadRequest("principal amount must be greater than zero for a loan-sourced cash entry")
	ErrCashSourceNotFound    = httpx.NewNotFound("cash source not found")

	ErrCashSourceNameRequired = httpx.NewBadRequest("name is required")
	ErrCashSourceReserved     = httpx.NewBadRequest("\"Gold Sale\" is a built-in source")
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

// GoldPurchaseCostPrefix starts the Purpose of a gold sale's cost cash-out
// (RecordGoldSaleCashOut) — matched by SumBreakdownByDate.
const GoldPurchaseCostPrefix = "Gold purchase cost — "

// RecordMovementInput mirrors the fields supplied by AddCashModal.tsx /
// CashOutModal.tsx.
type RecordMovementInput struct {
	Type    string // "in" | "out"
	Source  string // "Savings" | "Loan" — required when Type == "in"
	Purpose string // required when Type == "out"
	// Mode is required when Type == "in" — "Cash" | "UPI" | "Bank Transfer"
	// (see the CashMode* constants above).
	Mode   string
	Bank   string
	BankID *uint // real FK behind Bank — "From Bank" for a UPI/Bank Transfer-mode movement
	// ToBankID is the destination account for a bank-to-bank transfer — see
	// CashMovement.ToBankID's doc comment.
	ToBankID     *uint
	Amount       float64
	ReceiptImage string // optional bill
	BranchID     *uint  // optional — not every cash movement is tied to a till yet
	OccurredOn   time.Time
}

// RecordExpenseInput mirrors the fields supplied by ExpenseModal.tsx.
type RecordExpenseInput struct {
	OccurredOn time.Time
	Category   string
	Amount     float64
	Mode       string
	Payee      string
	// FromBankID/ToBankID — see Expense.FromBankID's doc comment.
	FromBankID   *uint
	ToBankID     *uint
	BranchID     uint
	Remarks      string
	ReceiptImage string
}

// LoanSourceInput mirrors AddCashModal.tsx's "Loan Details" block, sent
// alongside RecordMovementInput when Source == "Loan". BankID/LoanNumber/
// PrincipalAmount are required; InterestRate/DurationMonths are optional.
type LoanSourceInput struct {
	BankID          uint
	LoanNumber      string
	PrincipalAmount float64
	InterestRate    *float64
	DurationMonths  *int
}

// MovementService implements cash-movement business rules. It also carries
// expenseRepo so it can satisfy loan.CashRecorder's expense-writing method
// (RecordBankPledgeReleaseExpense) without loan having to depend on a second
// cash sub-service.
type MovementService struct {
	repo           *MovementRepository
	expenseRepo    *ExpenseRepository
	branchRepo     *branch.Repository
	loanSourceRepo *LoanCashSourceRepository
	// sourceRepo/categoryRepo back loan sources — see SetLoanSourceLookups.
	sourceRepo   *CashSourceRepository
	categoryRepo *ExpenseCategoryRepository
}

func NewMovementService(repo *MovementRepository, expenseRepo *ExpenseRepository, branchRepo *branch.Repository, loanSourceRepo *LoanCashSourceRepository) *MovementService {
	return &MovementService{repo: repo, expenseRepo: expenseRepo, branchRepo: branchRepo, loanSourceRepo: loanSourceRepo}
}

// SetLoanSourceLookups wires the cash-source/expense-category lists a loan
// source needs: its bank/number/principal live on the CashSource row, and
// its repayments are expenses in the same-named ExpenseCategory.
func (s *MovementService) SetLoanSourceLookups(sourceRepo *CashSourceRepository, categoryRepo *ExpenseCategoryRepository) {
	s.sourceRepo = sourceRepo
	s.categoryRepo = categoryRepo
}

// IsLoanSource reports whether a cash source name is a bank loan — any
// name starting with "Loan", case-insensitive ("Loan", "Loan HDFC 4471").
func IsLoanSource(name string) bool {
	return strings.HasPrefix(strings.ToLower(strings.TrimSpace(name)), "loan")
}

// LoanBalance is a loan source's position: the balance starts at Principal,
// each Add Cash drawn from it lowers it and each approved repayment (an
// expense in its same-named category) raises it back, never above Principal.
type LoanBalance struct {
	Principal float64 `json:"principal"`
	Drawn     float64 `json:"drawn"`
	Repaid    float64 `json:"repaid"`
	Balance   float64 `json:"balance"`
}

func (s *MovementService) loanBalance(ctx context.Context, src *CashSource, includePending bool) (LoanBalance, error) {
	var b LoanBalance
	if src.PrincipalAmount != nil {
		b.Principal = *src.PrincipalAmount
	}
	since := src.CreatedAt
	if src.LoanOpenedAt != nil {
		since = *src.LoanOpenedAt
	}
	var err error
	if b.Drawn, err = s.repo.loanDrawn(ctx, src.Name, since); err != nil {
		return b, err
	}
	if b.Repaid, err = s.repo.loanRepaid(ctx, src.Name, since, includePending); err != nil {
		return b, err
	}
	b.Balance = b.Principal - b.Drawn + b.Repaid
	return b, nil
}

// findLoanSource returns the loan CashSource named name with its details
// captured, or nil when name isn't a loan source / has no details yet / the
// lookups aren't wired.
func (s *MovementService) findLoanSource(ctx context.Context, name string) *CashSource {
	if s.sourceRepo == nil || !IsLoanSource(name) {
		return nil
	}
	src, err := s.sourceRepo.FindByName(ctx, strings.TrimSpace(name))
	if err != nil || !src.HasLoanDetails() {
		return nil
	}
	return src
}

// EnsureLoanRepayment refuses an expense booked against a loan source's
// category when it would lift the loan's balance above its principal.
// includePending counts repayments still awaiting approval (used when the
// expense is recorded); approval itself counts approved ones only. A
// category that isn't a loan source always passes.
func (s *MovementService) EnsureLoanRepayment(ctx context.Context, category string, amount float64, includePending bool) error {
	src := s.findLoanSource(ctx, category)
	if src == nil {
		return nil
	}
	b, err := s.loanBalance(ctx, src, includePending)
	if err != nil {
		return err
	}
	if room := b.Principal - b.Balance; amount > room+0.005 {
		return httpx.NewBadRequest(fmt.Sprintf("repayment exceeds the loan principal — only ₹%.2f is still owed on %s", max(room, 0), src.Name))
	}
	return nil
}

func (s *MovementService) Record(ctx context.Context, in RecordMovementInput, loanSource *LoanSourceInput) (*CashMovement, error) {
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
		Type:         in.Type,
		Amount:       in.Amount,
		Mode:         in.Mode,
		Bank:         in.Bank,
		BankID:       in.BankID,
		ToBankID:     in.ToBankID,
		BranchID:     in.BranchID,
		ReceiptImage: in.ReceiptImage,
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
		// UPI/Bank Transfer names the branch's own account the money landed
		// in (BankID) — the account whose ledger it shows in.
		if (in.Mode == CashModeUPI || in.Mode == CashModeBankTransfer) && in.BankID == nil && in.Bank == "" {
			return nil, ErrBankRequiredForMode
		}
		rec.Source = in.Source
	} else {
		if in.Purpose == "" {
			return nil, ErrPurposeRequired
		}
		rec.Purpose = in.Purpose
	}

	isLoan := in.Type == "in" && IsLoanSource(in.Source)
	// src is the loan's CashSource row: its first Add Cash entry captures
	// the bank/number/principal onto it (newLoan), every later one reuses
	// them and ignores any loanSource sent.
	var src *CashSource
	newLoan := false
	if isLoan {
		var err error
		if src, err = s.resolveLoanSource(ctx, in.Source); err != nil {
			return nil, err
		}
		if !src.HasLoanDetails() {
			if loanSource == nil || loanSource.BankID == 0 {
				return nil, ErrLoanBankRequired
			}
			if strings.TrimSpace(loanSource.LoanNumber) == "" {
				return nil, ErrLoanNumberRequired
			}
			if loanSource.PrincipalAmount <= 0 {
				return nil, ErrLoanPrincipalRequired
			}
			bankID, principal, opened := loanSource.BankID, loanSource.PrincipalAmount, time.Now()
			src.BankID, src.LoanNumber, src.PrincipalAmount = &bankID, strings.TrimSpace(loanSource.LoanNumber), &principal
			src.LoanOpenedAt = &opened
			newLoan = true
		}
		// Add Cash draws the loan down — it can't draw more than is left.
		b, err := s.loanBalance(ctx, src, false)
		if err != nil {
			return nil, err
		}
		if in.Amount > b.Balance+0.005 {
			return nil, httpx.NewBadRequest(fmt.Sprintf("amount exceeds the loan balance — only ₹%.2f is left to draw on %s", max(b.Balance, 0), src.Name))
		}
		rec.Source = src.Name
		rec.Status = "Open"
		rec.Purpose = "Loan no. " + src.LoanNumber
		if rec.Bank == "" && src.Bank != nil {
			rec.Bank = src.Bank.Name
		}
		// Tag the lending bank on the movement itself so the entry lands in
		// that bank's ledger and the mode (UPI/Bank Transfer) ledger's Bank
		// column, instead of living only in the free-text Bank field.
		if rec.BankID == nil {
			bankID := *src.BankID
			rec.BankID = &bankID
		}
	}

	if err := s.repo.Create(ctx, rec); err != nil {
		return nil, err
	}

	if isLoan {
		if newLoan {
			if err := s.sourceRepo.SaveLoanDetails(ctx, src); err != nil {
				return nil, err
			}
			// Repayments are booked as expenses in a same-named category,
			// so the loan shows up in the Expense modal's Category picker.
			if err := s.ensureLoanCategory(ctx, src.Name); err != nil {
				return nil, err
			}
		}
		loanRec := &LoanCashSource{
			CashMovementID:  rec.ID,
			BankID:          *src.BankID,
			LoanNumber:      src.LoanNumber,
			PrincipalAmount: *src.PrincipalAmount,
		}
		if err := s.loanSourceRepo.Create(ctx, loanRec); err != nil {
			return nil, err
		}
	}

	return s.repo.FindByID(ctx, rec.ID)
}

// SelfTransferSource is the Source stamped on both rows of a self transfer.
// Reports/KPIs skip it (the two rows net to zero) and the loan ledger reads
// it back as a repayment when the category is a loan.
const SelfTransferSource = "Self Transfer"

// SelfTransferPurposePrefix starts the Purpose of both self-transfer rows —
// "Self transfer — <category>".
const SelfTransferPurposePrefix = "Self transfer — "

var (
	ErrSelfTransferBanks      = httpx.NewBadRequest("from bank and to bank are required")
	ErrSelfTransferSameBank   = httpx.NewBadRequest("from bank and to bank must be different")
	ErrSelfTransferCategory   = httpx.NewBadRequest("category is required")
	ErrSelfTransferLoanNoBank = httpx.NewBadRequest("this loan has no bank recorded yet — add cash from it first")
)

// RecordSelfTransferInput mirrors the Self Transfer tab of the Ledger's Add
// Entry modal.
type RecordSelfTransferInput struct {
	Category   string
	Amount     float64
	FromBankID uint
	FromBank   string
	ToBankID   uint
	ToBank     string
	// Mode is shown on both rows — "Bank Transfer" (default), "UPI" or "Cash".
	Mode         string
	ReceiptImage string
	BranchID     *uint
	OccurredOn   time.Time
}

// RecordSelfTransfer moves money between two of the business's own bank
// accounts as TWO linked rows sharing one TransactionGroupID: a debit
// (cash-out) on the from-bank and a credit (cash-in) on the to-bank. When
// the category is a loan source, the to-bank is forced to the loan's bank
// and the transfer is a repayment — it is checked against the loan's
// balance and shows as a debit on the loan's own ledger.
func (s *MovementService) RecordSelfTransfer(ctx context.Context, in RecordSelfTransferInput) ([]CashMovement, error) {
	category := strings.TrimSpace(in.Category)
	if category == "" {
		return nil, ErrSelfTransferCategory
	}
	if in.Amount <= 0 {
		return nil, ErrInvalidAmount
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

	toBankID, toBank := in.ToBankID, in.ToBank
	if IsLoanSource(category) {
		src, err := s.resolveLoanSource(ctx, category)
		if err != nil {
			return nil, err
		}
		if !src.HasLoanDetails() {
			return nil, ErrSelfTransferLoanNoBank
		}
		toBankID = *src.BankID
		if src.Bank != nil {
			toBank = src.Bank.Name
		}
		category = src.Name
		if err := s.EnsureLoanRepayment(ctx, category, in.Amount, false); err != nil {
			return nil, err
		}
	}
	if in.FromBankID == 0 || toBankID == 0 {
		return nil, ErrSelfTransferBanks
	}
	if in.FromBankID == toBankID {
		return nil, ErrSelfTransferSameBank
	}

	mode := in.Mode
	switch mode {
	case "":
		mode = CashModeBankTransfer
	case CashModeBankTransfer, CashModeUPI, CashModeCash:
	default:
		return nil, httpx.NewBadRequest("mode must be Bank Transfer, UPI or Cash")
	}
	occurred := in.OccurredOn
	if occurred.IsZero() {
		occurred = time.Now()
	}
	groupID := platform.NewTransactionGroupID()
	purpose := SelfTransferPurposePrefix + category
	fromID, toID := in.FromBankID, toBankID

	debit := &CashMovement{
		Type: "out", Source: SelfTransferSource, Purpose: purpose, Mode: mode, ReceiptImage: in.ReceiptImage,
		Bank: in.FromBank, BankID: &fromID, CounterBankID: &toID, Amount: in.Amount, BranchID: in.BranchID,
		OccurredOn: occurred, TransactionGroupID: groupID,
	}
	credit := &CashMovement{
		Type: "in", Source: SelfTransferSource, Purpose: purpose, Mode: mode, ReceiptImage: in.ReceiptImage,
		Bank: toBank, BankID: &toID, CounterBankID: &fromID, Amount: in.Amount, BranchID: in.BranchID,
		OccurredOn: occurred, TransactionGroupID: groupID,
	}
	if err := s.repo.Create(ctx, debit); err != nil {
		return nil, err
	}
	if err := s.repo.Create(ctx, credit); err != nil {
		_ = s.repo.Delete(ctx, debit.ID) // keep the pair atomic
		return nil, err
	}
	d, err := s.repo.FindByID(ctx, debit.ID)
	if err != nil {
		return nil, err
	}
	c, err := s.repo.FindByID(ctx, credit.ID)
	if err != nil {
		return nil, err
	}
	return []CashMovement{*d, *c}, nil
}

// resolveLoanSource find-or-creates the CashSource row a loan entry draws
// from (normally it already exists — the Add Cash picker creates it).
func (s *MovementService) resolveLoanSource(ctx context.Context, name string) (*CashSource, error) {
	if s.sourceRepo == nil {
		return nil, errors.New("cash: loan source lookups not wired")
	}
	trimmed := strings.TrimSpace(name)
	src, err := s.sourceRepo.FindByName(ctx, trimmed)
	if err == nil {
		return src, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	src = &CashSource{Name: trimmed}
	if err := s.sourceRepo.Create(ctx, src); err != nil {
		return nil, err
	}
	return src, nil
}

func (s *MovementService) ensureLoanCategory(ctx context.Context, name string) error {
	if s.categoryRepo == nil {
		return nil
	}
	if _, err := s.categoryRepo.FindByName(ctx, name); err == nil {
		return nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	return s.categoryRepo.Create(ctx, &ExpenseCategory{Name: name})
}

// GetCashSource returns a cash source with its loan details and current
// balance (zero LoanBalance when it isn't a loan with details captured).
func (s *MovementService) GetCashSource(ctx context.Context, id uint) (*CashSource, LoanBalance, error) {
	if s.sourceRepo == nil {
		return nil, LoanBalance{}, ErrCashSourceNotFound
	}
	src, err := s.sourceRepo.FindByID(ctx, id)
	if err != nil {
		return nil, LoanBalance{}, ErrCashSourceNotFound
	}
	if !IsLoanSource(src.Name) || !src.HasLoanDetails() {
		return src, LoanBalance{}, nil
	}
	b, err := s.loanBalance(ctx, src, false)
	return src, b, err
}

// SearchLoanSources backs GET /cash-movements/loan-sources — see
// LoanCashSourceRepository.SearchDistinctLoans.
func (s *MovementService) SearchLoanSources(ctx context.Context, query string, bankID uint, limit, offset int) ([]LoanCashSource, error) {
	return s.loanSourceRepo.SearchDistinctLoans(ctx, query, bankID, limit, offset)
}

// LoanSourcesByMovementIDs maps movement id → its LoanCashSource for the
// loan-sourced ones among ids (one query, no per-row lookups).
func (s *MovementService) LoanSourcesByMovementIDs(ctx context.Context, ids []uint) map[uint]*LoanCashSource {
	return s.loanSourceRepo.FindByCashMovementIDs(ctx, ids)
}

// GetLoanSource returns the LoanCashSource attached to movementID, or nil
// (not an error) when the movement isn't loan-sourced — the handler uses
// this to fill CashMovement's response-only LoanSource field on Get/List.
func (s *MovementService) GetLoanSource(ctx context.Context, movementID uint) *LoanCashSource {
	rec, err := s.loanSourceRepo.FindByCashMovementID(ctx, movementID)
	if err != nil {
		return nil
	}
	return rec
}

// List returns cash movements, optionally scoped to branchID (nil = all
// branches — Administrator only, see platform.GetBranchScope) and to
// [fromDate, toDate] (zero value on either end means "no bound" on that
// side — the Cash Movements table's default, unfiltered view).
func (s *MovementService) List(ctx context.Context, branchID *uint, fromDate, toDate time.Time, category, search string, limit, offset int) ([]CashMovement, int64, error) {
	return s.repo.FindAll(ctx, branchID, fromDate, toDate, category, search, limit, offset)
}

// ListFiltered is List's counterpart for the Ledger filter's multi-select
// Branch/Customer/Type sections (MovementFilter) — see
// MovementRepository.FindAllFiltered.
func (s *MovementService) ListFiltered(ctx context.Context, branchID *uint, fromDate, toDate time.Time, filter MovementFilter, search string, limit, offset int) ([]CashMovement, int64, error) {
	return s.repo.FindAllFiltered(ctx, branchID, fromDate, toDate, filter, search, limit, offset)
}

// SumFiltered is ListFiltered's Total Debit/Total Credit across every match.
func (s *MovementService) SumFiltered(ctx context.Context, branchID *uint, fromDate, toDate time.Time, filter MovementFilter, search string) (float64, float64, error) {
	return s.repo.SumFiltered(ctx, branchID, fromDate, toDate, filter, search)
}

func (s *MovementService) NetOfNewest(ctx context.Context, branchID *uint, fromDate, toDate time.Time, filter MovementFilter, search string, n int) (float64, error) {
	return s.repo.NetOfNewest(ctx, branchID, fromDate, toDate, filter, search, n)
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
func (s *MovementService) ListCashMovementsByCustomer(ctx context.Context, customerID uint, fromDate, toDate time.Time, loanNumbers []string, limit, offset int) ([]CashMovement, int64, PartyTotals, error) {
	rows, total, err := s.repo.ListByCustomer(ctx, customerID, fromDate, toDate, loanNumbers, limit, offset)
	if err != nil {
		return nil, 0, PartyTotals{}, err
	}
	all, _, err := s.repo.ListByCustomer(ctx, customerID, fromDate, toDate, loanNumbers, 0, 0)
	if err != nil {
		return nil, 0, PartyTotals{}, err
	}
	return rows, total, sumPartyTotals(all), nil
}

// ListCashMovementsByBranch is ListCashMovementsByBank's counterpart for
// CashMovement.BranchID — backs the Party Transactions page's branch
// drill-down.
func (s *MovementService) ListCashMovementsByBranch(ctx context.Context, branchID uint, fromDate, toDate time.Time, limit, offset int) ([]CashMovement, int64, PartyTotals, error) {
	rows, total, err := s.repo.ListByBranch(ctx, branchID, fromDate, toDate, limit, offset)
	if err != nil {
		return nil, 0, PartyTotals{}, err
	}
	all, _, err := s.repo.ListByBranch(ctx, branchID, fromDate, toDate, 0, 0)
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
	hoID, err := s.HeadOfficeBranchID(ctx)
	if err != nil {
		return 0, err
	}
	rec := &CashMovement{
		Type:     "in",
		Source:   "Bank",
		Bank:     bankName,
		Amount:   amount,
		Mode:     CashModeCash,
		BranchID: &hoID,
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
//
// The operator picks how the charge is recorded (cash/upi/bank/cheque split,
// plus the bank for non-cash modes) — an all-zero split falls back to one
// Cash row, so callers that don't ask (e.g. older clients) still book it.
func (s *MovementService) RecordServiceChargeCashIn(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, bankID *uint) (uint, error) {
	base := CashMovement{
		Type:     "in",
		Source:   "Service Charge",
		Purpose:  "Service charge — " + loanNumber,
		BranchID: &branchID,
		BankID:   bankID,
	}
	if occurredOn.IsZero() {
		base.OccurredOn = time.Now()
	} else {
		base.OccurredOn = occurredOn
	}
	id, _, err := s.recordSplitCashMovement(ctx, base, amount, []splitComponent{
		{CashModeCash, cashAmount},
		{CashModeUPI, upiAmount},
		{CashModeBankTransfer, bankTransferAmount},
		{CashModeCheque, chequeAmount},
	})
	return id, err
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
func (s *MovementService) RecordLoanDisbursementCashOut(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, customerID uint, bankID *uint) (uint, string, error) {
	base := CashMovement{
		Type:     "out",
		Purpose:  "Loan disbursement — " + loanNumber,
		BranchID: &branchID,
		BankID:   bankID,
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
func (s *MovementService) RecordLoanPaymentCashIn(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, paymentType string, customerID uint, bankID *uint) (uint, string, error) {
	base := CashMovement{
		Type:     "in",
		Source:   "Collection",
		Purpose:  fmt.Sprintf("%s — %s", paymentType, loanNumber),
		BranchID: &branchID,
		BankID:   bankID,
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
	// branchID (the pledged loan's branch) is ignored on purpose: every
	// pledge movement lives on the Head Office till, in and out alike.
	hoID, err := s.HeadOfficeBranchID(ctx)
	if err != nil {
		return 0, err
	}
	rec := &CashMovement{
		Type:     "out",
		Purpose:  "Bank pledge release — " + bankName,
		Bank:     bankName,
		Amount:   amount,
		Mode:     CashModeCash,
		BranchID: &hoID,
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

// RecordExpenseCashOut creates the cash-out movement for an Expense once it
// is Approved (called from ExpenseService.Approve). ExpenseID tags the row
// so it shows up in the Cash Movements ledger table while staying excluded
// from Summary's Disbursements sum (SumByTypeAndDate/SumBreakdownByDate both
// skip rows with ExpenseID set) — the expense is already counted there via
// ExpenseRepository.SumCashByDate/SumAllByDate, so including this row too
// would double the deduction.
func (s *MovementService) RecordExpenseCashOut(ctx context.Context, expenseID uint, category, mode string, fromBankID, toBankID *uint, amount float64, branchID uint, occurredOn time.Time, receiptImage string) (uint, error) {
	rec := &CashMovement{
		Type:      "out",
		Purpose:   "Expense — " + category,
		Mode:      mode,
		BankID:    fromBankID,
		ToBankID:  toBankID,
		Amount:    amount,
		BranchID:  &branchID,
		ExpenseID: &expenseID,
		// The expense's bill, so the ledger row can link to it.
		ReceiptImage: receiptImage,
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
//
// customerID (0 = none) tags PartyCustomerID so the deposit lands on the
// investor's customer ledger alongside their payouts.
func (s *MovementService) RecordInvestmentDepositCashIn(ctx context.Context, investmentID uint, investmentNumber string, amount float64, branchID uint, occurredOn time.Time, customerID uint) (uint, error) {
	rec := &CashMovement{
		Type:     "in",
		Source:   "Investment",
		Purpose:  "Investment deposit — " + investmentNumber,
		Amount:   amount,
		Mode:     CashModeCash,
		BranchID: &branchID,
	}
	if customerID != 0 {
		rec.PartyCustomerID = &customerID
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
		Mode:     CashModeCash,
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
		Mode:     CashModeCash,
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
func (s *MovementService) RecordGoldSaleCashIn(ctx context.Context, ornamentType string, amount float64, branchID uint, occurredOn time.Time, mode string, bankID *uint) (uint, error) {
	rec := &CashMovement{
		Type:     "in",
		Source:   "GoldSale",
		Purpose:  "Gold sale — " + ornamentType,
		Amount:   amount,
		Mode:     mode,
		BankID:   bankID,
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
	// Mode Cash: the acquisition cost is paid out of the till, so it belongs
	// in the Cash ledger.
	rec := &CashMovement{
		Type:     "out",
		Purpose:  GoldPurchaseCostPrefix + ornamentType,
		Mode:     CashModeCash,
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
	hoID, err := s.HeadOfficeBranchID(ctx)
	if err != nil {
		return 0, err
	}
	return s.recordSystemExpense(ctx, "Bank Pledge Release", bankName, amount, occurredOn, hoID)
}

// HeadOfficeBranchID is the branch every bank-pledge movement is booked on —
// see branch.Repository.FindHeadOffice. Also exposed through
// loan.CashRecorder so the pledge release's balance check looks at the same
// till the money actually leaves.
func (s *MovementService) HeadOfficeBranchID(ctx context.Context) (uint, error) {
	b, err := s.branchRepo.FindHeadOffice(ctx)
	if err != nil {
		return 0, fmt.Errorf("finding the Head Office branch for the bank pledge: %w", err)
	}
	return b.ID, nil
}

// recordSystemExpense creates a pre-approved Expense row for a system-driven
// event, tagged ApprovedBy "System" and the bank-pledge remark so it can be
// told apart from a manually entered one (see ExpenseService.Record).
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

// DeleteAllLoanCashEntries erases every ledger entry a loan ever produced —
// disbursement, top-up, repayments, service charge, auction proceeds/refund
// (all carry " — <loanNumber>" in Purpose) plus the explicitly listed
// bank-pledge movements and release expenses. Called by
// loan.Service.HardDeleteLoan so a permanently deleted loan leaves no trace
// in Cash & Expenses.
func (s *MovementService) DeleteAllLoanCashEntries(ctx context.Context, loanNumber string, movementIDs, expenseIDs []uint) error {
	if err := s.repo.DeleteByPurposeSuffixOrIDs(ctx, " — "+loanNumber, movementIDs); err != nil {
		return err
	}
	return s.expenseRepo.DeleteByIDs(ctx, expenseIDs)
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
	repo        *ExpenseRepository
	branchRepo  *branch.Repository
	movementSvc *MovementService
	// summarySvc blocks a Cash-mode expense larger than Balance in Hand.
	// Optional — nil skips the check.
	summarySvc *SummaryService
	// workflowSvc says whether this tenant has the expense approval stage
	// switched on (see SetWorkflow). nil = the catalogue default (off).
	workflowSvc *workflow.Service
	// employeeName resolves the approver's display name for ApprovedBy.
	// Optional — nil leaves it to the caller-supplied name.
	employeeName func(ctx context.Context, employeeID uint) string
}

// SetWorkflow wires the per-tenant approval-workflow configuration.
func (s *ExpenseService) SetWorkflow(w *workflow.Service) {
	s.workflowSvc = w
}

// SetEmployeeNamer wires the lookup used to stamp ApprovedBy from the
// authenticated approver rather than from the request body.
func (s *ExpenseService) SetEmployeeNamer(f func(ctx context.Context, employeeID uint) string) {
	s.employeeName = f
}

// ErrExpenseApprovalNotPermitted: the caller's role lacks the expense
// approval stage's permission.
var ErrExpenseApprovalNotPermitted = httpx.NewForbidden("your role may not approve or reject expenses")

// ExpenseActor is the authenticated employee deciding an expense.
type ExpenseActor struct {
	EmployeeID uint
	RoleID     uint
	Name       string // fallback display name when no namer is wired
}

// expenseDecision is a Pending expense resolved onto the tenant's expense
// chain, with the actor cleared to act at its current step.
type expenseDecision struct {
	rec   *Expense
	chain *workflow.Chain
	step  workflow.StageDef
	name  string // to stamp on ApprovedBy
}

// authorizeDecision loads the expense, resolves the step it waits at, and
// checks the actor holds that step's role (or is Administrator).
func (s *ExpenseService) authorizeDecision(ctx context.Context, id uint, actor ExpenseActor, branchID *uint) (*expenseDecision, error) {
	rec, err := s.Get(ctx, id, branchID)
	if err != nil {
		return nil, err
	}
	if rec.Status != "Pending" {
		return nil, ErrExpenseNotPending
	}
	chain, err := s.workflowSvc.Chain(ctx, workflow.FlowExpense)
	if err != nil {
		return nil, err
	}
	step, _ := chain.ByPending(rec.ApprovalStage)
	if !s.workflowSvc.CanAct(ctx, actor.RoleID, workflow.FlowExpense, step.Key) {
		return nil, ErrExpenseApprovalNotPermitted
	}
	name := actor.Name
	if s.employeeName != nil && actor.EmployeeID != 0 {
		if n := s.employeeName(ctx, actor.EmployeeID); n != "" {
			name = n
		}
	}
	return &expenseDecision{rec: rec, chain: chain, step: step, name: name}, nil
}

// ApproveAs is Approve for an HTTP caller: checked against the step the
// expense waits at, and stamped with the authenticated approver's name. A
// step before the last only moves the expense on (still Pending); the last
// step posts it.
func (s *ExpenseService) ApproveAs(ctx context.Context, id uint, actor ExpenseActor, branchID *uint) (*Expense, error) {
	d, err := s.authorizeDecision(ctx, id, actor, branchID)
	if err != nil {
		return nil, err
	}
	s.workflowSvc.RecordAction(ctx, &workflow.ApprovalAction{
		Flow: workflow.FlowExpense, EntityID: id, Stage: d.step.Key, Action: workflow.ActionApproved,
		ActorEmployeeID: actor.EmployeeID, ActorRole: d.step.Role,
	})
	if next, ok := d.chain.Next(d.step.Key); ok && d.step.Key != "" {
		d.rec.ApprovalStage = next.Pending
		if err := s.repo.Update(ctx, d.rec); err != nil {
			return nil, err
		}
		return s.repo.FindByID(ctx, id)
	}
	return s.Approve(ctx, id, d.name, branchID)
}

// RejectAs is Reject for an HTTP caller — see ApproveAs.
func (s *ExpenseService) RejectAs(ctx context.Context, id uint, actor ExpenseActor, remarks string, branchID *uint) (*Expense, error) {
	d, err := s.authorizeDecision(ctx, id, actor, branchID)
	if err != nil {
		return nil, err
	}
	rec, err := s.Reject(ctx, id, d.name, remarks, branchID)
	if err == nil {
		s.workflowSvc.RecordAction(ctx, &workflow.ApprovalAction{
			Flow: workflow.FlowExpense, EntityID: id, Stage: d.step.Key, Action: workflow.ActionRejected,
			ActorEmployeeID: actor.EmployeeID, ActorRole: d.step.Role, Remarks: remarks,
		})
	}
	return rec, err
}

func NewExpenseService(repo *ExpenseRepository, branchRepo *branch.Repository, movementSvc *MovementService) *ExpenseService {
	return &ExpenseService{repo: repo, branchRepo: branchRepo, movementSvc: movementSvc}
}

// SetSummaryService wires the Balance-in-Hand check for Cash-mode expenses.
func (s *ExpenseService) SetSummaryService(summarySvc *SummaryService) {
	s.summarySvc = summarySvc
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
	if in.BranchID == 0 {
		return nil, ErrBranchRequired
	}
	if ok, err := s.branchRepo.Exists(ctx, in.BranchID); err != nil {
		return nil, err
	} else if !ok {
		return nil, ErrBranchInvalid
	}
	if (in.Mode == CashModeUPI || in.Mode == "Bank") && in.FromBankID == nil {
		return nil, ErrExpenseBankRequired
	}
	// A loan source's category is its repayment — capped at the principal.
	if err := s.movementSvc.EnsureLoanRepayment(ctx, in.Category, in.Amount, true); err != nil {
		return nil, err
	}
	// With the tenant's expense approval stage switched on, a recorded
	// expense waits as Pending — no cash-out (and so no Balance-in-Hand
	// check) until Approve posts it.
	chain, err := s.workflowSvc.Chain(ctx, workflow.FlowExpense)
	if err != nil {
		return nil, err
	}
	if chain.Off() && in.Mode == CashModeCash && s.summarySvc != nil {
		if err := s.summarySvc.EnsureCashInHand(ctx, in.BranchID, in.Amount); err != nil {
			return nil, err
		}
	}
	now := time.Now()
	occurredOn := in.OccurredOn
	if occurredOn.IsZero() {
		occurredOn = now
	}
	if first, ok := chain.First(); ok {
		rec := &Expense{
			ApprovalStage: first.Pending,
			OccurredOn:    occurredOn,
			Category:      in.Category,
			Amount:        in.Amount,
			Mode:          in.Mode,
			Payee:         in.Payee,
			FromBankID:    in.FromBankID,
			ToBankID:      in.ToBankID,
			BranchID:      in.BranchID,
			Status:        "Pending",
			Remarks:       in.Remarks,
			ReceiptImage:  in.ReceiptImage,
		}
		if err := s.repo.Create(ctx, rec); err != nil {
			return nil, err
		}
		return s.repo.FindByID(ctx, rec.ID)
	}

	// Without an approval stage a recorded expense is Approved on entry and
	// its cash-out movement is posted straight away, so it lands in the
	// register and the ledger at once.
	rec := &Expense{
		OccurredOn:   occurredOn,
		Category:     in.Category,
		Amount:       in.Amount,
		Mode:         in.Mode,
		Payee:        in.Payee,
		FromBankID:   in.FromBankID,
		ToBankID:     in.ToBankID,
		BranchID:     in.BranchID,
		Status:       "Approved",
		ApprovedAt:   &now,
		Remarks:      in.Remarks,
		ReceiptImage: in.ReceiptImage,
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		return nil, err
	}
	movementID, err := s.movementSvc.RecordExpenseCashOut(ctx, rec.ID, rec.Category, rec.Mode, rec.FromBankID, rec.ToBankID, rec.Amount, rec.BranchID, rec.OccurredOn, rec.ReceiptImage)
	if err != nil {
		return nil, err
	}
	rec.CashMovementID = &movementID
	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, err
	}
	return s.repo.FindByID(ctx, rec.ID)
}

// List returns expenses, optionally scoped to branchID (nil = all branches
// — Administrator only, see platform.GetBranchScope).
func (s *ExpenseService) List(ctx context.Context, branchID *uint, search string, limit, offset int) ([]Expense, int64, error) {
	return s.repo.FindAll(ctx, branchID, search, limit, offset)
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
	// The money only leaves now, so the Balance-in-Hand check runs now.
	if rec.Mode == CashModeCash && s.summarySvc != nil {
		if err := s.summarySvc.EnsureCashInHand(ctx, rec.BranchID, rec.Amount); err != nil {
			return nil, err
		}
	}
	if err := s.movementSvc.EnsureLoanRepayment(ctx, rec.Category, rec.Amount, false); err != nil {
		return nil, err
	}
	now := time.Now()
	rec.Status = "Approved"
	if approvedBy != "" {
		rec.ApprovedBy = &approvedBy
	}
	rec.ApprovedAt = &now

	movementID, err := s.movementSvc.RecordExpenseCashOut(ctx, rec.ID, rec.Category, rec.Mode, rec.FromBankID, rec.ToBankID, rec.Amount, rec.BranchID, rec.OccurredOn, rec.ReceiptImage)
	if err != nil {
		return nil, err
	}
	rec.CashMovementID = &movementID

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

// normalizeOpeningMode defaults a blank mode to Cash, validates it against
// the ledger's mode vocabulary, and enforces the bank rule: Cash never has a
// bank, every other mode needs one.
func normalizeOpeningMode(mode string, bankID *uint) (string, *uint, error) {
	if mode == "" {
		mode = CashModeCash
	}
	if !modeVocabulary[mode] {
		return "", nil, httpx.NewBadRequest("mode must be Cash, UPI, Bank Transfer or Cheque")
	}
	if mode == CashModeCash {
		return mode, nil, nil
	}
	if bankID == nil || *bankID == 0 {
		return "", nil, ErrBankRequiredForMode
	}
	return mode, bankID, nil
}

func (s *OpeningBalanceService) Set(ctx context.Context, branchID uint, date time.Time, mode string, bankID, fromBankID *uint, amount float64) (*OpeningCashBalance, error) {
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
	mode, bankID, err := normalizeOpeningMode(mode, bankID)
	if err != nil {
		return nil, err
	}
	// Cash never has banks; every other mode records both the bank the
	// funds came from and the bank (BankID) they sit in.
	if mode == CashModeCash {
		fromBankID = nil
	} else if fromBankID == nil || *fromBankID == 0 {
		return nil, ErrFromBankRequired
	}
	if date.IsZero() {
		date = time.Now()
	}
	rec := &OpeningCashBalance{BranchID: branchID, BalanceDate: date, Mode: mode, BankID: bankID, FromBankID: fromBankID, Amount: amount}
	if err := s.repo.Upsert(ctx, rec); err != nil {
		return nil, err
	}
	rec.IsSet = true
	return rec, nil
}

// Get returns the opening balance for a branch/date/mode/bank, or a
// zero-amount record with IsSet false if none has been entered yet — the
// frontend always gets a number, plus a way to tell an entered 0 from no
// entry.
func (s *OpeningBalanceService) Get(ctx context.Context, branchID uint, date time.Time, mode string, bankID *uint) (*OpeningCashBalance, error) {
	mode, bankID, err := normalizeOpeningMode(mode, bankID)
	if err != nil {
		return nil, err
	}
	if date.IsZero() {
		date = time.Now()
	}
	rec, err := s.repo.FindByBranchDateMode(ctx, branchID, date, mode, bankID)
	if err != nil {
		return &OpeningCashBalance{BranchID: branchID, BalanceDate: date, Mode: mode, BankID: bankID, Amount: 0}, nil
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

	// BankBalance is the live, all-time balance across every bank account
	// combined (UPI / Bank Transfer / Cheque modes); CashInHand is the live
	// physical cash only (Mode Cash, or no Mode). Both are "as of now",
	// independent of the requested day — see SummaryService.liveBalances.
	BankBalance float64 `json:"bankBalance"`
	CashInHand  float64 `json:"cashInHand"`

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

// ErrInsufficientCashInHand blocks a payout larger than the branch's current
// Balance in Hand (see SummaryService.EnsureCashInHand).
func ErrInsufficientCashInHand(available, required float64) error {
	return httpx.NewConflict(fmt.Sprintf("Insufficient balance in hand: available ₹%.2f, required ₹%.2f", available, required))
}

// openingFor is the carried-forward opening cash for a day: yesterday's
// closing Balance in Hand. It starts from the latest manually entered Cash
// opening balance on or before the day (a seed; 0 from the beginning when
// none exists) and rolls every movement and cash expense since then forward
// up to the start of the day. A nil branchID sums every branch — seeded
// branches individually, the rest (and branch-less movements) from the
// beginning.
func (s *SummaryService) openingFor(ctx context.Context, branchID *uint, date time.Time) (float64, error) {
	day := startOfDay(date)
	if branchID == nil {
		ids, err := s.openingSvc.repo.CashSeedBranchIDs(ctx, day)
		if err != nil {
			return 0, err
		}
		var total float64
		for _, id := range ids {
			id := id
			v, err := s.openingFor(ctx, &id, day)
			if err != nil {
				return 0, err
			}
			total += v
		}
		in, out, err := s.movementRepo.SumByTypeBetween(ctx, nil, ids, time.Time{}, day)
		if err != nil {
			return 0, err
		}
		exp, err := s.expenseRepo.SumCashBetween(ctx, nil, ids, time.Time{}, day)
		if err != nil {
			return 0, err
		}
		return total + in - out - exp, nil
	}

	var seed float64
	var from time.Time
	rec, err := s.openingSvc.repo.FindLatestCashOnOrBefore(ctx, *branchID, day)
	switch {
	case err == nil:
		seed, from = rec.Amount, startOfDay(rec.BalanceDate)
		if !from.Before(day) {
			return seed, nil
		}
	case !errors.Is(err, gorm.ErrRecordNotFound):
		return 0, err
	}
	in, out, err := s.movementRepo.SumByTypeBetween(ctx, branchID, nil, from, day)
	if err != nil {
		return 0, err
	}
	exp, err := s.expenseRepo.SumCashBetween(ctx, branchID, nil, from, day)
	if err != nil {
		return 0, err
	}
	return seed + in - out - exp, nil
}

// CashInHand is the branch's Balance in Hand right now — the figure every
// payout limit checks against.
func (s *SummaryService) CashInHand(ctx context.Context, branchID uint) (float64, error) {
	sum, err := s.GetExpectedCash(ctx, &branchID, time.Now())
	if err != nil {
		return 0, err
	}
	return sum.ExpectedCash, nil
}

// EnsureCashInHand returns ErrInsufficientCashInHand when amount exceeds the
// branch's current Balance in Hand.
func (s *SummaryService) EnsureCashInHand(ctx context.Context, branchID uint, amount float64) error {
	if amount <= 0 {
		return nil
	}
	available, err := s.CashInHand(ctx, branchID)
	if err != nil {
		return err
	}
	if amount > available+0.005 {
		return ErrInsufficientCashInHand(available, amount)
	}
	return nil
}

func (s *SummaryService) GetExpectedCash(ctx context.Context, branchID *uint, date time.Time) (Summary, error) {
	if date.IsZero() {
		date = time.Now()
	}
	opening, err := s.openingFor(ctx, branchID, date)
	if err != nil {
		return Summary{}, err
	}
	openingSet := true
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
	cashInHand, bankBalance, err := s.liveBalances(ctx, branchID)
	if err != nil {
		return Summary{}, err
	}
	return Summary{
		BankBalance:            bankBalance,
		CashInHand:             cashInHand,
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

// liveBalances returns the branch's (nil = all branches) cash in hand and
// total bank balance as of now, from the movements model:
//
//	cashInHand  = Cash opening seed + Σ cash-side movements − approved Cash expenses
//	bankBalance = Σ bank opening rows + Σ bank-side movements − approved bank expenses
//
// Cash side = Mode Cash or no Mode; bank side = UPI/Bank Transfer/Cheque, so
// each movement hits exactly one figure. Movements with expense_id are left
// out (the expenses table is summed instead); bank-to-bank transfers
// (to_bank_id set) are skipped as they net to zero across all banks.
func (s *SummaryService) liveBalances(ctx context.Context, branchID *uint) (cashInHand, bankBalance float64, err error) {
	today := startOfDay(time.Now())
	to := today.AddDate(0, 0, 1)

	// net of one scope: movements less expenses.
	net := func(sc BalanceScope) (float64, error) {
		sc.To = to
		m, err := s.movementRepo.NetByScope(ctx, sc)
		if err != nil {
			return 0, err
		}
		e, err := s.expenseRepo.SumByScope(ctx, sc)
		if err != nil {
			return 0, err
		}
		return m - e, nil
	}

	// Cash: seeded branches roll forward from their latest Cash opening;
	// everything else (and branch-less movements) from the beginning.
	var seeded []uint
	if branchID == nil {
		if seeded, err = s.openingSvc.repo.CashSeedBranchIDs(ctx, today); err != nil {
			return 0, 0, err
		}
	} else {
		seeded = []uint{*branchID}
	}
	for _, id := range seeded {
		id := id
		sc := BalanceScope{BranchID: &id}
		rec, ferr := s.openingSvc.repo.FindLatestCashOnOrBefore(ctx, id, today)
		switch {
		case ferr == nil:
			cashInHand += rec.Amount
			sc.From = startOfDay(rec.BalanceDate)
		case !errors.Is(ferr, gorm.ErrRecordNotFound):
			return 0, 0, ferr
		}
		v, nerr := net(sc)
		if nerr != nil {
			return 0, 0, nerr
		}
		cashInHand += v
	}
	if branchID == nil {
		v, nerr := net(BalanceScope{ExcludeBranches: seeded})
		if nerr != nil {
			return 0, 0, nerr
		}
		cashInHand += v
	}

	// Bank: each (branch, bank, mode) opening row rolls forward from its date;
	// movements on accounts with no opening row count from the beginning.
	openings, err := s.openingSvc.repo.LatestBankOpenings(ctx, branchID, today)
	if err != nil {
		return 0, 0, err
	}
	bankBalance, err = net(BalanceScope{Bank: true, BranchID: branchID})
	if err != nil {
		return 0, 0, err
	}
	for _, o := range openings {
		o := o
		base := BalanceScope{Bank: true, BranchID: &o.BranchID, BankID: o.BankID, Mode: o.Mode}
		all, nerr := net(base)
		if nerr != nil {
			return 0, 0, nerr
		}
		base.From = startOfDay(o.BalanceDate)
		since, nerr := net(base)
		if nerr != nil {
			return 0, 0, nerr
		}
		// swap the account's all-time net for opening + net since its date.
		bankBalance += o.Amount + since - all
	}
	return cashInHand, bankBalance, nil
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
	// Mode is how the sale proceeds were received — "" defaults to Cash
	// (see GoldSale.Mode's doc comment).
	Mode string
	// BankID — required when Mode is UPI or Bank Transfer (see
	// ErrBankRequiredForMode).
	BankID  *uint
	Remarks string
	// ReceiptImage is an optional bill (/uploads/... URL).
	ReceiptImage string
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
	mode := in.Mode
	if mode == "" {
		mode = CashModeCash
	}
	if (mode == CashModeUPI || mode == CashModeBankTransfer) && in.BankID == nil {
		return nil, ErrBankRequiredForMode
	}

	soldOn := in.SoldOn
	if soldOn.IsZero() {
		soldOn = time.Now()
	}

	movementID, err := s.movementSvc.RecordGoldSaleCashIn(ctx, in.OrnamentType, in.SoldAmount, in.BranchID, soldOn, mode, in.BankID)
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
		Mode:               mode,
		BankID:             in.BankID,
		CashMovementID:     &movementID,
		CostCashMovementID: costMovementID,
		Remarks:            in.Remarks,
		ReceiptImage:       in.ReceiptImage,
	}
	if err := s.repo.Create(ctx, rec); err != nil {
		// Don't leave the movements booked above behind for a sale that was
		// never recorded — they would inflate Balance in Hand.
		_ = s.movementSvc.repo.Delete(ctx, movementID)
		if costMovementID != nil {
			_ = s.movementSvc.repo.Delete(ctx, *costMovementID)
		}
		return nil, err
	}
	return s.repo.FindByID(ctx, rec.ID)
}

// List returns gold sales, optionally scoped to branchID (nil = all
// branches — Administrator only, see platform.GetBranchScope) and to
// [fromDate, toDate] (zero value on either end means "no bound" on that
// side).
func (s *GoldSaleService) List(ctx context.Context, branchID *uint, fromDate, toDate time.Time, search string, limit, offset int) ([]GoldSale, int64, error) {
	return s.repo.FindAll(ctx, branchID, fromDate, toDate, search, limit, offset)
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

// CashSourceService implements CashSource's find-or-create business rules —
// same pattern as bank.Service.FindOrCreate.
type CashSourceService struct {
	repo *CashSourceRepository
}

func NewCashSourceService(repo *CashSourceRepository) *CashSourceService {
	return &CashSourceService{repo: repo}
}

func (s *CashSourceService) List(ctx context.Context, query string, limit, offset int) ([]CashSource, int64, error) {
	if offset == 0 {
		if err := ensureBuiltInCategories(ctx, s.repo.CategoryRepository); err != nil {
			return nil, 0, err
		}
	}
	return s.repo.FindAll(ctx, query, limit, offset)
}

// FindOrCreate trims the given name, rejects it if empty, and returns the
// existing row with a case-insensitive matching name if one exists;
// otherwise creates and returns a new row. The bool result reports whether a
// new row was created (true) or an existing one was reused (false).
func (s *CashSourceService) FindOrCreate(ctx context.Context, name string) (*CashSource, bool, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return nil, false, ErrCashSourceNameRequired
	}
	// "Gold Sale" is a built-in Add Cash source that posts to /gold-sales —
	// a real source row with that name would be booked as a plain top-up.
	if strings.ToLower(strings.ReplaceAll(trimmed, " ", "")) == "goldsale" {
		return nil, false, ErrCashSourceReserved
	}
	return findOrCreateCategory(ctx, s.repo.CategoryRepository, trimmed, CategoryCashIn)
}

// findOrCreateCategory is the one find-or-create rule behind every category
// picker: a name is unique per tenant (case-insensitive). If it already
// exists under another form's type, that row is flipped to common — shown on
// every form — instead of creating a duplicate; if it is new, it is created
// under typ. The bool reports whether a new row was created.
func findOrCreateCategory(ctx context.Context, repo *CategoryRepository, name, typ string) (*Category, bool, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return nil, false, ErrCashSourceNameRequired
	}
	existing, err := repo.FindByName(ctx, trimmed)
	if err == nil {
		if existing.Type != typ && !existing.IsCommon {
			if err := repo.MarkCommon(ctx, existing); err != nil {
				return nil, false, err
			}
		}
		return existing, false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, err
	}
	rec := &Category{Type: typ, Name: trimmed}
	if err := repo.Create(ctx, rec); err != nil {
		return nil, false, err
	}
	return rec, true, nil
}

// ensureBuiltInCategories makes sure the built-in "Gold Sale" cash-in category
// exists as a real row, so a search on the Debit or Self Transfer forms finds
// it too (choosing it there makes it common, like any other category). It is
// still never created through the picker — see ErrCashSourceReserved.
func ensureBuiltInCategories(ctx context.Context, repo *CategoryRepository) error {
	_, _, err := findOrCreateCategory(ctx, repo, GoldSaleCategory, CategoryCashIn)
	return err
}

// GoldSaleCategory is the built-in cash-in source that posts to /gold-sales.
const GoldSaleCategory = "Gold Sale"

// CategoryService backs the unified /categories endpoint (all three types) —
// used by the Self Transfer form's picker.
type CategoryService struct {
	repo *CategoryRepository
}

func NewCategoryService(repo *CategoryRepository) *CategoryService {
	return &CategoryService{repo: repo}
}

func validCategoryType(typ string) bool {
	return typ == CategoryCashIn || typ == CategoryExpense || typ == CategorySelfTransfer
}

// BankToBankCategory is the default Self Transfer category.
const BankToBankCategory = "Bank to Bank"

var ErrCategoryTypeInvalid = httpx.NewBadRequest("type must be cash_in, expense or self_transfer")

func (s *CategoryService) List(ctx context.Context, typ, query string, limit, offset int) ([]Category, int64, error) {
	if !validCategoryType(typ) {
		return nil, 0, ErrCategoryTypeInvalid
	}
	if offset == 0 {
		if err := ensureBuiltInCategories(ctx, s.repo); err != nil {
			return nil, 0, err
		}
	}
	// Self Transfer always has its plain bank-to-bank category to pick.
	if typ == CategorySelfTransfer && offset == 0 {
		if _, _, err := findOrCreateCategory(ctx, s.repo, BankToBankCategory, CategorySelfTransfer); err != nil {
			return nil, 0, err
		}
	}
	return s.repo.FindAll(ctx, typ, query, limit, offset)
}

func (s *CategoryService) FindOrCreate(ctx context.Context, name, typ string) (*Category, bool, error) {
	if !validCategoryType(typ) {
		return nil, false, ErrCategoryTypeInvalid
	}
	if typ == CategoryCashIn && strings.ToLower(strings.ReplaceAll(strings.TrimSpace(name), " ", "")) == "goldsale" {
		return nil, false, ErrCashSourceReserved
	}
	return findOrCreateCategory(ctx, s.repo, name, typ)
}

// ExpenseCategoryService implements ExpenseCategory's find-or-create
// business rules — same pattern as CashSourceService.
type ExpenseCategoryService struct {
	repo *ExpenseCategoryRepository
}

func NewExpenseCategoryService(repo *ExpenseCategoryRepository) *ExpenseCategoryService {
	return &ExpenseCategoryService{repo: repo}
}

func (s *ExpenseCategoryService) List(ctx context.Context, query string, limit, offset int) ([]ExpenseCategory, int64, error) {
	// Every bank loan's repayment category must be pickable — create any
	// that a loan opened earlier never got.
	if offset == 0 {
		if err := ensureBuiltInCategories(ctx, s.repo.CategoryRepository); err != nil {
			return nil, 0, err
		}
		missing, err := s.repo.MissingLoanCategoryNames(ctx)
		if err != nil {
			return nil, 0, err
		}
		for _, name := range missing {
			if _, _, err := s.FindOrCreate(ctx, name); err != nil {
				return nil, 0, err
			}
		}
	}
	return s.repo.FindAll(ctx, query, limit, offset)
}

// FindByID backs the category ledger drill-down — see
// MovementService.ListLedgerByCategory's doc comment.
func (s *ExpenseCategoryService) FindByID(ctx context.Context, id uint) (*ExpenseCategory, error) {
	return s.repo.FindByID(ctx, id)
}

func (s *ExpenseCategoryService) FindOrCreate(ctx context.Context, name string) (*ExpenseCategory, bool, error) {
	return findOrCreateCategory(ctx, s.repo.CategoryRepository, name, CategoryExpense)
}

// defaultCashSources/defaultExpenseCategories are what AddCashModal.tsx's
// fixed SOURCE_OPTIONS and ExpenseModal.tsx's hardcoded CATS used to be
// before both became a real, addable lookup list — seeded once per tenant
// (SeedDefaults) so upgrading an existing installation doesn't lose them.
var defaultCashSources = []string{"Savings", "Loan"}

var defaultExpenseCategories = []string{
	"Rent & Utilities", "Salaries", "Transportation", "Marketing",
	"Bank Charges", "Maintenance", "Stationery & Office",
	"Legal & Miscellaneous", "Other",
}

// SeedDefaultSourcesAndCategories find-or-creates every default cash
// source/expense category — called once at boot (see migrate.go), same
// cross-tenant boot-time pattern as puritystandard.SeedStandards, and safe
// to call repeatedly (FindOrCreate is idempotent by name).
func SeedDefaultSourcesAndCategories(db *gorm.DB) error {
	// Boot-time seeding runs outside any request, so it has no tenant.
	// Marked cross-tenant deliberately — see platform.AllowCrossTenant.
	ctx := platform.AllowCrossTenant(context.Background())
	sourceSvc := NewCashSourceService(NewCashSourceRepository(db))
	categorySvc := NewExpenseCategoryService(NewExpenseCategoryRepository(db))
	for _, name := range defaultCashSources {
		if _, _, err := sourceSvc.FindOrCreate(ctx, name); err != nil {
			return err
		}
	}
	for _, name := range defaultExpenseCategories {
		if _, _, err := categorySvc.FindOrCreate(ctx, name); err != nil {
			return err
		}
	}
	return nil
}
