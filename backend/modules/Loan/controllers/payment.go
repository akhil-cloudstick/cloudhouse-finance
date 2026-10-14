package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"errors"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm"

	"github.com/labstack/echo/v4"
)

var staffSelectablePaymentTypes = map[string]bool{
	models.PaymentTypeInterest:       true,
	models.PaymentTypePenalInterest:  true,
	models.PaymentTypePrincipal:      true,
	models.PaymentTypePartial:        true,
	models.PaymentTypeFullSettlement: true,
}

type RazorpayOrderResult struct {
	OrderID  string  `json:"order_id"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
	KeyID    string  `json:"key_id"`
}

type RazorpayVerifyInput struct {
	OrderID   string
	PaymentID string
	Signature string
	Amount    float64
	Type      string
}

type PaymentInput struct {
	Amount               float64
	Type                 string
	ProcessingFee        float64
	PaidOn               time.Time
	ReceivedByEmployeeID *uint
	CashAmount           float64
	UpiAmount            float64
	BankTransferAmount   float64
	ChequeAmount         float64
	Method               string
	Reference            string
	Description          string
	BankID               *uint
	InterestOverride     *float64
}

type paymentRequest struct {
	Amount             float64  `json:"amount" binding:"required"`
	Type               string   `json:"type" binding:"required"`
	ProcessingFee      float64  `json:"processing_fee"`
	PaidOn             string   `json:"paid_on" binding:"required"`
	CashAmount         float64  `json:"cash_amount"`
	UpiAmount          float64  `json:"upi_amount"`
	BankTransferAmount float64  `json:"bank_transfer_amount"`
	ChequeAmount       float64  `json:"cheque_amount"`
	BankID             *uint    `json:"bank_id"`
	Reference          string   `json:"reference"`
	Description        string   `json:"description"`
	InterestOverride   *float64 `json:"interest_override"`
}

type CustomerPaymentRow struct {
	models.LoanPayment
	LoanNumber string `json:"loan_number"`
}

func normalizeRazorpayPaymentType(t string) string {
	if t == "FullSettlement" {
		return models.PaymentTypeFullSettlement
	}
	return t
}

func createRazorpayOrder(ctx context.Context, loanID uint, amount float64, paymentType string) (*RazorpayOrderResult, error) {
	if config.Razorpay == nil || config.IsDemoRun(ctx) {
		return nil, common.NewUnavailable("razorpay is not configured")
	}
	if amount <= 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	l, err := GetLoan(ctx, loanID, nil)
	if err != nil {
		return nil, err
	}
	normalizedType := normalizeRazorpayPaymentType(paymentType)
	const epsilon = 0.01
	switch normalizedType {
	case models.PaymentTypeInterest:
		owed := l.OutstandingInterest + l.OutstandingPenalInterest
		if diff := amount - owed; diff > epsilon || diff < -epsilon {
			return nil, common.NewBadRequest("amount does not match what is owed for this payment type")
		}
	case models.PaymentTypeFullSettlement:
		if diff := amount - l.SettlementAmount; diff > epsilon || diff < -epsilon {
			return nil, common.NewBadRequest("amount does not match what is owed for this payment type")
		}
	default:
		if amount > l.TotalOutstandingBalance+epsilon {
			return nil, common.NewBadRequest("amount does not match what is owed for this payment type")
		}
	}
	amountPaise := int64(amount*100 + 0.5)
	order, err := config.Razorpay.
		CreateOrder(amountPaise, l.LoanNumber)
	if err != nil {
		return nil, fmt.Errorf("create razorpay order: %w", err)
	}
	return &RazorpayOrderResult{
		OrderID:  order.ID,
		Amount:   amount,
		Currency: "INR",
		KeyID: config.Razorpay.
			KeyID,
	}, nil
}

func verifyAndRecordRazorpayPayment(ctx context.Context, loanID uint, in RazorpayVerifyInput) (*models.Loan, error) {
	if config.Razorpay == nil || config.IsDemoRun(ctx) {
		return nil, common.NewUnavailable("razorpay is not configured")
	}
	if !config.Razorpay.
		VerifySignature(in.OrderID, in.PaymentID, in.Signature) {
		return nil, common.NewBadRequest("payment signature verification failed")
	}
	return SaveLoanPayment(ctx, loanID, PaymentInput{
		Amount:               in.Amount,
		Type:                 normalizeRazorpayPaymentType(in.Type),
		PaidOn:               time.Now(),
		ReceivedByEmployeeID: nil,
		Method:               "Online",
		Reference:            in.PaymentID,
		Description:          "Razorpay online payment",
	})
}

func allocatePayment(l *models.Loan, paymentType string, amount float64, interestOverride *float64) (fee, penal, interest, principal float64, err error) {
	const epsilon = 0.01
	feeOutstanding := l.OutstandingProcessingFee
	penalOutstanding := l.AccruedPenalInterest - l.PenalInterestPaid
	interestOutstanding := l.AccruedInterest - l.InterestPaid
	if interestOverride != nil {
		interestOutstanding = *interestOverride
	}
	principalOutstanding := l.OutstandingAmount
	switch paymentType {
	case models.PaymentTypePrincipal:
		remaining := amount
		fee = math.Min(remaining, feeOutstanding)
		remaining -= fee
		if remaining > principalOutstanding+epsilon {
			return 0, 0, 0, 0, common.NewBadRequest("amount does not match what is owed for this payment type")
		}
		principal = remaining
	case models.PaymentTypeInterest:
		remaining := amount
		fee = math.Min(remaining, feeOutstanding)
		remaining -= fee
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		interest = math.Min(remaining, interestOutstanding)
		remaining -= interest
		if remaining > epsilon {
			return 0, 0, 0, 0, common.NewBadRequest("amount does not match what is owed for this payment type")
		}
	case models.PaymentTypePenalInterest:
		remaining := amount
		fee = math.Min(remaining, feeOutstanding)
		remaining -= fee
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		if remaining > epsilon {
			return 0, 0, 0, 0, common.NewBadRequest("amount does not match what is owed for this payment type")
		}
	case models.PaymentTypePartial:
		remaining := amount
		fee = math.Min(remaining, feeOutstanding)
		remaining -= fee
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		interest = math.Min(remaining, interestOutstanding)
		remaining -= interest
		principal = math.Min(remaining, principalOutstanding)
		remaining -= principal
		if remaining > epsilon {
			return 0, 0, 0, 0, common.NewBadRequest("amount does not match what is owed for this payment type")
		}
	case models.PaymentTypeFullSettlement:
		total := feeOutstanding + penalOutstanding + interestOutstanding + principalOutstanding
		if amount+epsilon < total || amount > total+epsilon {
			return 0, 0, 0, 0, common.NewBadRequest("amount does not match what is owed for this payment type")
		}
		fee, penal, interest, principal = feeOutstanding, penalOutstanding, interestOutstanding, principalOutstanding
	case models.PaymentTypeAuctionSale:
		remaining := amount
		fee = math.Min(remaining, feeOutstanding)
		remaining -= fee
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		interest = math.Min(remaining, interestOutstanding)
		remaining -= interest
		principal = math.Min(remaining, principalOutstanding)
	case models.PaymentTypeAuctionWriteOff:
		remaining := amount
		fee = math.Min(remaining, feeOutstanding)
		remaining -= fee
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		interest = math.Min(remaining, interestOutstanding)
		remaining -= interest
		principal = math.Min(remaining, principalOutstanding)
	case "Adjustment":
		principal = math.Min(amount, principalOutstanding)
	case models.PaymentTypeWaiver:
		remaining := amount
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		interest = math.Min(remaining, interestOutstanding)
		remaining -= interest
		if remaining > epsilon {
			return 0, 0, 0, 0, common.NewBadRequest("amount does not match what is owed for this payment type")
		}
	case models.PaymentTypeDiscount:
		remaining := amount
		penal = math.Min(remaining, penalOutstanding)
		remaining -= penal
		interest = math.Min(remaining, interestOutstanding)
		remaining -= interest
		principal = math.Min(remaining, principalOutstanding)
	default:
		return 0, 0, 0, 0, common.NewBadRequest("type must be Interest, Principal, Partial, Full Settlement, Adjustment, Waiver, or Discount")
	}
	return fee, penal, interest, principal, nil
}

func SaveLoanPayment(ctx context.Context, loanID uint, in PaymentInput) (*models.Loan, error) {
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	if in.Amount <= 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	if in.ProcessingFee < 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	if isCashPaymentType(in.Type) && in.Method == "" {
		if err := common.ValidateSplit(in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, in.Amount); err != nil {
			return nil, err
		}
		if (in.UpiAmount > 0 || in.BankTransferAmount > 0 || in.ChequeAmount > 0) && in.BankID == nil {
			return nil, common.NewBadRequest("bank is required when the payment breakdown includes UPI or Bank Transfer")
		}
	}
	if in.InterestOverride != nil && *in.InterestOverride < 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	var p *models.LoanPayment
	// The interest up to the payment date, the payment's allocation, the loan, its payment row and the cash lines
	// are saved together on the locked loan: a rejected payment leaves no interest behind, a failed cash line undoes
	// the payment instead of leaving one on the ledger that the cards never saw, and two payments at once cannot
	// both charge the same days.
	if err := config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		saved, err := lockByID(ctx, tx, loanID)
		if err != nil {
			return common.NewNotFound("loan not found")
		}
		syncAccrualState(l, saved)
		if err := accrueThroughInTx(ctx, tx, l, in.PaidOn); err != nil {
			return err
		}
		if now := time.Now(); !in.PaidOn.After(now) && in.PaidOn.Format("2006-01-02") == now.Format("2006-01-02") {
			in.PaidOn = now
		}
		if in.ProcessingFee > 0 {
			l.OutstandingProcessingFee = common.RoundMoney(l.OutstandingProcessingFee + in.ProcessingFee)
		}
		fee, penal, interest, principal, err := allocatePayment(l, in.Type, in.Amount, in.InterestOverride)
		if err != nil {
			return err
		}
		l.OutstandingProcessingFee = common.RoundMoney(l.OutstandingProcessingFee - fee)
		if l.OutstandingProcessingFee < 0 {
			l.OutstandingProcessingFee = 0
		}
		l.PenalInterestPaid = common.RoundMoney(l.PenalInterestPaid + penal)
		l.InterestPaid = common.RoundMoney(l.InterestPaid + interest)
		l.OutstandingAmount = common.RoundMoney(l.OutstandingAmount - principal)
		if l.OutstandingAmount < 0 {
			l.OutstandingAmount = 0
		}
		if isCashPaymentType(in.Type) {
			// any repayment sends a Multiple-interest loan back to its first rate
			resetRateCycle(l, in.PaidOn)
		}
		outstandingInterest := l.AccruedInterest - l.InterestPaid
		outstandingPenal := l.AccruedPenalInterest - l.PenalInterestPaid
		if l.OutstandingAmount <= 0 && outstandingInterest <= 0.01 && outstandingPenal <= 0.01 &&
			l.OutstandingProcessingFee <= 0.01 &&
			(l.Status == models.StatusActive || l.Status == models.StatusDueSoon || l.Status == models.StatusOverdue) {
			l.Status = models.StatusClosureRequested
		} else {
			refreshServicingStatus(l, time.Now())
		}
		runningBalance := l.OutstandingAmount + math.Max(0, outstandingInterest) + math.Max(0, outstandingPenal) + l.OutstandingProcessingFee
		p = &models.LoanPayment{
			LoanID:               loanID,
			Amount:               in.Amount,
			Type:                 in.Type,
			ProcessingFee:        in.ProcessingFee,
			ProcessingFeeApplied: fee,
			PaidOn:               in.PaidOn,
			ReceivedByEmployeeID: in.ReceivedByEmployeeID,
			Description:          in.Description,
			Method:               methodOrDerived(in.Method, in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount),
			CashAmount:           in.CashAmount,
			UpiAmount:            in.UpiAmount,
			BankTransferAmount:   in.BankTransferAmount,
			ChequeAmount:         in.ChequeAmount,
			BankID:               in.BankID,
			Reference:            in.Reference,
			PenalInterestApplied: penal,
			InterestApplied:      interest,
			PrincipalApplied:     principal,
			RunningBalance:       runningBalance,
		}
		if err := updateLoanTx(ctx, tx, l); err != nil {
			return err
		}
		if err := createPaymentTx(ctx, tx, p); err != nil {
			return err
		}
		if !isCashPaymentType(in.Type) {
			return nil
		}
		_, groupID, err := cashbook.RecordLoanPaymentCashIn(cashbook.WithTx(ctx, tx), l.ID, l.LoanNumber, in.Amount, in.CashAmount, in.UpiAmount, in.BankTransferAmount, in.ChequeAmount, l.BranchID, in.PaidOn, in.Type, l.CustomerID, in.BankID)
		if err != nil {
			return fmt.Errorf("could not record the payment in Cash-in-Hand, payment not saved: %w", err)
		}
		if groupID == "" {
			return nil
		}
		return tx.Model(&models.LoanPayment{}).Where("id = ?", p.ID).Update("cash_transaction_group_id", groupID).Error
	}); err != nil {
		return nil, err
	}
	auctionNotified := resolveAuctionAfterPayment(ctx, l, p)
	if !auctionNotified {
		notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Payment Received", brandedMessage(ctx,
			"Dear %s, we have received your payment of ₹%.2f (%s) towards loan %s. — CloudHouse Finance",
			l.Customer.Name, in.Amount, in.Type, l.LoanNumber,
		), commonModels.TriggerPayment, "loan", l.ID)
	}
	return GetLoan(ctx, l.ID, nil)
}

func listPaymentsForCustomer(ctx context.Context, customerID uint, from, to *time.Time, search string, limit, offset int) ([]CustomerPaymentRow, int64, error) {
	if _, err := common.FindCustomerByID(ctx, customerID); err != nil {
		return nil, 0, common.NewBadRequest("customer does not exist")
	}
	return findByCustomerIDForProfile(ctx, customerID, from, to, search, limit, offset)
}

func insertPayment(ctx context.Context, p *models.LoanPayment) error {
	return config.DB.
		WithContext(ctx).Create(p).Error
}

func createPaymentTx(ctx context.Context, tx *gorm.DB, p *models.LoanPayment) error {
	return paymentDbOr(ctx, tx).Create(p).Error
}

func setCashTransactionGroupID(ctx context.Context, paymentID uint, groupID string) error {
	return config.DB.
		WithContext(ctx).Model(&models.LoanPayment{}).Where("id = ?", paymentID).
		Update("cash_transaction_group_id", groupID).Error
}

func paymentDbOr(ctx context.Context, tx *gorm.DB) *gorm.DB {
	if tx != nil {
		return tx
	}
	return config.DB.
		WithContext(ctx)
}

func deleteByLoanIDAndType(ctx context.Context, loanID uint, paymentType string) error {
	return config.DB.
		WithContext(ctx).Where("loan_id = ? AND type = ?", loanID, paymentType).Delete(&models.LoanPayment{}).Error
}

func findPaymentByLoanID(ctx context.Context, loanID uint) ([]models.LoanPayment, error) {
	var payments []models.LoanPayment
	err := config.DB.
		WithContext(ctx).Where("loan_id = ?", loanID).Order("paid_on desc, id desc").Find(&payments).Error
	return payments, err
}

func findByLoanIDPaged(ctx context.Context, loanID uint, limit, offset int) ([]models.LoanPayment, int64, error) {
	var payments []models.LoanPayment
	var total int64
	q := config.DB.
		WithContext(ctx).Model(&models.LoanPayment{}).Where("loan_id = ?", loanID)
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	find := config.DB.
		WithContext(ctx).Preload("BankRef").Where("loan_id = ?", loanID).Order("paid_on asc, id asc")
	if limit > 0 {
		find = find.Limit(limit).Offset(offset)
	}
	err := find.Find(&payments).Error
	return payments, total, err
}

func findPaymentByID(ctx context.Context, id uint) (*models.LoanPayment, error) {
	var p models.LoanPayment
	if err := config.DB.
		WithContext(ctx).First(&p, id).Error; err != nil {
		return nil, err
	}
	return &p, nil
}

func findPaymentByCustomerID(ctx context.Context, customerID uint, limit, offset int) ([]models.LoanPayment, error) {
	var payments []models.LoanPayment
	q := config.DB.
		WithContext(ctx).Model(&models.LoanPayment{}).
		Select("loan_payments.*").
		Joins("JOIN loans ON loans.id = loan_payments.loan_id").
		Where("loans.customer_id = ?", customerID).
		Order("loan_payments.paid_on desc, loan_payments.id desc")
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&payments).Error
	return payments, err
}

func findByCustomerIDForProfile(ctx context.Context, customerID uint, from, to *time.Time, search string, limit, offset int) ([]CustomerPaymentRow, int64, error) {
	var rows []CustomerPaymentRow
	q := config.DB.
		WithContext(ctx).Model(&models.LoanPayment{}).
		Select("loan_payments.*, loans.loan_number AS loan_number").
		Joins("JOIN loans ON loans.id = loan_payments.loan_id").
		Where("loans.customer_id = ?", customerID)
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("loans.loan_number ILIKE ? OR loan_payments.type ILIKE ? OR loan_payments.method ILIKE ?", like, like, like)
	}
	if from != nil {
		q = q.Where("loans.opened_date >= ?", startOfDay(*from))
	}
	if to != nil {
		q = q.Where("loans.opened_date < ?", startOfDay(*to).AddDate(0, 0, 1))
	}
	q = q.Order("loan_payments.paid_on desc, loan_payments.id desc")
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

func findLatestPaidOn(ctx context.Context, loanID uint) (time.Time, error) {
	var p models.LoanPayment
	err := config.DB.
		WithContext(ctx).Where("loan_id = ?", loanID).Order("paid_on desc, id desc").First(&p).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return time.Time{}, nil
		}
		return time.Time{}, err
	}
	return p.PaidOn, nil
}

func sumInterestCollected(ctx context.Context, from, to time.Time, branchID *uint) (float64, error) {
	var total float64
	q := config.DB.
		WithContext(ctx).Model(&models.LoanPayment{}).
		Where("paid_on >= ? AND paid_on <= ?", from, to)
	if branchID != nil {
		q = q.Where("loan_id IN (SELECT id FROM loans WHERE branch_id = ?)", *branchID)
	}
	err := q.Select("COALESCE(SUM(interest_applied + penal_interest_applied), 0)").
		Row().Scan(&total)
	return total, err
}

func ListPaymentsForCustomer(c echo.Context) error {
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
	rec, total, err := listPaymentsForCustomer(ctx, customerID, from, to, strings.TrimSpace(c.QueryParam("search")), limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessPage(c, page, limit, total, rec)
}

func RecordLoanPayment(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req paymentRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	if !staffSelectablePaymentTypes[req.Type] {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "type must be one of: Interest, Penal Interest, Principal, Partial, Full Settlement"})
	}
	paidOn, err := parsePaidOn(req.PaidOn)
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid paid_on: expected YYYY-MM-DD"})
	}
	actorEmployeeID, _, _ := auth.ActorFromContext(c)
	rec, err := SaveLoanPayment(ctx, loanID, PaymentInput{
		Amount:               req.Amount,
		Type:                 req.Type,
		ProcessingFee:        req.ProcessingFee,
		PaidOn:               paidOn,
		ReceivedByEmployeeID: &actorEmployeeID,
		CashAmount:           req.CashAmount,
		UpiAmount:            req.UpiAmount,
		BankTransferAmount:   req.BankTransferAmount,
		ChequeAmount:         req.ChequeAmount,
		BankID:               req.BankID,
		Reference:            req.Reference,
		Description:          req.Description,
		InterestOverride:     req.InterestOverride,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}
