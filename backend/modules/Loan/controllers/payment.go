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
	// CheckDateWindow is set by the staff-entered paths: the date must fall between the loan's start and today.
	CheckDateWindow bool
	// Discount is a negotiated write-off taken off the loan on the same date as the payment. It is saved as its own
	// Discount row (no cash moves) in the same transaction as the payment, so both land or neither does.
	Discount       float64
	DiscountReason string
	DiscountMode   string // Cash / UPI / Bank Transfer / Cheque — which ledger mode the discount is shown under
	// DiscountKind is what the discount is given against (see models.LoanPayment.DiscountKind); empty means customer.
	DiscountKind string
}

var discountModes = map[string]bool{"Cash": true, "UPI": true, "Bank Transfer": true, "Cheque": true}

// What a discount is given against. A penal-interest or interest discount can only take off that much of what is
// owed; a customer discount is the negotiated reduction that falls through penal interest, interest, then principal.
const (
	DiscountKindCustomer      = "customer"
	DiscountKindInterest      = "interest"
	DiscountKindPenalInterest = "penal_interest"
)

// discountKindFor is the kind to save on a payment row: only a Discount row carries one.
func discountKindFor(in PaymentInput) string {
	if in.Type == models.PaymentTypeDiscount {
		return in.DiscountKind
	}
	return ""
}

func validDiscountKind(kind string) bool {
	return kind == "" || kind == DiscountKindCustomer || kind == DiscountKindInterest || kind == DiscountKindPenalInterest
}

// allocateDiscountKind splits a discount over what the loan owes, by what it was given against.
func allocateDiscountKind(l *models.Loan, amount float64, kind string) (penal, interest, principal float64, err error) {
	switch kind {
	case DiscountKindPenalInterest:
		owed := clampMoney(common.RoundMoney(l.AccruedPenalInterest - l.PenalInterestPaid))
		if amount > owed+0.01 {
			return 0, 0, 0, common.NewBadRequest(fmt.Sprintf("the penal interest discount cannot exceed the ₹%.2f of penal interest owed", owed))
		}
		return common.RoundMoney(amount), 0, 0, nil
	case DiscountKindInterest:
		owed := clampMoney(common.RoundMoney(l.AccruedInterest - l.InterestPaid))
		if amount > owed+0.01 {
			return 0, 0, 0, common.NewBadRequest(fmt.Sprintf("the interest discount cannot exceed the ₹%.2f of interest owed", owed))
		}
		return 0, common.RoundMoney(amount), 0, nil
	default:
		_, penal, interest, principal, err = allocatePayment(l, models.PaymentTypeDiscount, amount, nil)
		return penal, interest, principal, err
	}
}

// applyDiscountTx takes in.Discount off the loan (penal, then interest, then principal) and writes its ledger row.
// The row moves no cash: the company gives up the amount instead of receiving it.
func applyDiscountTx(ctx context.Context, tx *gorm.DB, l *models.Loan, in PaymentInput) (*models.LoanPayment, error) {
	penal, interest, principal, err := allocateDiscountKind(l, in.Discount, in.DiscountKind)
	if err != nil {
		return nil, err
	}
	if common.RoundMoney(in.Discount-(penal+interest+principal)) > 0.01 {
		return nil, common.NewBadRequest("the discount cannot exceed what is owed on the loan")
	}
	l.PenalInterestPaid = common.RoundMoney(l.PenalInterestPaid + penal)
	l.InterestPaid = common.RoundMoney(l.InterestPaid + interest)
	l.OutstandingAmount = common.RoundMoney(l.OutstandingAmount - principal)
	// <= also catches -0, which a legacy 21769.86 cleared by a whole ₹21,770 rounds to
	if l.OutstandingAmount <= 0 {
		l.OutstandingAmount = 0
	}
	outstandingInterest := common.RoundMoney(l.AccruedInterest - l.InterestPaid)
	outstandingPenal := common.RoundMoney(l.AccruedPenalInterest - l.PenalInterestPaid)
	row := &models.LoanPayment{
		LoanID:               l.ID,
		Amount:               in.Discount,
		Type:                 models.PaymentTypeDiscount,
		PaidOn:               in.PaidOn,
		ReceivedByEmployeeID: in.ReceivedByEmployeeID,
		Description:          "Discount: " + in.DiscountReason,
		DiscountKind:         in.DiscountKind,
		Method:               in.DiscountMode,
		BankID:               in.BankID,
		PenalInterestApplied: penal,
		InterestApplied:      interest,
		PrincipalApplied:     principal,
		RunningBalance:       l.OutstandingAmount + math.Max(0, outstandingInterest) + math.Max(0, outstandingPenal) + l.OutstandingProcessingFee,
	}
	if err := createPaymentTx(ctx, tx, row); err != nil {
		return nil, err
	}
	return row, nil
}

