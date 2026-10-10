package controllers

import (
	common "cloudhouse/backend/common/controllers"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"log"
	"math"
	"time"
)

func reverseDisbursement(ctx context.Context, l *models.Loan, disbursed, withheldCharge float64) {
	payments, err := findPaymentByLoanID(ctx, l.ID)
	if err != nil {
		log.Printf("reversing disbursement failed for loan %d: %v", l.ID, err)
		return
	}
	var orig *models.LoanPayment
	for i := range payments {
		if payments[i].Type == models.PaymentTypeDisbursement {
			orig = &payments[i]
			break
		}
	}
	if orig == nil {
		return
	}
	amount := common.RoundMoney(disbursed - withheldCharge)
	if amount <= 0.01 {
		return
	}
	cash, upi, bank, cheque := scaleSplit(orig.CashAmount, orig.UpiAmount, orig.BankTransferAmount, orig.ChequeAmount, orig.Amount, amount)
	now := time.Now()
	p := &models.LoanPayment{
		LoanID:             l.ID,
		Amount:             amount,
		Type:               "Disbursement Reversal",
		PaidOn:             now,
		Description:        "Disbursement reversed — loan edited, resubmitted for approval",
		Method:             common.DeriveMethod(cash, upi, bank, cheque),
		CashAmount:         cash,
		UpiAmount:          upi,
		BankTransferAmount: bank,
		ChequeAmount:       cheque,
		BankID:             orig.BankID,
		RunningBalance:     0,
	}
	if err := insertPayment(ctx, p); err != nil {
		log.Printf("disbursement reversal ledger row failed for loan %d: %v", l.ID, err)
		return
	}
	if _, groupID, err := cashbook.RecordLoanPaymentCashIn(ctx, l.ID, l.LoanNumber, amount, cash, upi, bank, cheque, l.BranchID, now, "Disbursement Reversal", l.CustomerID, orig.BankID); err != nil {
		log.Printf("cash-in movement (disbursement reversal) failed for loan %d: %v", l.ID, err)
	} else if groupID != "" {
		if err := setCashTransactionGroupID(ctx, p.ID, groupID); err != nil {
			log.Printf("linking disbursement reversal %d to cash movement group failed: %v", p.ID, err)
		}
	}
}

func undoDisbursementCash(ctx context.Context, loanNumber string) {
	if err := cashbook.DeleteLoanDisbursementCashMovements(ctx, loanNumber); err != nil {
		log.Printf("could not roll back disbursement cash for %s after a failed approval: %v", loanNumber, err)
	}
}

func bondDisbursements(ctx context.Context, l *models.Loan) []BondDisbursement {
	ups, err := findLoanTopUpActiveByLoanID(ctx, l.ID)
	if err != nil || len(ups) == 0 {
		return nil
	}
	initial := l.PrincipalAmount
	for _, t := range ups {
		initial -= t.Amount
	}
	out := []BondDisbursement{{Date: l.OpenedDate, Amount: math.Max(common.RoundMoney(initial), 0), Initial: true}}
	for i := len(ups) - 1; i >= 0; i-- {
		out = append(out, BondDisbursement{Date: ups[i].OccurredOn, Amount: ups[i].Amount})
	}
	return out
}
