package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	"cloudhouse/backend/modules/Loan/models"
	packet "cloudhouse/backend/modules/Packet/controllers"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strings"
	"time"

	"gorm.io/gorm/clause"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

const AuctionSurplusRefundedToCustomer = "RefundedToCustomer"

const AuctionDecisionKindPartialRepayment = "PartialRepayment"

const AuctionDecisionPending = "Pending"

var auctionNoticeChannels = []string{"WhatsApp"}

type auctionDecisionRequestBody struct {
	RequestID uint   `json:"request_id" binding:"required"`
	Decision  string `json:"decision" binding:"required"`
	Remarks   string `json:"remarks"`
}

type auctionNoticeRequest struct {
	Remarks string `json:"remarks"`
}

type auctionScheduleRequest struct {
	AuctionDate     string `json:"auction_date" binding:"required"`
	ReferenceNumber string `json:"reference_number"`
}

type auctionSaleRequest struct {
	SaleAmount         float64 `json:"sale_amount" binding:"required"`
	AuctionExpenses    float64 `json:"auction_expenses"`
	CashAmount         float64 `json:"cash_amount"`
	UpiAmount          float64 `json:"upi_amount"`
	BankTransferAmount float64 `json:"bank_transfer_amount"`
	BankID             *uint   `json:"bank_id"`
}

type auctionSettleRequest struct {
	Disposition      string `json:"disposition"`
	SettlementStatus string `json:"settlement_status"`
	Remarks          string `json:"remarks"`
	Mode             string `json:"mode"`
	BankID           *uint  `json:"bank_id"`
}

type ConcludedAuctionRow struct {
	models.AuctionRecord
	LoanNumber   string `json:"loan_number"`
	CustomerName string `json:"customer_name"`
}

type ScheduledAuctionCalendarRow struct {
	LoanID       uint
	LoanNumber   string
	BranchID     uint
	CustomerID   uint
	CustomerName string
	CustomerCode string
	AuctionDate  time.Time
}

type CustomerAuctionRow struct {
	models.AuctionRecord
	LoanNumber string `json:"loan_number"`
}

func IsActiveAuctionStage(stage string) bool {
	return stage != models.AuctionStageSettled && stage != models.AuctionStageWithdrawn
}

func IsPreSaleAuctionStage(stage string) bool {
	return stage == models.AuctionStageEligible || stage == models.AuctionStageNotice || stage == models.AuctionStageScheduled
}

func canDecideAuction(ctx context.Context, roleID uint, flow string) bool {
	c, err := loanChain(ctx, flow)
	if err != nil {
		return false
	}
	st, _ := c.First()
	return common.CanAct(ctx, roleID, flow, st.Key)
}

func isAuctionCase(l *models.Loan) bool {
	return l.Status == models.StatusAuctionEligible || l.Status == models.StatusAuctionedBalanceDue || l.IsDefaulted
}

func resolveAuctionAfterPayment(ctx context.Context, l *models.Loan, p *models.LoanPayment) bool {
	hadActiveAuction := false
	autoKeep, autoKept := false, false
	if c, err := loanChain(ctx, common.FlowAuctionPartialRepayment); err == nil && c.Off() {
		autoKeep = true
	}
	err := config.DB.
		WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		rec, err := findActiveByLoanIDForUpdate(ctx, tx, l.ID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		hadActiveAuction = true
		if !IsPreSaleAuctionStage(rec.Stage) {
			return nil
		}
		if l.Status == models.StatusClosed {
			rec.Stage = models.AuctionStageSettled
			rec.FinalSettlementStatus = "SettledByRepayment"
			if err := updateAuctionTx(ctx, tx, rec); err != nil {
				return err
			}
			recordAuctionEvent(ctx, tx, rec.ID, "SettledByRepaymentAuto", nil, "",
				fmt.Sprintf("Loan cleared in full by payment of ₹%.2f — auction cancelled automatically", p.Amount))
			notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Loan Settled", brandedMessage(ctx,
				"Dear %s, we have received your payment of ₹%.2f. Loan %s is now fully settled, the auction has been cancelled, and your pledged gold is safe. — CloudHouse Finance",
				l.Customer.Name, p.Amount, l.LoanNumber,
			), commonModels.TriggerPayment, "loan", l.ID)
			return nil
		}
		enrichLoan(
			ctx, l)
		outstanding := common.RoundMoney(l.TotalOutstandingBalance)
		if l.OutstandingInterest < moneyEpsilon && l.OutstandingPenalInterest < moneyEpsilon {
			rec.Stage = models.AuctionStageWithdrawn
			if err := updateAuctionTx(ctx, tx, rec); err != nil {
				return err
			}
			if pending, err := findPendingDecision(ctx, tx, rec.ID, AuctionDecisionKindPartialRepayment); err == nil && pending != nil {
				pending.Status = "RemovedFromAuction"
				pending.OutstandingAtRequest = outstanding
				if err := updateDecision(ctx, tx, pending); err != nil {
					return err
				}
			} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			l.Status = models.StatusActive
			if err := tx.Save(l).Error; err != nil {
				return err
			}
			recordAuctionEvent(ctx, tx, rec.ID, "DecisionRemove", nil, "", fmt.Sprintf(
				"Payment of ₹%.2f cleared all interest and penal interest — auction withdrawn automatically (₹%.2f principal still payable)", p.Amount, outstanding))
			notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Removed From Auction", brandedMessage(ctx,
				"Dear %s, we have received your payment of ₹%.2f. Loan %s is no longer overdue and has been removed from auction — your pledged gold is no longer at risk. A balance of ₹%.2f remains payable. — CloudHouse Finance",
				l.Customer.Name, p.Amount, l.LoanNumber, outstanding,
			), commonModels.TriggerPayment, "loan", l.ID)
			return nil
		}
		existing, err := findPendingDecision(ctx, tx, rec.ID, AuctionDecisionKindPartialRepayment)
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if existing == nil && autoKeep {
			now := time.Now()
			if err := createDecision(ctx, tx, &models.AuctionDecisionRequest{
				AuctionRecordID:      rec.ID,
				LoanID:               l.ID,
				Kind:                 AuctionDecisionKindPartialRepayment,
				TriggeredByPaymentID: &p.ID,
				AmountPaid:           common.RoundMoney(p.Amount),
				OutstandingAtRequest: outstanding,
				Status:               "KeepInAuction",
				DecidedByRole:        "System",
				DecisionRemarks:      "No approval configured — auction continues automatically",
				DecidedAt:            &now,
			}); err != nil {
				return err
			}
			autoKept = true
			recordAuctionEvent(ctx, tx, rec.ID, "DecisionKeep", nil, "", fmt.Sprintf(
				"Part-payment of ₹%.2f received (₹%.2f still owed) — kept in auction automatically (no decision stage configured)", p.Amount, outstanding))
			return nil
		}
		if existing != nil {
			existing.AmountPaid = common.RoundMoney(existing.AmountPaid + p.Amount)
			existing.OutstandingAtRequest = outstanding
			existing.TriggeredByPaymentID = &p.ID
			if err := updateDecision(ctx, tx, existing); err != nil {
				return err
			}
		} else if err := createDecision(ctx, tx, &models.AuctionDecisionRequest{
			AuctionRecordID:      rec.ID,
			LoanID:               l.ID,
			Kind:                 AuctionDecisionKindPartialRepayment,
			TriggeredByPaymentID: &p.ID,
			AmountPaid:           common.RoundMoney(p.Amount),
			OutstandingAtRequest: outstanding,
			Status:               AuctionDecisionPending,
		}); err != nil {
			return err
		}
		recordAuctionEvent(ctx, tx, rec.ID, "DecisionRequested", nil, "", fmt.Sprintf(
			"Part-payment of ₹%.2f received (₹%.2f still owed) — auction frozen pending a keep/remove decision", p.Amount, outstanding))
		return nil
	})
	if err != nil {
		// Logged rather than failing the payment: the money was genuinely received and must stay recorded.
		log.Printf("auction resolution after payment failed for loan %d: %v", l.ID, err)
		return hadActiveAuction
	}
	if hadActiveAuction && l.Status != models.StatusClosed && !autoKept {
		notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Payment Received — Auction On Hold", brandedMessage(ctx,
			"Dear %s, we have received your payment of ₹%.2f towards loan %s. As the loan is not yet fully settled, the auction of your pledged gold is on hold while our management reviews your account. We will inform you of the decision. — CloudHouse Finance",
			l.Customer.Name, p.Amount, l.LoanNumber,
		), commonModels.TriggerPayment, "loan", l.ID)
	}
	return hadActiveAuction
}

