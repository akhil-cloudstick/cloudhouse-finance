package bank

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/platform/httpx"
)

var ErrNameRequired = httpx.NewBadRequest("name is required")
var ErrPhoneInvalid = httpx.NewBadRequest("phone number must be exactly 10 digits")
var ErrNotFound = httpx.NewNotFound("bank not found")
var ErrDuplicateName = httpx.NewConflict("a bank with this name already exists")
var ErrSameBank = httpx.NewBadRequest("cannot merge a bank into itself")
var ErrBranchRequired = httpx.NewBadRequest("select the branch this bank account belongs to")

var phoneRe = regexp.MustCompile(`^\d{10}$`)

// CreateInput mirrors the fields an admin supplies via the "Add Bank" form.
// BranchID is the owning business branch; 0 falls back to the Head Office.
type CreateInput struct {
	Name      string
	BranchID  uint
	Branch    string
	Ifsc      string
	AccountNo string
	Phone     string
}

// HeadOfficeFinder resolves the business's Head Office — the branch a bank
// is filed under when none is given (branch.Repository).
type HeadOfficeFinder interface {
	FindHeadOffice(ctx context.Context) (*branch.Branch, error)
}

// BalanceSource supplies every bank account's current balance and a branch's
// (nil = all) live Bank balance (cash.SummaryService.BankBalances). Injected
// rather than imported: cash imports bank.
type BalanceSource interface {
	BankBalances(ctx context.Context, branchID *uint) (map[uint]float64, float64, error)
}

// Service implements bank business rules on top of the Repository.
type Service struct {
	repo       *Repository
	headOffice HeadOfficeFinder
	balances   BalanceSource
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// WithBranches wires the Head Office fallback and the balance source. Without
// them (migrations) a bank with no branch is left to the migration's Head
// Office backfill and List carries no balances.
func (s *Service) WithBranches(headOffice HeadOfficeFinder, balances BalanceSource) *Service {
	s.headOffice, s.balances = headOffice, balances
	return s
}

func (s *Service) List(ctx context.Context, query string, branchID *uint, limit, offset int) ([]Bank, int64, error) {
	return s.repo.FindAll(ctx, query, branchID, limit, offset)
}

// BankView is a bank as the Bank Management list shows it: its owning
// branch's name and its current balance.
type BankView struct {
	Bank
	BranchName string  `json:"branchName"`
	Balance    float64 `json:"balance"`
}

// ListWithBalances is List plus each account's balance, the total of every
// matching account (not just this page) and the scope's live Bank balance.
// With no search, total = the Bank balance card less unassigned, where
// unassigned is bank-mode money recorded without naming a bank.
func (s *Service) ListWithBalances(ctx context.Context, query string, branchID *uint, limit, offset int) (views []BankView, count int64, total, unassigned float64, err error) {
	rows, count, err := s.repo.FindAll(ctx, query, branchID, limit, offset)
	if err != nil {
		return nil, 0, 0, 0, err
	}
	var balances map[uint]float64
	var bankSide float64
	if s.balances != nil {
		if balances, bankSide, err = s.balances.BankBalances(ctx, branchID); err != nil {
			return nil, 0, 0, 0, err
		}
	}
	views = make([]BankView, len(rows))
	for i, b := range rows {
		views[i] = BankView{Bank: b, Balance: balances[b.ID]}
		if b.BusinessBranch != nil {
			views[i].BranchName = b.BusinessBranch.Name
		}
	}
	// The total covers every matching account, not just this page.
	all := rows
	if limit > 0 {
		if all, _, err = s.repo.FindAll(ctx, query, branchID, 0, 0); err != nil {
			return nil, 0, 0, 0, err
		}
	}
	for _, b := range all {
		total += balances[b.ID]
	}
	if query == "" && s.balances != nil {
		unassigned = bankSide - total
	}
	return views, count, total, unassigned, nil
}

// resolveBranch returns branchID, or the Head Office when it is 0.
func (s *Service) resolveBranch(ctx context.Context, branchID uint) (uint, error) {
	if branchID != 0 || s.headOffice == nil {
		return branchID, nil
	}
	ho, err := s.headOffice.FindHeadOffice(ctx)
	if err != nil {
		return 0, ErrBranchRequired
	}
	return ho.ID, nil
}

// FindOrCreate trims the given name, rejects it if empty, and returns the
// existing row with a case-insensitive matching name if one exists;
// otherwise it creates and returns a new row (using Branch/Ifsc from in if
// a new row is created — they're ignored when reusing an existing bank).
// The bool result reports whether a new row was created (true) or an
// existing one was reused (false), so the handler can pick the right HTTP
// status.
func (s *Service) FindOrCreate(ctx context.Context, in CreateInput) (*Bank, bool, error) {
	trimmed := strings.TrimSpace(in.Name)
	if trimmed == "" {
		return nil, false, ErrNameRequired
	}
	phone := strings.TrimSpace(in.Phone)
	if phone != "" && !phoneRe.MatchString(phone) {
		return nil, false, ErrPhoneInvalid
	}

	existing, err := s.repo.FindByName(ctx, trimmed)
	if err == nil {
		return existing, false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, false, err
	}

	branchID, err := s.resolveBranch(ctx, in.BranchID)
	if err != nil {
		return nil, false, err
	}
	rec := &Bank{Name: trimmed, BranchID: branchID, Branch: strings.TrimSpace(in.Branch), Ifsc: strings.TrimSpace(in.Ifsc), AccountNo: strings.TrimSpace(in.AccountNo), Phone: phone}
	if err := s.repo.Create(ctx, rec); err != nil {
		return nil, false, err
	}
	return rec, true, nil
}

func (s *Service) Get(ctx context.Context, id uint) (*Bank, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	return rec, nil
}

// Update is the Bank Management admin screen's real, explicit update —
// unlike FindOrCreate (used by the bank-picker's "type a new name"
// convenience elsewhere in the app), a rename that collides with another
// bank's name is rejected outright (ErrDuplicateName) rather than silently
// merging the two.
func (s *Service) Update(ctx context.Context, id uint, in CreateInput) (*Bank, error) {
	rec, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrNotFound
	}
	trimmed := strings.TrimSpace(in.Name)
	if trimmed == "" {
		return nil, ErrNameRequired
	}
	phone := strings.TrimSpace(in.Phone)
	if phone != "" && !phoneRe.MatchString(phone) {
		return nil, ErrPhoneInvalid
	}
	if existing, _ := s.repo.FindByName(ctx, trimmed); existing != nil && existing.ID != id {
		return nil, ErrDuplicateName
	}
	rec.Name = trimmed
	if in.BranchID != 0 {
		rec.BranchID = in.BranchID
	}
	rec.Branch = strings.TrimSpace(in.Branch)
	rec.Ifsc = strings.TrimSpace(in.Ifsc)
	rec.AccountNo = strings.TrimSpace(in.AccountNo)
	rec.Phone = phone
	if err := s.repo.Update(ctx, rec); err != nil {
		return nil, err
	}
	return rec, nil
}

