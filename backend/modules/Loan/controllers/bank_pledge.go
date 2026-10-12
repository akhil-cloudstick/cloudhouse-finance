package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	"cloudhouse/backend/modules/Loan/models"
	packet "cloudhouse/backend/modules/Packet/controllers"
	"context"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/labstack/echo/v4"
)

type BankPledgeInput struct {
	BankID             *uint
	BankName           string
	PledgedAmount      float64
	PledgeDate         time.Time
	BankInterestRate   float64
	ReferenceNumber    string
	BankPledgeDueDate  *time.Time
	CashTreatment      string
	CashAmount         float64
	UpiAmount          float64
	BankTransferAmount float64
	ChequeAmount       float64
	ReceivedBankID     *uint
	ActorEmployeeID    *uint
	ActorRole          string
}

type BankPledgeReleaseInput struct {
	CashAmount         float64
	UpiAmount          float64
	BankTransferAmount float64
	ChequeAmount       float64
	BankID             *uint
}

type bankPledgeRequest struct {
	BankID             *uint   `json:"bank_id"`
	BankName           string  `json:"bank_name" binding:"required"`
	PledgedAmount      float64 `json:"pledged_amount" binding:"required"`
	PledgeDate         string  `json:"pledge_date" binding:"required"`
	BankInterestRate   float64 `json:"bank_interest_rate"`
	ReferenceNumber    string  `json:"reference_number"`
	BankPledgeDueDate  string  `json:"bank_pledge_due_date"`
	CashTreatment      string  `json:"cash_treatment"`
	CashAmount         float64 `json:"cash_amount"`
	UpiAmount          float64 `json:"upi_amount"`
	BankTransferAmount float64 `json:"bank_transfer_amount"`
	ChequeAmount       float64 `json:"cheque_amount"`
	ReceivedBankID     *uint   `json:"received_bank_id"`
}

type voidBankPledgeRequest struct {
	Reason string `json:"reason" binding:"required"`
}

type BankPledgeHistoryRow struct {
	models.BankPledgeRecord
	LoanNumber   string `json:"loan_number"`
	CustomerName string `json:"customer_name"`
}

type CustomerBankPledgeRow struct {
	models.BankPledgeRecord
	LoanNumber string `json:"loan_number"`
}

func SaveBankPledge(ctx context.Context, loanID uint, branchID *uint, in BankPledgeInput) (*models.Loan, error) {
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, common.NewNotFound("loan not found")
	}
	if in.PledgedAmount <= 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	// The gold must still be in the branch's custody to hand to a bank.
	if err := bankPledgeRefusal(l.Status, l.BankPledgeStatus); err != nil {
		return nil, err
	}
	hasActivePledge, err := hasActive(ctx, loanID)
	if err != nil {
		return nil, err
	}
	if hasActivePledge {
		return nil, common.NewBadRequest("gold is still pledged to a bank — release the bank pledge before releasing it to the customer")
	}
	var grossWeight float64
	for _, o := range l.Ornaments {
		if o.ReleasedAt != nil {
			continue
		}
		grossWeight += o.GrossWeight
	}
	switch in.CashTreatment {
	case models.BankPledgeCashTreatmentCashIn, models.BankPledgeCashTreatmentRecordOnly:
	default:
		return nil, common.NewBadRequest("cash_treatment must be either \"CashIn\" or \"RecordOnly\"")
	}
	var recvCash, recvUpi, recvBankTransfer, recvCheque float64
	var recvBankID *uint
	if in.CashTreatment == models.BankPledgeCashTreatmentCashIn {
		recvCash, recvUpi, recvBankTransfer, recvCheque, err = common.NormalizeSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, common.RoundMoney(in.PledgedAmount), in.ReceivedBankID)
		if err != nil {
			return nil, err
		}
		if recvUpi+recvBankTransfer+recvCheque > 0 {
			recvBankID = in.ReceivedBankID
		}
	}
	p := &models.BankPledgeRecord{
		LoanID:             loanID,
		BankID:             in.BankID,
		BankName:           in.BankName,
		PledgedAmount:      common.RoundMoney(in.PledgedAmount),
		PledgeDate:         in.PledgeDate,
		BankInterestRate:   in.BankInterestRate,
		ReferenceNumber:    in.ReferenceNumber,
		BankPledgeDueDate:  in.BankPledgeDueDate,
		PledgedGrossWeight: grossWeight,
		PledgedNetWeight:   l.TotalNetWeight,
		CashTreatment:      in.CashTreatment,
		CashAmount:         recvCash,
		UpiAmount:          recvUpi,
		BankTransferAmount: recvBankTransfer,
		ChequeAmount:       recvCheque,
		ReceivedBankID:     recvBankID,
		Status:             models.BankPledgeStatusRecordActive,
	}
	// The pledge's cash lines, the pledge record and the loan's pledge status are saved together.
	if err := config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if in.CashTreatment == models.BankPledgeCashTreatmentCashIn {
			id, err := cashbook.RecordBankPledgeCashIn(cashbook.WithTx(ctx, tx), loanID, l.LoanNumber, in.BankName, common.RoundMoney(in.PledgedAmount), recvCash, recvUpi, recvBankTransfer, recvCheque, recvBankID, in.PledgeDate)
			if err != nil {
				return fmt.Errorf("could not record the pledge in Cash-in-Hand, pledge not saved: %w", err)
			}
			p.CashMovementID = &id
		}
		if err := tx.Create(p).Error; err != nil {
			return err
		}
		l.BankPledgeStatus = models.BankPledgeStatusPledged
		return updateLoanTx(ctx, tx, l)
	}); err != nil {
		return nil, err
	}
	if err := packet.RecordBankPledgeMovement(ctx, loanID, "Bank pledge: "+in.BankName); err != nil {
		log.Printf("packet movement (bank pledge) failed for loan %d: %v", loanID, err)
	}
	recordPledgeEvent(ctx, p, "Pledged", in.ActorEmployeeID, in.ActorRole, pledgeTreatmentRemark(in.CashTreatment))
	return GetLoan(ctx, l.ID, nil)
}