func loadAuctionRecord(ctx context.Context, loanID uint) (*models.AuctionRecord, error) {
	rec, err := findAuctionActiveByLoanID(ctx, loanID)
	if err != nil {
		return nil, ErrAuctionNotFound
	}
	return rec, nil
}

func recordAuctionEvent(ctx context.Context, tx *gorm.DB, recID uint, action string, actorID *uint, actorRole, remarks string) {
	if err := createAuctionEvent(ctx, tx, &models.AuctionEvent{
		AuctionRecordID: recID,
		Action:          action,
		ActorEmployeeID: actorID,
		ActorRole:       actorRole,
		Remarks:         remarks,
	}); err != nil {
		log.Printf("auction event (%s) failed for auction %d: %v", action, recID, err)
	}
}

func getAuctionHistory(ctx context.Context, loanID uint, branchID *uint) ([]models.AuctionRecord, error) {
	if err := checkLoanBranch(ctx, loanID, branchID); err != nil {
		return nil, err
	}
	return findAuctionHistoryByLoanID(ctx, loanID)
}

func listConcludedAuctions(ctx context.Context, branchID *uint, hasSale *bool, query string, limit, offset int) ([]ConcludedAuctionRow, int64, error) {
	return findAllConcluded(ctx, branchID, hasSale, query, limit, offset)
}

func listPendingAuctionDecisions(ctx context.Context, branchID *uint) ([]models.AuctionDecisionRequest, error) {
	return findPendingDecisions(ctx, branchID)
}

func getAuctionRecord(ctx context.Context, loanID uint, branchID *uint) (*models.AuctionRecord, error) {
	if err := checkLoanBranch(ctx, loanID, branchID); err != nil {
		return nil, err
	}
	return loadAuctionRecord(ctx, loanID)
}

func SaveAuctionEligibility(ctx context.Context, loanID uint, branchID *uint, actorID *uint, actorRole string, actorRoleID uint) (*models.AuctionRecord, error) {
	if !checkStagePermission(ctx, actorRoleID, "can mark loan auction eligible") {
		return nil, common.NewPermissionDenied("your role does not have permission to perform this auction step", "can mark loan auction eligible")
	}
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, common.NewNotFound("loan not found")
	}
	accrueAndSave(
		ctx, l)
	enrichLoan(ctx, l)
	if !l.IsDefaulted {
		return nil, common.NewBadRequest("loan must be Defaulted (overdue by more than 90 days) before it can be marked auction-eligible")
	}
	// Checks the ACTIVE case only — a concluded one must not block a new attempt.
	if _, err := findAuctionActiveByLoanID(ctx, loanID); err == nil {
		return nil, common.NewBadRequest("this loan already has an auction case in progress")
	}
	rec := &models.AuctionRecord{
		LoanID:                loanID,
		Stage:                 models.AuctionStageEligible,
		AuctionEligibleDate:   time.Now(),
		FinalSettlementStatus: "Pending",
	}
	if err := insertAuction(ctx, rec); err != nil {
		if isUniqueViolation(err) {
			return nil, common.NewBadRequest("this loan already has an auction case in progress")
		}
		return nil, err
	}
	l.Status = models.StatusAuctionEligible
	if err := persistLoan(ctx, l); err != nil {
		return nil, err
	}
	recordAuctionEvent(ctx, nil, rec.ID, "Eligible", actorID, actorRole, "Loan marked auction-eligible")
	notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Eligible", brandedMessage(ctx,
		"Dear %s, your gold loan %s is seriously overdue and has now been marked eligible for auction. Outstanding: ₹%.2f. Please contact the branch immediately to settle and retain your pledged items. — CloudHouse Finance",
		l.Customer.Name, l.LoanNumber, l.TotalOutstandingBalance,
	), commonModels.TriggerAuctionEvent, "auction_record", rec.ID)
	return loadAuctionRecord(ctx, loanID)
}