// validatePaymentDateWindow rejects a staff-chosen payment date before the loan started or in the future.
// Dates are compared as calendar days so the time of day never decides the outcome.
func validatePaymentDateWindow(l *models.Loan, paidOn time.Time) error {
	const layout = "2006-01-02"
	// The loan's own opening date is the floor, even when the money was handed out later (a backdated loan).
	floor := l.OpenedDate
	if l.DisbursementDate != nil && l.DisbursementDate.Before(floor) {
		floor = *l.DisbursementDate
	}
	day := paidOn.Format(layout)
	if day > time.Now().Format(layout) {
		return common.NewBadRequest("payment date cannot be in the future")
	}
	if day < floor.Format(layout) {
		return common.NewBadRequest("payment date cannot be before the loan was opened on " + floor.Format(layout))
	}
	return nil
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
	Discount           float64  `json:"discount"`
	DiscountReason     string   `json:"discount_reason"`
	DiscountMode       string   `json:"discount_mode"`
	DiscountKind       string   `json:"discount_kind"`
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
	// whole rupees, as the loan screen shows them: a loan saved before rounding can owe 21769.86, and the ₹21,770
	// on screen must clear it rather than be rejected for the 14 paise
	feeOutstanding := common.RoundMoney(l.OutstandingProcessingFee)
	penalOutstanding := common.RoundMoney(l.AccruedPenalInterest - l.PenalInterestPaid)
	interestOutstanding := common.RoundMoney(l.AccruedInterest - l.InterestPaid)
	if interestOverride != nil {
		interestOutstanding = common.RoundMoney(*interestOverride)
	}
	principalOutstanding := common.RoundMoney(l.OutstandingAmount)
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
	if l.Status == models.StatusPendingApproval {
		return nil, common.NewBadRequest("payments cannot be recorded until the loan is approved")
	}
	if in.Amount <= 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	if in.ProcessingFee < 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	if in.CheckDateWindow {
		if err := validatePaymentDateWindow(l, in.PaidOn); err != nil {
			return nil, err
		}
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
	if in.Discount < 0 {
		return nil, common.NewBadRequest("discount cannot be negative")
	}
	if !validDiscountKind(in.DiscountKind) {
		return nil, common.NewBadRequest("discount type must be Custom discount, Interest or Penal interest")
	}
	if in.Discount > 0 {
		if strings.TrimSpace(in.DiscountReason) == "" {
			return nil, common.NewBadRequest("a reason is required for a discount")
		}
		if !discountModes[in.DiscountMode] {
			return nil, common.NewBadRequest("discount mode must be Cash, UPI, Bank Transfer or Cheque")
		}
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
		var discountRow *models.LoanPayment
		if in.Discount > 0 {
			row, err := applyDiscountTx(ctx, tx, l, in)
			if err != nil {
				return err
			}
			discountRow = row
		}
		if in.ProcessingFee > 0 {
			l.OutstandingProcessingFee = common.RoundMoney(l.OutstandingProcessingFee + in.ProcessingFee)
		}
		var fee, penal, interest, principal float64
		if in.Type == models.PaymentTypeDiscount {
			penal, interest, principal, err = allocateDiscountKind(l, in.Amount, in.DiscountKind)
		} else {
			fee, penal, interest, principal, err = allocatePayment(l, in.Type, in.Amount, in.InterestOverride)
		}
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
		// <= also catches -0, which a legacy 21769.86 cleared by a whole ₹21,770 rounds to
		if l.OutstandingAmount <= 0 {
			l.OutstandingAmount = 0
		}
		if isCashPaymentType(in.Type) {
			// any repayment sends a Multiple-interest loan back to its first rate
			resetRateCycle(l, in.PaidOn)
		}
		// whole rupees, like allocatePayment: legacy paise left behind (0.30 of interest) must not keep a cleared loan open
		outstandingInterest := common.RoundMoney(l.AccruedInterest - l.InterestPaid)
		outstandingPenal := common.RoundMoney(l.AccruedPenalInterest - l.PenalInterestPaid)
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
			DiscountKind:         discountKindFor(in),
			ProcessingFee:        in.ProcessingFee,
			InterestOverride:     in.InterestOverride,
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
		if discountRow != nil { // the discount that came with this payment points at it
			if err := tx.Model(&models.LoanPayment{}).Where("id = ?", discountRow.ID).Update("linked_payment_id", p.ID).Error; err != nil {
				return err
			}
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
		q = q.Where("loans.loan_number ILIKE ? OR loan_payments.type ILIKE ? OR loan_payments.method ILIKE ?"+
			" OR to_char(loan_payments.paid_on, 'DD-MM-YYYY') LIKE ? OR to_char(loan_payments.paid_on, 'YYYY-MM-DD') LIKE ?"+
			" OR CAST(loan_payments.amount AS TEXT) LIKE ?",
			like, like, like, like, like, "%"+strings.ReplaceAll(search, ",", "")+"%")
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
	actorEmployeeID, _, actorRoleID := auth.ActorFromContext(c)
	if req.Discount > 0 && !checkStagePermission(ctx, actorRoleID, "can give discount") {
		return common.FailErr(c, common.NewPermissionDenied("Access denied", "can give discount"))
	}
	rec, err := SaveLoanPayment(ctx, loanID, PaymentInput{
		Discount:             req.Discount,
		DiscountReason:       req.DiscountReason,
		DiscountMode:         req.DiscountMode,
		DiscountKind:         req.DiscountKind,
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
		CheckDateWindow:      true,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}