func releaseBankPledge(ctx context.Context, loanID, pledgeID uint, branchID *uint, in BankPledgeReleaseInput, actorID *uint, actorRole string) (*models.Loan, error) {
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, common.NewNotFound("loan not found")
	}
	p, err := findBankPledgeByID(ctx, pledgeID)
	if err != nil || p.LoanID != loanID {
		return nil, common.NewNotFound("loan not found")
	}
	// A pledge that is already released or voided must not pay out (or book its expense) a second time.
	if p.Status != models.BankPledgeStatusRecordActive {
		return nil, common.NewConflict("only an active bank pledge can be released — this one is already released or voided")
	}
	var relCash, relUpi, relBankTransfer, relCheque float64
	var relBankID *uint
	if p.CashTreatment == models.BankPledgeCashTreatmentCashIn {
		relCash, relUpi, relBankTransfer, relCheque, err = common.NormalizeSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, p.PledgedAmount, in.BankID)
		if err != nil {
			return nil, err
		}
		if relUpi+relBankTransfer+relCheque > 0 {
			relBankID = in.BankID
		}
	}
	if p.CashTreatment == models.BankPledgeCashTreatmentCashIn && (relCash > 0 || relUpi+relBankTransfer > 0) {
		hoID, err := cashbook.HeadOfficeBranchID(ctx)
		if err != nil {
			return nil, err
		}
		if err := ensurePayoutFunds(ctx, hoID, relCash, relBankID, relUpi+relBankTransfer); err != nil {
			return nil, err
		}
	}
	now := time.Now()
	p.ReleaseDate = &now
	p.Status = "Released"
	// The release's cash lines, its expense row, the pledge record and the loan status are saved together.
	if err := config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if p.CashTreatment == models.BankPledgeCashTreatmentCashIn {
			txCtx := cashbook.WithTx(ctx, tx)
			movementID, err := cashbook.RecordBankPledgeCashOut(txCtx, loanID, l.LoanNumber, p.BankName, p.PledgedAmount, relCash, relUpi, relBankTransfer, relCheque, relBankID, now, l.BranchID)
			if err != nil {
				return fmt.Errorf("could not record the pledge release in Cash-in-Hand, release not saved: %w", err)
			}
			expenseID, err := cashbook.RecordBankPledgeReleaseExpense(txCtx, loanID, p.BankName, p.PledgedAmount, now, l.BranchID)
			if err != nil {
				return fmt.Errorf("could not record the pledge release expense, release not saved: %w", err)
			}
			p.ReleaseCashMovementID = &movementID
			p.ReleaseExpenseID = &expenseID
		}
		if err := tx.Save(p).Error; err != nil {
			return err
		}
		l.BankPledgeStatus = "Released"
		return updateLoanTx(ctx, tx, l)
	}); err != nil {
		return nil, err
	}
	if err := packet.RecordBankReleaseMovement(ctx, loanID, "Gold returned from bank: "+p.BankName); err != nil {
		log.Printf("packet bank-release movement failed for loan %d: %v", loanID, err)
	}
	recordPledgeEvent(ctx, p, "Released", actorID, actorRole, pledgeReleaseRemark(p.CashTreatment))
	return GetLoan(ctx, l.ID, nil)
}