func SaveAuctionNotice(ctx context.Context, loanID uint, branchID *uint, remarks string, actorID *uint, actorRole string, actorRoleID uint) (*models.AuctionRecord, error) {
	if !checkStagePermission(ctx, actorRoleID, "can issue auction notice") {
		return nil, common.NewPermissionDenied("your role does not have permission to perform this auction step", "can issue auction notice")
	}
	if err := checkLoanBranch(ctx, loanID, branchID); err != nil {
		return nil, err
	}
	rec, err := loadAuctionRecord(ctx, loanID)
	if err != nil {
		return nil, err
	}
	if rec.Stage == models.AuctionStageAuctioned || rec.Stage == models.AuctionStageSettled {
		return nil, common.NewBadRequest("action does not match the auction case's current stage")
	}
	if err := requireNoPendingDecision(ctx, rec.ID); err != nil {
		return nil, err
	}
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	for _, method := range auctionNoticeChannels {
		if err := createNotice(ctx, &models.AuctionNotice{
			AuctionRecordID: rec.ID,
			IssuedAt:        time.Now(),
			Method:          method,
			Remarks:         remarks,
		}); err != nil {
			return nil, err
		}
		if method == "WhatsApp" {
			notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Notice", fmt.Sprintf(
				"Dear %s, your gold loan %s is overdue and has been marked for auction. Please contact the branch immediately to settle dues and avoid losing your pledged items.",
				l.Customer.Name, l.LoanNumber,
			), "auction_notice", "auction_record", rec.ID)
		}
	}
	if rec.Stage == models.AuctionStageEligible {
		rec.Stage = models.AuctionStageNotice
		if err := persistAuction(ctx, rec); err != nil {
			return nil, err
		}
	}
	recordAuctionEvent(ctx, nil, rec.ID, "NoticeIssued", actorID, actorRole, remarks)
	return loadAuctionRecord(ctx, loanID)
}

func SaveAuctionSchedule(ctx context.Context, loanID uint, branchID *uint, date time.Time, referenceNumber string, actorID *uint, actorRole string, actorRoleID uint) (*models.AuctionRecord, error) {
	if !checkStagePermission(ctx, actorRoleID, "can schedule auction") {
		return nil, common.NewPermissionDenied("your role does not have permission to perform this auction step", "can schedule auction")
	}
	if err := checkLoanBranch(ctx, loanID, branchID); err != nil {
		return nil, err
	}
	rec, err := loadAuctionRecord(ctx, loanID)
	if err != nil {
		return nil, err
	}
	if rec.Stage != models.AuctionStageNotice {
		return nil, common.NewBadRequest("action does not match the auction case's current stage")
	}
	// Never fix a sale date for gold whose repayment is still being reviewed.
	if err := requireNoPendingDecision(ctx, rec.ID); err != nil {
		return nil, err
	}
	rec.AuctionDate = &date
	rec.AuctionReferenceNumber = referenceNumber
	rec.Stage = models.AuctionStageScheduled
	if err := persistAuction(ctx, rec); err != nil {
		return nil, err
	}
	recordAuctionEvent(ctx, nil, rec.ID, "Scheduled", actorID, actorRole,
		fmt.Sprintf("Auction scheduled for %s (ref %s)", date.Format("02-Jan-2006"), referenceNumber))
	if l, err := findLoanByID(ctx, loanID); err == nil {
		notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Scheduled", brandedMessage(ctx,
			"Dear %s, the auction of the gold pledged against loan %s has been scheduled for %s (ref %s). You may still settle the outstanding dues before this date to reclaim your items. — CloudHouse Finance",
			l.Customer.Name, l.LoanNumber, date.Format("02-Jan-2006"), referenceNumber,
		), commonModels.TriggerAuctionEvent, "auction_record", rec.ID)
	}
	return loadAuctionRecord(ctx, loanID)
}