// Delete hard-deletes a bank, refusing while any CashMovement or
// BankPledgeRecord still references it — per the confirmed decision, a hard
// DELETE guarded by a reference count, not a soft-delete/IsActive flag. The
// refusal names the actual reference count so the UI can show staff exactly
// why (and point them at Merge, below, which is how a referenced duplicate
// becomes deletable) instead of a generic "in use" message.
func (s *Service) Delete(ctx context.Context, id uint) error {
	if _, err := s.repo.FindByID(ctx, id); err != nil {
		return ErrNotFound
	}
	refs, err := s.repo.CountReferences(ctx, id)
	if err != nil {
		return err
	}
	if refs > 0 {
		return httpx.NewConflict(fmt.Sprintf(
			"this bank has %d linked transaction(s)/pledge(s) and cannot be deleted — merge it into another bank instead", refs))
	}
	return s.repo.Delete(ctx, id)
}

// Merge reassigns every CashMovement/BankPledgeRecord reference from
// sourceID to targetID, then deletes sourceID (now unreferenced) — cleans up
// the near-duplicate bank rows the historical free-text-bank backfill is
// expected to create (Phase 0.5 §11), without fuzzy-matching bank names
// automatically. Returns the surviving (target) bank.
func (s *Service) Merge(ctx context.Context, sourceID, targetID uint) (*Bank, error) {
	if sourceID == targetID {
		return nil, ErrSameBank
	}
	if _, err := s.repo.FindByID(ctx, sourceID); err != nil {
		return nil, ErrNotFound
	}
	target, err := s.repo.FindByID(ctx, targetID)
	if err != nil {
		return nil, ErrNotFound
	}
	if err := s.repo.ReassignBankID(ctx, sourceID, targetID); err != nil {
		return nil, err
	}
	if err := s.repo.Delete(ctx, sourceID); err != nil {
		return nil, err
	}
	return target, nil
}