func voidBankPledge(ctx context.Context, loanID, pledgeID uint, branchID *uint, reason string, actorID *uint, actorRole string) (*models.Loan, error) {
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, common.NewNotFound("loan not found")
	}
	p, err := findBankPledgeByID(ctx, pledgeID)
	if err != nil || p.LoanID != loanID {
		return nil, common.NewNotFound("bank pledge record not found")
	}
	if p.Status != models.BankPledgeStatusRecordActive {
		return nil, common.NewConflict("only an active bank pledge can be voided — this one is already released or voided")
	}
	if strings.TrimSpace(reason) == "" {
		return nil, common.NewBadRequest("a reason is required when voiding a bank pledge")
	}
	now := time.Now()
	p.Status = "Voided"
	p.VoidedAt = &now
	p.VoidReason = reason
	// The compensating cash line, the voided pledge and the loan status are saved together.
	if err := config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if p.CashTreatment == models.BankPledgeCashTreatmentCashIn {
			movementID, err := cashbook.RecordBankPledgeCashOut(cashbook.WithTx(ctx, tx), loanID, l.LoanNumber, p.BankName, p.PledgedAmount, p.CashAmount, p.UpiAmount, p.BankTransferAmount, p.ChequeAmount, p.ReceivedBankID, now, l.BranchID)
			if err != nil {
				return fmt.Errorf("could not record the compensating cash-out, pledge not voided: %w", err)
			}
			p.VoidCashMovementID = &movementID
		}
		if err := tx.Save(p).Error; err != nil {
			return err
		}
		l.BankPledgeStatus = "Not Pledged"
		return updateLoanTx(ctx, tx, l)
	}); err != nil {
		return nil, err
	}
	if err := packet.RecordBankReleaseMovement(ctx, loanID, "Bank pledge voided: "+reason); err != nil {
		log.Printf("packet movement (pledge void) failed for loan %d: %v", loanID, err)
	}
	recordPledgeEvent(ctx, p, "Voided", actorID, actorRole, reason)
	return GetLoan(ctx, l.ID, nil)
}

func getBankPledgeHistory(ctx context.Context, loanID uint, branchID *uint) ([]models.BankPledgeRecord, error) {
	if err := checkLoanBranch(ctx, loanID, branchID); err != nil {
		return nil, err
	}
	return findBankPledgeHistoryByLoanID(ctx, loanID)
}

func listBankPledgeHistory(ctx context.Context, branchID *uint, query string, limit, offset int) ([]BankPledgeHistoryRow, int64, error) {
	return findAllHistory(ctx, branchID, query, limit, offset)
}

func listBankPledgesForCustomer(ctx context.Context, customerID uint, from, to *time.Time, search string, limit, offset int) ([]CustomerBankPledgeRow, int64, error) {
	if _, err := common.FindCustomerByID(ctx, customerID); err != nil {
		return nil, 0, common.NewBadRequest("customer does not exist")
	}
	return findBankPledgeAllByCustomerID(ctx, customerID, from, to, search, limit, offset)
}

func CanAcceptBankPledge(status string) bool {
	for _, s := range models.BankPledgeIneligibleStatuses {
		if status == s {
			return false
		}
	}
	return true
}

func bankPledgeRefusal(status, bankPledgeStatus string) error {
	if !CanAcceptBankPledge(status) {
		return common.NewBadRequest("this loan's gold is no longer held by the branch (closed, released or auctioned), so it cannot be re-pledged to a bank")
	}
	if bankPledgeStatus == models.BankPledgeStatusPledged {
		return common.NewBadRequest("gold is still pledged to a bank — release the bank pledge before releasing it to the customer")
	}
	return nil
}