func SaveAuctionSale(ctx context.Context, loanID uint, branchID *uint, saleAmount, expenses float64, pay AuctionSalePayment, actorID *uint, actorRole string, actorRoleID uint) (*models.AuctionRecord, error) {
	if !checkStagePermission(ctx, actorRoleID, "can record auction sale") {
		return nil, common.NewPermissionDenied("your role does not have permission to perform this auction step", "can record auction sale")
	}
	if saleAmount <= 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	if expenses < 0 {
		return nil, common.NewBadRequest("amount must be greater than zero")
	}
	if expenses > saleAmount {
		return nil, common.NewBadRequest("auction expenses cannot be more than the sale amount")
	}
	rec, err := loadAuctionRecord(ctx, loanID)
	if err != nil {
		return nil, err
	}
	if rec.Stage != models.AuctionStageScheduled {
		return nil, common.NewBadRequest("action does not match the auction case's current stage")
	}
	// The decisive guard: gold must never be sold while a repayment decision is outstanding.
	if err := requireNoPendingDecision(ctx, rec.ID); err != nil {
		return nil, err
	}
	shortfallChain, err := loanChain(ctx, common.FlowAuctionShortfall)
	if err != nil {
		return nil, err
	}
	autoPursue := shortfallChain.Off()
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, common.NewNotFound("loan not found")
	}
	accrueAndSave(
		ctx, l)
	enrichLoan(ctx, l)
	saleAmount = common.RoundMoney(saleAmount)
	expenses = common.RoundMoney(expenses)
	payCash, payUpi, payBank, _, splitErr := common.NormalizeSplit(pay.CashAmount, pay.UpiAmount, pay.BankTransferAmount, 0, saleAmount, pay.BankID)
	if splitErr != nil {
		return nil, splitErr
	}
	pay = AuctionSalePayment{CashAmount: payCash, UpiAmount: payUpi, BankTransferAmount: payBank, BankID: pay.BankID}
	netProceeds := common.RoundMoney(saleAmount - expenses)
	totalDebt := common.RoundMoney(l.TotalOutstandingBalance)
	fullyCovered := netProceeds >= totalDebt-0.01
	applied := netProceeds
	if applied > totalDebt {
		applied = totalDebt
	}
	auctionDate := time.Now()
	var payment *models.LoanPayment
	var appFee, appPenal, appInterest, appPrincipal float64 // what the sale cleared on the loan
	txErr := config.DB.
		WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if applied > 0 {
			fee, penal, interest, principal, err := allocatePayment(l, models.PaymentTypeAuctionSale, applied, nil)
			if err != nil {
				return err
			}
			appFee, appPenal, appInterest, appPrincipal = fee, penal, interest, principal
			l.OutstandingProcessingFee = common.RoundMoney(math.Max(0, l.OutstandingProcessingFee-fee))
			l.PenalInterestPaid = common.RoundMoney(l.PenalInterestPaid + penal)
			l.InterestPaid = common.RoundMoney(l.InterestPaid + interest)
			l.OutstandingAmount = common.RoundMoney(math.Max(0, l.OutstandingAmount-principal))
			outstandingInterest := l.AccruedInterest - l.InterestPaid
			outstandingPenal := l.AccruedPenalInterest - l.PenalInterestPaid
			// the loan's share of the proceeds keeps the modes the buyer paid by, so the ledger shows the same mode
			appliedCash, appliedUpi, appliedBank := pay.proRata(applied, saleAmount)
			var appliedBankID *uint
			if appliedUpi+appliedBank > 0 {
				appliedBankID = pay.BankID
			}
			payment = &models.LoanPayment{
				LoanID:               loanID,
				Amount:               applied,
				Type:                 models.PaymentTypeAuctionSale,
				PaidOn:               auctionDate,
				ReceivedByEmployeeID: actorID,
				Method:               common.DeriveMethod(appliedCash, appliedUpi, appliedBank, 0),
				CashAmount:           appliedCash,
				UpiAmount:            appliedUpi,
				BankTransferAmount:   appliedBank,
				BankID:               appliedBankID,
				Reference:            rec.AuctionReferenceNumber,
				Description:          fmt.Sprintf("Auction proceeds applied (sale ₹%.2f less expenses ₹%.2f)", saleAmount, expenses),
				ProcessingFeeApplied: fee,
				PenalInterestApplied: penal,
				InterestApplied:      interest,
				PrincipalApplied:     principal,
				RunningBalance: common.RoundMoney(l.OutstandingAmount +
					math.Max(0, outstandingInterest) + math.Max(0, outstandingPenal) + l.OutstandingProcessingFee),
			}
			if err := tx.Create(payment).Error; err != nil {
				return err
			}
		}
		rec.SaleAmount = saleAmount
		rec.AuctionExpenses = expenses
		rec.SurplusShortfall = common.RoundMoney(netProceeds - totalDebt)
		rec.SurplusPayableAmount = common.RoundMoney(math.Max(0, netProceeds-totalDebt))
		if fullyCovered && rec.SurplusPayableAmount <= 0.01 {
			rec.FinalSettlementStatus = "SettledToLoanCo"
			rec.Stage = models.AuctionStageSettled
		} else {
			rec.Stage = models.AuctionStageAuctioned
		}
		if err := updateAuctionTx(ctx, tx, rec); err != nil {
			return err
		}
		l.AuctionDate = &auctionDate
		l.AuctionAmount = &saleAmount
		if fullyCovered {
			l.Status = models.StatusAuctioned
		} else {
			// Deliberately NOT Closed: real money is still owed.
			l.Status = models.StatusAuctionedBalanceDue
		}
		if err := tx.Save(l).Error; err != nil {
			return err
		}
		if !fullyCovered && autoPursue {
			shortfall := common.RoundMoney(totalDebt - netProceeds)
			rec.Stage = models.AuctionStageWithdrawn
			if err := updateAuctionTx(ctx, tx, rec); err != nil {
				return err
			}
			l.Status = models.StatusOverdue
			if err := tx.Save(l).Error; err != nil {
				return err
			}
			now := time.Now()
			if err := createDecision(ctx, tx, &models.AuctionDecisionRequest{
				AuctionRecordID:      rec.ID,
				LoanID:               loanID,
				Kind:                 "Shortfall",
				AmountPaid:           netProceeds,
				OutstandingAtRequest: shortfall,
				Status:               "PursueBalance",
				DecidedByRole:        "System",
				DecisionRemarks:      "No approval configured — balance pursued automatically",
				DecidedAt:            &now,
			}); err != nil {
				return err
			}
		} else if !fullyCovered {
			shortfall := common.RoundMoney(totalDebt - netProceeds)
			if err := createDecision(ctx, tx, &models.AuctionDecisionRequest{
				AuctionRecordID:      rec.ID,
				LoanID:               loanID,
				Kind:                 "Shortfall",
				AmountPaid:           netProceeds,
				OutstandingAtRequest: shortfall,
				Status:               AuctionDecisionPending,
			}); err != nil {
				return err
			}
		}
		// The sale lines and the expense-register entry are saved with the sale
		// itself: if either fails, the sale is not recorded, so the loan ledger and the cards never disagree.
		txCtx := cashbook.WithTx(ctx, tx)
		// The sale is written the way the loan was paid down: one repayment line per component it cleared
		// (service charge, penal interest, interest, principal), then what is left of the sale. The payment
		// row is linked to those lines, so the ledgers show them as an ordinary repayment.
		_, groupID, err := cashbook.RecordAuctionSaleCashIn(txCtx, loanID, l.LoanNumber, saleAmount, pay.CashAmount, pay.UpiAmount, pay.BankTransferAmount, pay.BankID, l.BranchID, auctionDate, appFee, appPenal, appInterest, appPrincipal, l.CustomerID)
		if err != nil {
			return fmt.Errorf("could not record the auction sale in Cash-in-Hand, sale not recorded: %w", err)
		}
		if payment != nil {
			if err := tx.Model(&models.LoanPayment{}).Where("id = ?", payment.ID).Update("cash_transaction_group_id", groupID).Error; err != nil {
				return err
			}
		}
		if expenses > 0.01 {
			expMode, expBank := pay.expenseMode()
			if _, err := cashbook.RecordAuctionExpense(txCtx, l.LoanNumber, expenses, expMode, expBank, l.BranchID, auctionDate); err != nil {
				return fmt.Errorf("could not record the auction expenses, sale not recorded: %w", err)
			}
		}
		return nil
	})
	if txErr != nil {
		return nil, txErr
	}
	if err := packet.RecordGoldReleaseMovement(ctx, loanID, fmt.Sprintf("Auction sale — sold for ₹%.2f", saleAmount)); err != nil {
		log.Printf("packet movement (auction sale) failed for loan %d: %v", loanID, err)
	}
	recordAuctionEvent(ctx, nil, rec.ID, "SaleRecorded", actorID, actorRole, fmt.Sprintf(
		"Sold for ₹%.2f, expenses ₹%.2f, net ₹%.2f applied against debt of ₹%.2f", saleAmount, expenses, netProceeds, totalDebt))
	if fullyCovered {
		surplusNote := ""
		if rec.SurplusPayableAmount > 0.01 {
			surplusNote = fmt.Sprintf(" A surplus of ₹%.2f is due back to you — the branch will contact you regarding this.", rec.SurplusPayableAmount)
		}
		notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Settled", brandedMessage(ctx,
			"Dear %s, the gold pledged against loan %s was auctioned on %s for ₹%.2f. Your loan is now fully settled and closed.%s — CloudHouse Finance",
			l.Customer.Name, l.LoanNumber, auctionDate.Format("02-Jan-2006"), saleAmount, surplusNote,
		), commonModels.TriggerAuctionEvent, "auction_record", rec.ID)
	} else if autoPursue {
		shortfall := common.RoundMoney(totalDebt - netProceeds)
		recordAuctionEvent(ctx, nil, rec.ID, "DecisionPursue", nil, "System", fmt.Sprintf(
			"Auction proceeds fell short by ₹%.2f — balance pursued automatically (no shortfall decision stage configured)", shortfall))
		notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Shortfall", brandedMessage(ctx,
			"Dear %s, the auction of your pledged gold under loan %s did not clear the full amount due. A balance of ₹%.2f remains payable and will continue to accrue interest. Please contact the branch to arrange settlement. — CloudHouse Finance",
			l.Customer.Name, l.LoanNumber, shortfall,
		), commonModels.TriggerAuctionEvent, "auction_record", rec.ID)
	} else {
		recordAuctionEvent(ctx, nil, rec.ID, "ShortfallEscalated", actorID, actorRole, fmt.Sprintf(
			"Auction proceeds fell short by ₹%.2f — escalated for a write-off/pursue decision", common.RoundMoney(totalDebt-netProceeds)))
		notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Shortfall", brandedMessage(ctx,
			"Dear %s, the gold pledged against loan %s was auctioned on %s for ₹%.2f, which did not cover the full amount due. A balance of ₹%.2f remains and is under review by our management. We will inform you of the outcome. — CloudHouse Finance",
			l.Customer.Name, l.LoanNumber, auctionDate.Format("02-Jan-2006"), saleAmount, common.RoundMoney(totalDebt-netProceeds),
		), commonModels.TriggerAuctionEvent, "auction_record", rec.ID)
	}
	return loadAuctionRecord(ctx, loanID)
}

