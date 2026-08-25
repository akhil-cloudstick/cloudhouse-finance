package loan

import (
	"fmt"
	"time"

	"ambikagold/backend/internal/platform/httpx"
)

// ErrRazorpayNotConfigured mirrors ErrEsignNotConfigured's shape: returned
// by CreateRazorpayOrder/VerifyAndRecordRazorpayPayment when
// RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET aren't set, rather than a
// nil-pointer panic.
var ErrRazorpayNotConfigured = httpx.NewUnavailable("razorpay is not configured")

// ErrRazorpayAmountMismatch is returned when the amount a customer typed
// doesn't correspond to any of the three recognized payment shapes for the
// requested type (Interest/FullSettlement exact-match, or an in-range
// Partial amount).
var ErrRazorpayAmountMismatch = httpx.NewBadRequest("amount does not match what is owed for this payment type")

// ErrRazorpaySignatureInvalid is returned by VerifyAndRecordRazorpayPayment
// when the checkout signature doesn't verify — no LoanPayment is created in
// this case.
var ErrRazorpaySignatureInvalid = httpx.NewBadRequest("payment signature verification failed")

// RazorpayOrderResult is what CreateRazorpayOrder returns to the
// customer-app handler — everything the RN Razorpay SDK needs to open
// checkout without a second round trip.
type RazorpayOrderResult struct {
	OrderID  string  `json:"orderId"`
	Amount   float64 `json:"amount"`
	Currency string  `json:"currency"`
	KeyID    string  `json:"keyId"`
}

// razorpayPaymentTypeAliases maps the customer-app's "Interest"/
// "FullSettlement"/"Partial" type strings (no space, matching the plan's
// wire format) onto this package's PaymentType* constants
// (PaymentTypeFullSettlement is "Full Settlement", with a space).
func normalizeRazorpayPaymentType(t string) string {
	if t == "FullSettlement" {
		return PaymentTypeFullSettlement
	}
	return t
}

// CreateRazorpayOrder validates amount against loanID's current computed
// outstanding figures for the given paymentType (Interest/FullSettlement/
// Partial), then opens a Razorpay order for it. Ownership/eligibility
// (does this loan belong to the requesting customer) is checked at the
// handler, not here — this only validates the amount itself:
//   - Interest: amount must exactly match OutstandingInterest +
//     OutstandingPenalInterest.
//   - FullSettlement: amount must exactly match SettlementAmount.
//   - Partial (or anything else): amount must be > 0 and <=
//     TotalOutstandingBalance.
func (s *Service) CreateRazorpayOrder(loanID uint, amount float64, paymentType string) (*RazorpayOrderResult, error) {
	if s.razorpay == nil {
		return nil, ErrRazorpayNotConfigured
	}
	if amount <= 0 {
		return nil, ErrInvalidAmount
	}

	l, err := s.Get(loanID, nil)
	if err != nil {
		return nil, err
	}

	normalizedType := normalizeRazorpayPaymentType(paymentType)
	const epsilon = 0.01
	switch normalizedType {
	case PaymentTypeInterest:
		owed := l.OutstandingInterest + l.OutstandingPenalInterest
		if diff := amount - owed; diff > epsilon || diff < -epsilon {
			return nil, ErrRazorpayAmountMismatch
		}
	case PaymentTypeFullSettlement:
		if diff := amount - l.SettlementAmount; diff > epsilon || diff < -epsilon {
			return nil, ErrRazorpayAmountMismatch
		}
	default:
		if amount > l.TotalOutstandingBalance+epsilon {
			return nil, ErrRazorpayAmountMismatch
		}
	}

	amountPaise := int64(amount*100 + 0.5)
	order, err := s.razorpay.CreateOrder(amountPaise, l.LoanNumber)
	if err != nil {
		return nil, fmt.Errorf("create razorpay order: %w", err)
	}

	return &RazorpayOrderResult{
		OrderID:  order.ID,
		Amount:   amount,
		Currency: "INR",
		KeyID:    s.razorpay.KeyID,
	}, nil
}

// RazorpayVerifyInput mirrors the body of POST
// /customer/loans/:id/pay/verify.
type RazorpayVerifyInput struct {
	OrderID   string
	PaymentID string
	Signature string
	Amount    float64
	Type      string
}

// VerifyAndRecordRazorpayPayment verifies the Razorpay checkout signature
// and, only on success, records the payment against the loan's existing
// ledger via RecordPayment — the exact same fee->penal->interest->principal
// waterfall a staff-recorded cash payment goes through, with
// Method: "Online" and Reference: PaymentID distinguishing it. On a
// signature mismatch, no LoanPayment row is created.
func (s *Service) VerifyAndRecordRazorpayPayment(loanID uint, in RazorpayVerifyInput) (*Loan, error) {
	if s.razorpay == nil {
		return nil, ErrRazorpayNotConfigured
	}
	if !s.razorpay.VerifySignature(in.OrderID, in.PaymentID, in.Signature) {
		return nil, ErrRazorpaySignatureInvalid
	}

	return s.RecordPayment(loanID, PaymentInput{
		Amount:               in.Amount,
		Type:                 normalizeRazorpayPaymentType(in.Type),
		PaidOn:               time.Now(),
		ReceivedByEmployeeID: nil,
		Method:               "Online",
		Reference:            in.PaymentID,
		Description:          "Razorpay online payment",
	})
}