func pledgeTreatmentRemark(treatment string) string {
	if treatment == models.BankPledgeCashTreatmentCashIn {
		return "Pledged amount added to Cash-in-Hand"
	}
	return "Recorded as a re-pledge record only — no cash effect"
}

func recordPledgeEvent(ctx context.Context, p *models.BankPledgeRecord, action string, actorID *uint, actorRole, remarks string) {
	if err := createBankPledgeEvent(ctx, &models.BankPledgeEvent{
		BankPledgeRecordID: p.ID,
		Action:             action,
		ActorEmployeeID:    actorID,
		ActorRole:          actorRole,
		Amount:             p.PledgedAmount,
		Remarks:            remarks,
	}); err != nil {
		log.Printf("bank pledge event (%s) failed for pledge %d: %v", action, p.ID, err)
	}
}

func insertBankPledge(ctx context.Context, p *models.BankPledgeRecord) error {
	return config.DB.
		WithContext(ctx).Create(p).Error
}

func persistBankPledge(ctx context.Context, p *models.BankPledgeRecord) error {
	return config.DB.
		WithContext(ctx).Save(p).Error
}

func findBankPledgeByID(ctx context.Context, id uint) (*models.BankPledgeRecord, error) {
	var p models.BankPledgeRecord
	if err := config.DB.
		WithContext(ctx).First(&p, id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func hasActive(ctx context.Context, loanID uint) (bool, error) {
	var count int64
	err := config.DB.
		WithContext(ctx).Model(&models.BankPledgeRecord{}).
		Where("loan_id = ? AND status = ?", loanID, models.BankPledgeStatusRecordActive).
		Count(&count).Error
	return count > 0, err
}

func findBankPledgeByLoanID(ctx context.Context, loanID uint) ([]models.BankPledgeRecord, error) {
	var pledges []models.BankPledgeRecord
	err := config.DB.
		WithContext(ctx).Where("loan_id = ?", loanID).Order("id desc").Find(&pledges).Error
	return pledges, err
}

func findBankPledgeHistoryByLoanID(ctx context.Context, loanID uint) ([]models.BankPledgeRecord, error) {
	var pledges []models.BankPledgeRecord
	err := config.DB.
		WithContext(ctx).
		Preload("Events", func(d *gorm.DB) *gorm.DB { return d.Order("created_at asc, id asc") }).
		Where("loan_id = ?", loanID).
		Order("id desc").
		Find(&pledges).Error
	return pledges, err
}

func findAllHistory(ctx context.Context, branchID *uint, query string, limit, offset int) ([]BankPledgeHistoryRow, int64, error) {
	var pledges []BankPledgeHistoryRow
	q := config.DB.
		WithContext(ctx).Model(&models.BankPledgeRecord{}).
		Select("bank_pledge_records.*, loans.loan_number AS loan_number, customers.name AS customer_name").
		Joins("JOIN loans ON loans.id = bank_pledge_records.loan_id").
		Joins("JOIN customers ON customers.id = loans.customer_id").
		Preload("Events", func(d *gorm.DB) *gorm.DB { return d.Order("created_at asc, id asc") })
	if branchID != nil {
		q = q.Where("loans.branch_id = ?", *branchID)
	}
	if query != "" {
		like := "%" + query + "%"
		q = q.Where(
			"loans.loan_number ILIKE ? OR bank_pledge_records.bank_name ILIKE ? OR customers.name ILIKE ? OR customers.code ILIKE ?",
			like, like, like, like,
		)
	}
	q = q.Order("bank_pledge_records.id desc")
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&pledges).Error
	return pledges, total, err
}

func findBankPledgeAllByCustomerID(ctx context.Context, customerID uint, from, to *time.Time, search string, limit, offset int) ([]CustomerBankPledgeRow, int64, error) {
	var rows []CustomerBankPledgeRow
	q := config.DB.
		WithContext(ctx).Model(&models.BankPledgeRecord{}).
		Select("bank_pledge_records.*, loans.loan_number AS loan_number").
		Joins("JOIN loans ON loans.id = bank_pledge_records.loan_id").
		Where("loans.customer_id = ?", customerID)
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("loans.loan_number ILIKE ? OR bank_pledge_records.bank_name ILIKE ?", like, like)
	}
	if from != nil {
		q = q.Where("loans.opened_date >= ?", startOfDay(*from))
	}
	if to != nil {
		q = q.Where("loans.opened_date < ?", startOfDay(*to).AddDate(0, 0, 1))
	}
	q = q.Order("bank_pledge_records.id desc")
	var total int64
	if limit > 0 {
		if err := q.Session(&gorm.Session{}).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&rows).Error
	return rows, total, err
}