func settleAuction(ctx context.Context, loanID uint, branchID *uint, disposition, remarks, mode string, bankID *uint, actorID *uint, actorRole string, actorRoleID uint) (*models.AuctionRecord, error) {
	if !checkStagePermission(ctx, actorRoleID, "can settle auction") {
		return nil, common.NewPermissionDenied("your role does not have permission to perform this auction step", "can settle auction")
	}
	switch disposition {
	case AuctionSurplusRefundedToCustomer, "RecordedAsIncome":
	default:
		return nil, common.NewBadRequest("surplus disposition must be either \"RefundedToCustomer\" or \"RecordedAsIncome\"")
	}
	if disposition == "RecordedAsIncome" && strings.TrimSpace(remarks) == "" {
		// Retaining a customer's surplus is the kind of decision that must carry a stated reason.
		return nil, common.NewBadRequest("remarks are required when a customer's auction surplus is retained as income")
	}
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, common.NewNotFound("loan not found")
	}
	rec, err := loadAuctionRecord(ctx, loanID)
	if err != nil {
		if hist, histErr := findAuctionHistoryByLoanID(ctx, loanID); histErr == nil {
			for _, h := range hist {
				if h.Stage == models.AuctionStageSettled {
					return nil, common.NewConflict("this auction case has already been settled")
				}
			}
		}
		return nil, err
	}
	if rec.Stage != models.AuctionStageAuctioned {
		return nil, common.NewBadRequest("action does not match the auction case's current stage")
	}
	if l.Status == models.StatusAuctionedBalanceDue {
		return nil, common.NewBadRequest("this auction left a balance owing — resolve the shortfall decision instead of settling")
	}
	if rec.SurplusPayableAmount <= 0.01 {
		return nil, common.NewBadRequest("this auction left no surplus to dispose of")
	}
	if rec.SurplusDisposition != "" || rec.SurplusPaidOutMovementID != nil {
		return nil, common.NewConflict("this auction's surplus has already been disposed of")
	}
	now := time.Now()
	// The refund's cash line and the settled auction record are saved together: a failed refund line
	// leaves the auction unsettled instead of settled with no money recorded.
	if err := config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if disposition == AuctionSurplusRefundedToCustomer {
			movementID, err := cashbook.RecordAuctionSurplusCashOut(cashbook.WithTx(ctx, tx), loanID, l.LoanNumber, rec.SurplusPayableAmount, l.BranchID, now, mode, bankID, l.CustomerID)
			if err != nil {
				return fmt.Errorf("could not record the surplus refund in Cash-in-Hand, settlement not saved: %w", err)
			}
			rec.SurplusPaidOutMovementID = &movementID
			rec.FinalSettlementStatus = "SettledToCustomer"
		} else {
			rec.FinalSettlementStatus = "SettledToLoanCo"
		}
		rec.SurplusDisposition = disposition
		rec.Stage = models.AuctionStageSettled
		return tx.Save(rec).Error
	}); err != nil {
		return nil, err
	}
	recordAuctionEvent(ctx, nil, rec.ID, "Settled", actorID, actorRole, fmt.Sprintf(
		"Surplus ₹%.2f — %s. %s", rec.SurplusPayableAmount, disposition, remarks))
	if disposition == AuctionSurplusRefundedToCustomer {
		notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Surplus Refund", brandedMessage(ctx,
			"Dear %s, the surplus of ₹%.2f from the auction of loan %s is being refunded to you. Please visit the branch to collect it. — CloudHouse Finance",
			l.Customer.Name, rec.SurplusPayableAmount, l.LoanNumber,
		), commonModels.TriggerAuctionEvent, "auction_record", rec.ID)
	} else {
		notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Settled", brandedMessage(ctx,
			"Dear %s, the auction settlement for loan %s is now complete and the loan is closed. — CloudHouse Finance",
			l.Customer.Name, l.LoanNumber,
		), commonModels.TriggerAuctionEvent, "auction_record", rec.ID)
	}
	return rec, nil
}

func resolveAuctionDecision(ctx context.Context, loanID, requestID uint, branchID *uint, decision, remarks string, actorID *uint, actorRole string, actorRoleID uint) (*models.AuctionRecord, error) {
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	if branchID != nil && l.BranchID != *branchID {
		return nil, common.NewNotFound("loan not found")
	}
	var (
		notifyMsg    string
		auctionRecID uint
	)
	txErr := config.DB.
		WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		req, err := findDecisionByID(ctx, tx, requestID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return common.NewNotFound("auction decision request not found")
			}
			return err
		}
		if req.LoanID != loanID {
			return common.NewNotFound("auction decision request not found")
		}
		if req.Status != AuctionDecisionPending {
			return common.NewConflict("this auction decision has already been made")
		}
		auctionRecID = req.AuctionRecordID
		rec, err := findActiveByLoanIDForUpdate(ctx, tx, loanID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrAuctionNotFound
			}
			return err
		}
		now := time.Now()
		req.Status = decision
		req.DecidedByEmployeeID = actorID
		req.DecidedByRole = actorRole
		req.DecisionRemarks = remarks
		req.DecidedAt = &now
		switch req.Kind {
		case AuctionDecisionKindPartialRepayment:
			if !canDecideAuction(ctx, actorRoleID, common.FlowAuctionPartialRepayment) {
				return common.NewForbidden("your role may not decide whether a part-paid loan stays in auction")
			}
			switch decision {
			case "KeepInAuction":
				recordAuctionEvent(
					ctx, tx, rec.ID, "DecisionKeep", actorID, actorRole, remarks)
				notifyMsg = brandedMessage(ctx,
					"Dear %s, following review of your recent payment, loan %s remains scheduled for auction as a balance of ₹%.2f is still outstanding. Please contact the branch urgently. — CloudHouse Finance",
					l.Customer.Name, l.LoanNumber, req.OutstandingAtRequest,
				)
			case "RemovedFromAuction":
				rec.Stage = models.AuctionStageWithdrawn
				if err := updateAuctionTx(ctx, tx, rec); err != nil {
					return err
				}
				l.Status = normalStatusFor(l, now)
				if err := tx.Save(l).Error; err != nil {
					return err
				}
				recordAuctionEvent(ctx, tx, rec.ID, "DecisionRemove", actorID, actorRole, remarks)
				notifyMsg = brandedMessage(ctx,
					"Dear %s, following your recent payment, loan %s has been removed from auction and your pledged gold is no longer at risk. A balance of ₹%.2f remains payable. — CloudHouse Finance",
					l.Customer.Name, l.LoanNumber, req.OutstandingAtRequest,
				)
			default:
				return common.NewBadRequest("decision is not valid for this kind of auction request")
			}
		case "Shortfall":
			if !canDecideAuction(ctx, actorRoleID, common.FlowAuctionShortfall) {
				return common.NewForbidden("only a Branch Manager, Management, or Administrator may decide a post-auction shortfall")
			}
			if strings.TrimSpace(remarks) == "" {
				return common.NewBadRequest("remarks are required for this decision")
			}
			switch decision {
			case "PursueBalance":
				rec.Stage = models.AuctionStageWithdrawn
				if err := updateAuctionTx(ctx, tx, rec); err != nil {
					return err
				}
				l.Status = models.StatusOverdue
				if err := tx.Save(l).Error; err != nil {
					return err
				}
				recordAuctionEvent(ctx, tx, rec.ID, "DecisionPursue", actorID, actorRole, remarks)
				notifyMsg = brandedMessage(ctx,
					"Dear %s, the auction of your pledged gold under loan %s did not clear the full amount due. A balance of ₹%.2f remains payable and will continue to accrue interest. Please contact the branch to arrange settlement. — CloudHouse Finance",
					l.Customer.Name, l.LoanNumber, req.OutstandingAtRequest,
				)
			case "WriteOff":
				enrichLoan(
					ctx, l)
				owed := common.RoundMoney(l.TotalOutstandingBalance)
				if owed > 0 {
					fee, penal, interest, principal, err := allocatePayment(l, models.PaymentTypeAuctionWriteOff, owed, nil)
					if err != nil {
						return err
					}
					l.OutstandingProcessingFee = common.RoundMoney(math.Max(0, l.OutstandingProcessingFee-fee))
					l.PenalInterestPaid = common.RoundMoney(l.PenalInterestPaid + penal)
					l.InterestPaid = common.RoundMoney(l.InterestPaid + interest)
					l.OutstandingAmount = common.RoundMoney(math.Max(0, l.OutstandingAmount-principal))
					if err := tx.Create(&models.LoanPayment{
						LoanID:               loanID,
						Amount:               owed,
						Type:                 models.PaymentTypeAuctionWriteOff,
						PaidOn:               now,
						ReceivedByEmployeeID: actorID,
						Method:               "Write-Off",
						Description:          "Post-auction shortfall written off by management: " + remarks,
						ProcessingFeeApplied: fee,
						PenalInterestApplied: penal,
						InterestApplied:      interest,
						PrincipalApplied:     principal,
						RunningBalance:       0,
					}).Error; err != nil {
						return err
					}
				}
				l.Status = models.StatusClosed
				if err := tx.Save(l).Error; err != nil {
					return err
				}
				rec.Stage = models.AuctionStageSettled
				rec.FinalSettlementStatus = "WrittenOff"
				if err := updateAuctionTx(ctx, tx, rec); err != nil {
					return err
				}
				recordAuctionEvent(ctx, tx, rec.ID, "DecisionWriteOff", actorID, actorRole,
					fmt.Sprintf("Shortfall of ₹%.2f written off: %s", owed, remarks))
				notifyMsg = brandedMessage(ctx,
					"Dear %s, the balance remaining on loan %s after auction has been waived and the loan is now closed. No further amount is payable. — CloudHouse Finance",
					l.Customer.Name, l.LoanNumber,
				)
			default:
				return common.NewBadRequest("decision is not valid for this kind of auction request")
			}
		default:
			return common.NewBadRequest("decision is not valid for this kind of auction request")
		}
		return updateDecision(ctx, tx, req)
	})
	if txErr != nil {
		return nil, txErr
	}
	if notifyMsg != "" {
		notifyCustomer(ctx, l.CustomerID, l.Customer.Phone, "Auction Decision", notifyMsg, commonModels.TriggerAuctionEvent, "auction_record", auctionRecID)
	}
	if rec, err := findAuctionActiveByLoanID(ctx, loanID); err == nil {
		return rec, nil
	}
	if recs, err := findAuctionHistoryByLoanID(ctx, loanID); err == nil {
		for i := range recs {
			if recs[i].ID == auctionRecID {
				return &recs[i], nil
			}
		}
	}
	return nil, ErrAuctionNotFound
}

func listAuctionHistoryForCustomer(ctx context.Context, customerID uint, from, to *time.Time, search string, limit, offset int) ([]CustomerAuctionRow, int64, error) {
	if _, err := common.FindCustomerByID(ctx, customerID); err != nil {
		return nil, 0, common.NewBadRequest("customer does not exist")
	}
	return findAuctionAllByCustomerID(ctx, customerID, from, to, search, limit, offset)
}

func applyAuctionCase(f *LoanFilter, auctionCase string) bool {
	switch strings.ToLower(strings.TrimSpace(auctionCase)) {
	case "":
	case "all":
		f.Status, f.DueToday = "", false
		f.AllAuctionCases = true
	case "eligible":
		f.Status, f.DueToday = models.StatusAuctionEligible, false
	case "auctioned_balance_due":
		f.Status, f.DueToday = models.StatusAuctionedBalanceDue, false
	case "defaulted":
		f.Status, f.DueToday = "", false
		f.OnlyDefaulted = true
	default:
		return false
	}
	return true
}

func preloadAuctionDetail(db *gorm.DB) *gorm.DB {
	return db.
		Preload("Notices", func(d *gorm.DB) *gorm.DB { return d.Order("issued_at asc") }).
		Preload("Events", func(d *gorm.DB) *gorm.DB { return d.Order("created_at asc, id asc") }).
		Preload("DecisionRequests", func(d *gorm.DB) *gorm.DB { return d.Order("created_at asc, id asc") })
}