func createBankPledgeEvent(ctx context.Context, e *models.BankPledgeEvent) error {
	return config.DB.
		WithContext(ctx).Create(e).Error
}

func ListBankPledgesForCustomer(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	customerID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if !customerInScope(c, ctx, customerID) {
		return nil
	}
	from, to, ok := parseOpenedRange(c)
	if !ok {
		return nil
	}
	rec, total, err := listBankPledgesForCustomer(ctx, customerID, from, to, strings.TrimSpace(c.QueryParam("search")), limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessPage(c, page, limit, total, rec)
}

func RecordBankPledge(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req bankPledgeRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	pledgeDate, err := parseDate(req.PledgeDate)
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid pledge_date: expected YYYY-MM-DD"})
	}
	var dueDate *time.Time
	if req.BankPledgeDueDate != "" {
		d, err := parseDate(req.BankPledgeDueDate)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid bank_pledge_due_date: expected YYYY-MM-DD"})
		}
		dueDate = &d
	}
	cashTreatment := req.CashTreatment
	if cashTreatment == "" {
		cashTreatment = models.BankPledgeCashTreatmentRecordOnly
	}
	actorID, actorRole, _ := actorPtr(c)
	rec, err := SaveBankPledge(ctx, loanID, auth.GetBranchScope(c), BankPledgeInput{
		BankID:             req.BankID,
		BankName:           req.BankName,
		PledgedAmount:      req.PledgedAmount,
		PledgeDate:         pledgeDate,
		BankInterestRate:   req.BankInterestRate,
		ReferenceNumber:    req.ReferenceNumber,
		BankPledgeDueDate:  dueDate,
		CashTreatment:      cashTreatment,
		CashAmount:         req.CashAmount,
		UpiAmount:          req.UpiAmount,
		BankTransferAmount: req.BankTransferAmount,
		ChequeAmount:       req.ChequeAmount,
		ReceivedBankID:     req.ReceivedBankID,
		ActorEmployeeID:    actorID,
		ActorRole:          actorRole,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ReleaseBankPledge(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	pledgeID, err := common.IDParam(c, "pledge_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req struct {
		CashAmount         float64 `json:"cash_amount"`
		UpiAmount          float64 `json:"upi_amount"`
		BankTransferAmount float64 `json:"bank_transfer_amount"`
		ChequeAmount       float64 `json:"cheque_amount"`
		BankID             *uint   `json:"bank_id"`
	}
	if c.Request().ContentLength != 0 {
		if err := common.BindJSON(c, &req); err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
		}
	}
	actorID, actorRole, _ := actorPtr(c)
	rec, err := releaseBankPledge(ctx, loanID, pledgeID, auth.GetBranchScope(c), BankPledgeReleaseInput{
		CashAmount:         req.CashAmount,
		UpiAmount:          req.UpiAmount,
		BankTransferAmount: req.BankTransferAmount,
		ChequeAmount:       req.ChequeAmount,
		BankID:             req.BankID,
	}, actorID, actorRole)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func VoidBankPledge(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	pledgeID, err := common.IDParam(c, "pledge_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req voidBankPledgeRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	actorID, actorRole, _ := actorPtr(c)
	rec, err := voidBankPledge(ctx, loanID, pledgeID, auth.GetBranchScope(c), req.Reason, actorID, actorRole)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func GetBankPledgeHistory(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	recs, err := getBankPledgeHistory(ctx, loanID, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, recs)
}

func ListBankPledgeHistory(c echo.Context) error {
	ctx := auth.RequestContext(c)
	branchID := auth.GetBranchScope(c)
	query := c.QueryParam("search")
	page, limit, offset := common.PageParams(c)
	if limit > 0 {
		recs, total, err := listBankPledgeHistory(ctx, branchID, query, limit, offset)
		if err != nil {
			return common.FailErr(c, err)
		}
		return common.SuccessPage(c, page, limit, total, recs)
	}
	recs, _, err := listBankPledgeHistory(ctx, branchID, query, 0, 0)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessAll(c, recs)
}