func insertAuction(ctx context.Context, a *models.AuctionRecord) error {
	return config.DB.
		WithContext(ctx).Create(a).Error
}

func persistAuction(ctx context.Context, a *models.AuctionRecord) error {
	return config.DB.
		WithContext(ctx).Save(a).Error
}

func findAuctionActiveByLoanID(ctx context.Context, loanID uint) (*models.AuctionRecord, error) {
	var found []models.AuctionRecord
	if err := preloadAuctionDetail(config.DB.
		WithContext(ctx)).
		Where("loan_id = ? AND stage NOT IN (?, ?)", loanID, models.AuctionStageSettled, models.AuctionStageWithdrawn).
		Order("created_at desc, id desc").
		Limit(1).
		Find(&found).Error; err != nil {
		return nil, err
	}
	if len(found) == 0 {
		return nil, gorm.ErrRecordNotFound
	}
	return &found[0], nil
}

func findActiveByLoanIDForUpdate(ctx context.Context, tx *gorm.DB, loanID uint) (*models.AuctionRecord, error) {
	var a models.AuctionRecord
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("loan_id = ? AND stage NOT IN (?, ?)", loanID, models.AuctionStageSettled, models.AuctionStageWithdrawn).
		Order("created_at desc, id desc").
		First(&a).Error; err != nil {
		return nil, err
	}
	return &a, nil
}

func findAuctionHistoryByLoanID(ctx context.Context, loanID uint) ([]models.AuctionRecord, error) {
	var records []models.AuctionRecord
	err := preloadAuctionDetail(config.DB.
		WithContext(ctx)).
		Where("loan_id = ?", loanID).
		Order("created_at desc, id desc").
		Find(&records).Error
	return records, err
}

func findAllConcluded(ctx context.Context, branchID *uint, hasSale *bool, query string, limit, offset int) ([]ConcludedAuctionRow, int64, error) {
	var rows []ConcludedAuctionRow
	q := preloadAuctionDetail(config.DB.
		WithContext(ctx)).Model(&models.AuctionRecord{}).
		Select("auction_records.*, loans.loan_number AS loan_number, customers.name AS customer_name").
		Joins("JOIN loans ON loans.id = auction_records.loan_id").
		Joins("JOIN customers ON customers.id = loans.customer_id").
		Where("auction_records.stage IN (?, ?)", models.AuctionStageSettled, models.AuctionStageWithdrawn)
	if branchID != nil {
		q = q.Where("loans.branch_id = ?", *branchID)
	}
	if hasSale != nil {
		if *hasSale {
			q = q.Where("auction_records.sale_amount > 0")
		} else {
			q = q.Where("auction_records.sale_amount <= 0")
		}
	}
	if query != "" {
		like := "%" + query + "%"
		q = q.Where(
			"loans.loan_number ILIKE ? OR customers.name ILIKE ? OR customers.code ILIKE ? OR auction_records.auction_reference_number ILIKE ?",
			like, like, like, like,
		)
	}
	q = q.Order("auction_records.updated_at desc, auction_records.id desc")
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

func FindScheduledForCalendar(ctx context.Context) ([]ScheduledAuctionCalendarRow, error) {
	var rows []ScheduledAuctionCalendarRow
	err := config.DB.
		WithContext(ctx).Model(&models.AuctionRecord{}).
		Select("auction_records.loan_id AS loan_id, loans.loan_number AS loan_number, loans.branch_id AS branch_id, loans.customer_id AS customer_id, customers.name AS customer_name, customers.code AS customer_code, auction_records.auction_date AS auction_date").
		Joins("JOIN loans ON loans.id = auction_records.loan_id").
		Joins("JOIN customers ON customers.id = loans.customer_id").
		Where("auction_records.stage = ? AND auction_records.auction_date IS NOT NULL", models.AuctionStageScheduled).
		Find(&rows).Error
	return rows, err
}

func findAuctionAllByCustomerID(ctx context.Context, customerID uint, from, to *time.Time, search string, limit, offset int) ([]CustomerAuctionRow, int64, error) {
	var rows []CustomerAuctionRow
	q := config.DB.
		WithContext(ctx).Model(&models.AuctionRecord{}).
		Select("auction_records.*, loans.loan_number AS loan_number").
		Joins("JOIN loans ON loans.id = auction_records.loan_id").
		Where("loans.customer_id = ?", customerID)
	if search != "" {
		like := "%" + search + "%"
		q = q.Where("loans.loan_number ILIKE ? OR auction_records.auction_reference_number ILIKE ?", like, like)
	}
	if from != nil {
		q = q.Where("loans.opened_date >= ?", startOfDay(*from))
	}
	if to != nil {
		q = q.Where("loans.opened_date < ?", startOfDay(*to).AddDate(0, 0, 1))
	}
	q = q.Order("auction_records.id desc")
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

func createNotice(ctx context.Context, n *models.AuctionNotice) error {
	return config.DB.
		WithContext(ctx).Create(n).Error
}

func createAuctionEvent(ctx context.Context, tx *gorm.DB, e *models.AuctionEvent) error {
	return auctionDbOr(ctx, tx).Create(e).Error
}

func auctionDbOr(ctx context.Context, tx *gorm.DB) *gorm.DB {
	if tx != nil {
		return tx
	}
	return config.DB.
		WithContext(ctx)
}

func updateAuctionTx(ctx context.Context, tx *gorm.DB, a *models.AuctionRecord) error {
	return auctionDbOr(ctx, tx).Save(a).Error
}

func findPendingDecision(ctx context.Context, tx *gorm.DB, auctionRecordID uint, kind string) (*models.AuctionDecisionRequest, error) {
	var req models.AuctionDecisionRequest
	err := auctionDbOr(ctx, tx).
		Where("auction_record_id = ? AND kind = ? AND status = ?", auctionRecordID, kind, AuctionDecisionPending).
		First(&req).Error
	if err != nil {
		return nil, err
	}
	return &req, nil
}

func hasAnyPendingDecision(ctx context.Context, auctionRecordID uint) (bool, error) {
	var count int64
	err := config.DB.
		WithContext(ctx).Model(&models.AuctionDecisionRequest{}).
		Where("auction_record_id = ? AND status = ?", auctionRecordID, AuctionDecisionPending).
		Count(&count).Error
	return count > 0, err
}

func createDecision(ctx context.Context, tx *gorm.DB, req *models.AuctionDecisionRequest) error {
	return auctionDbOr(ctx, tx).Create(req).Error
}

func updateDecision(ctx context.Context, tx *gorm.DB, req *models.AuctionDecisionRequest) error {
	return auctionDbOr(ctx, tx).Save(req).Error
}

func findDecisionByID(ctx context.Context, tx *gorm.DB, id uint) (*models.AuctionDecisionRequest, error) {
	var req models.AuctionDecisionRequest
	if err := auctionDbOr(ctx, tx).First(&req, id).Error; err != nil {
		return nil, err
	}
	return &req, nil
}

func findPendingDecisions(ctx context.Context, branchID *uint) ([]models.AuctionDecisionRequest, error) {
	var reqs []models.AuctionDecisionRequest
	q := config.DB.
		WithContext(ctx).Model(&models.AuctionDecisionRequest{}).
		Where("auction_decision_requests.status = ?", AuctionDecisionPending)
	if branchID != nil {
		q = q.Joins("JOIN loans ON loans.id = auction_decision_requests.loan_id").
			Where("loans.branch_id = ?", *branchID)
	}
	err := q.Order("auction_decision_requests.created_at asc").Find(&reqs).Error
	return reqs, err
}

func ListAuctionHistoryForCustomer(c echo.Context) error {
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
	rec, total, err := listAuctionHistoryForCustomer(ctx, customerID, from, to, strings.TrimSpace(c.QueryParam("search")), limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessPage(c, page, limit, total, rec)
}

func GetLoanAuction(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := getAuctionRecord(ctx, loanID, auth.GetBranchScope(c))
	if err != nil {
		if c.QueryParam("optional") == "1" && errors.Is(err, ErrAuctionNotFound) {
			return common.Success(c, http.StatusOK, nil)
		}
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func MarkAuctionEligible(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	actorID, actorRole, actorRoleID := actorPtr(c)
	rec, err := SaveAuctionEligibility(ctx, loanID, auth.GetBranchScope(c), actorID, actorRole, actorRoleID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func GetAuctionHistory(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	recs, err := getAuctionHistory(ctx, loanID, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, recs)
}

func ListConcludedAuctions(c echo.Context) error {
	ctx := auth.RequestContext(c)
	query := strings.TrimSpace(c.QueryParam("search"))
	page, limit, offset := common.PageParams(c)
	var hasSale *bool
	if v := c.QueryParam("has_sale"); v == "true" || v == "false" {
		b := v == "true"
		hasSale = &b
	}
	if limit > 0 {
		rec, total, err := listConcludedAuctions(ctx, auth.GetBranchScope(c), hasSale, query, limit, offset)
		if err != nil {
			return common.FailErr(c, err)
		}
		return common.SuccessPage(c, page, limit, total, rec)
	}
	recs, _, err := listConcludedAuctions(ctx, auth.GetBranchScope(c), hasSale, query, 0, 0)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessAll(c, recs)
}

func ListPendingAuctionDecisions(c echo.Context) error {
	ctx := auth.RequestContext(c)
	reqs, err := listPendingAuctionDecisions(ctx, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, reqs)
}

func ResolveAuctionDecision(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req auctionDecisionRequestBody
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	actorID, actorRole, actorRoleID := actorPtr(c)
	rec, err := resolveAuctionDecision(ctx, loanID, req.RequestID, auth.GetBranchScope(c), req.Decision, req.Remarks, actorID, actorRole, actorRoleID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func IssueAuctionNotice(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req auctionNoticeRequest
	if err := common.BindJSON(c, &req); err != nil && err != io.EOF {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	actorID, actorRole, actorRoleID := actorPtr(c)
	rec, err := SaveAuctionNotice(ctx, loanID, auth.GetBranchScope(c), req.Remarks, actorID, actorRole, actorRoleID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ScheduleAuction(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req auctionScheduleRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	auctionDate, err := parseDate(req.AuctionDate)
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid auction_date: expected YYYY-MM-DD"})
	}
	actorID, actorRole, actorRoleID := actorPtr(c)
	rec, err := SaveAuctionSchedule(ctx, loanID, auth.GetBranchScope(c), auctionDate, req.ReferenceNumber, actorID, actorRole, actorRoleID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func RecordAuctionSale(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req auctionSaleRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	actorID, actorRole, actorRoleID := actorPtr(c)
	rec, err := SaveAuctionSale(ctx, loanID, auth.GetBranchScope(c), req.SaleAmount, req.AuctionExpenses, AuctionSalePayment{CashAmount: req.CashAmount, UpiAmount: req.UpiAmount, BankTransferAmount: req.BankTransferAmount, BankID: req.BankID}, actorID, actorRole, actorRoleID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func SettleAuction(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req auctionSettleRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	disposition := req.Disposition
	if disposition == "" {
		disposition = req.SettlementStatus
	}
	actorID, actorRole, actorRoleID := actorPtr(c)
	rec, err := settleAuction(ctx, loanID, auth.GetBranchScope(c), disposition, req.Remarks, req.Mode, req.BankID, actorID, actorRole, actorRoleID)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

// AuctionSalePayment is how the buyer's money was received: the payment breakdown for the full sale amount,
// with the bank it reached for the UPI / Bank Transfer parts. With nothing sent it is all Cash.
type AuctionSalePayment struct {
	CashAmount         float64
	UpiAmount          float64
	BankTransferAmount float64
	BankID             *uint
}

// expenseMode picks the mode an auction's expenses are booked in: the one most of the sale was received by.
func (p AuctionSalePayment) expenseMode() (string, *uint) {
	switch {
	case p.CashAmount >= p.UpiAmount && p.CashAmount >= p.BankTransferAmount:
		return "Cash", nil
	case p.UpiAmount >= p.BankTransferAmount:
		return "UPI", p.BankID
	default:
		return "Bank Transfer", p.BankID
	}
}

// proRata splits an amount over the modes of the sale in proportion, the last non-zero mode taking the
// rounding remainder, so the loan's share of the proceeds keeps the sale's modes.
func (p AuctionSalePayment) proRata(part, whole float64) (cash, upi, bank float64) {
	if whole <= 0 {
		return 0, 0, 0
	}
	cash = common.RoundMoney(p.CashAmount * part / whole)
	upi = common.RoundMoney(p.UpiAmount * part / whole)
	bank = common.RoundMoney(p.BankTransferAmount * part / whole)
	diff := common.RoundMoney(part - cash - upi - bank)
	switch {
	case p.BankTransferAmount > 0:
		bank = common.RoundMoney(bank + diff)
	case p.UpiAmount > 0:
		upi = common.RoundMoney(upi + diff)
	default:
		cash = common.RoundMoney(cash + diff)
	}
	return cash, upi, bank
}
