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
	"fmt"
	"log"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrAuctionNotFound = common.NewNotFound("this loan has no auction case yet — mark it auction-eligible first")
)

const (
	RiskSafe   RiskLevel = "Safe"
	RiskAtRisk RiskLevel = "AtRisk"
)

var openServicingStatuses = []string{models.StatusActive, models.StatusDueSoon, models.StatusOverdue}

var notDefaultableStatuses = []string{models.StatusClosed, models.StatusRejected, models.StatusAuctioned}

type PacketCreator interface {
	CreatePacketForLoan(ctx context.Context, loanID uint, lockerID *uint) error
}

type CustomerNotifier interface {
	Notify(ctx context.Context, customerID uint, notifType, title, body, relatedEntityType string, relatedEntityID uint)
}

type PacketMover interface {
	RecordBankPledgeMovement(ctx context.Context, loanID uint, remarks string) error
	RecordBankReleaseMovement(ctx context.Context, loanID uint, remarks string) error
	RecordGoldReleaseMovement(ctx context.Context, loanID uint, remarks string) error
	RecordPartialGoldReleaseMovement(ctx context.Context, loanID uint, releasedGrossWeight, releasedNetWeight float64, remarks string) error
}

type CashRecorder interface {
	RecordBankPledgeCashIn(ctx context.Context, loanID uint, loanNumber, bankName string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, bankID *uint, occurredOn time.Time) (movementID uint, err error)
	RecordBankPledgeCashOut(ctx context.Context, loanID uint, loanNumber, bankName string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, bankID *uint, occurredOn time.Time, branchID uint) (movementID uint, err error)
	RecordBankPledgeReleaseExpense(ctx context.Context, loanID uint, bankName string, amount float64, occurredOn time.Time, branchID uint) (expenseID uint, err error)
	HeadOfficeBranchID(ctx context.Context) (uint, error)
	DeleteCashMovement(ctx context.Context, id uint) error
	RecordLoanDisbursementCashOut(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, customerID uint, bankID *uint) (movementID uint, groupID string, err error)
	RecordLoanPaymentCashIn(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, paymentType string, customerID uint, bankID *uint) (movementID uint, groupID string, err error)
	RecordLoanTopUpCashOut(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, customerID uint) (movementID uint, groupID string, err error)
	RecordServiceChargeCashIn(ctx context.Context, loanID uint, loanNumber string, amount, cashAmount, upiAmount, bankTransferAmount, chequeAmount float64, branchID uint, occurredOn time.Time, bankID *uint) (movementID uint, err error)
	RecordAuctionSaleCashIn(ctx context.Context, loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (movementID uint, err error)
	RecordAuctionSurplusCashOut(ctx context.Context, loanID uint, loanNumber string, amount float64, branchID uint, occurredOn time.Time) (movementID uint, err error)
	DeleteLoanDisbursementCashMovements(ctx context.Context, loanNumber string) error
	DeleteAllLoanCashEntries(ctx context.Context, loanNumber string, movementIDs, expenseIDs []uint) error
}

type CashBalanceGuard interface {
	EnsureCashInHand(ctx context.Context, branchID uint, amount float64) error
}

type CreateInput struct {
	BranchID          uint
	CustomerID        uint
	SchemeID          uint
	OpenedDate        time.Time
	DueDate           time.Time
	PrincipalAmount   float64
	Ornaments         []OrnamentInput
	LockerID          *uint
	AdditionalInfo    string
	ServiceChargeMode string
}

type UpdateLoanInput struct {
	SchemeID        *uint
	PrincipalAmount *float64
	ActorEmployeeID uint
	ActorRole       string
}

type PurityTestInput struct {
	TestedPurity          string
	TestedGrossWeight     float64
	TestedDeductionWeight float64
	TestingRemarks        string
	TestedBy              string
	TestedAt              time.Time
}

type ChecklistInput struct {
	CustomerSawGold    *bool
	PaymentVerified    *bool
	PacketVerified     *bool
	BankPledgeVerified *bool
	CustomerConfirmed  *bool
	VerificationNotes  *string
	Charges            *float64
	ActorRoleID        uint
}

type Customer360 struct {
	Customer         commonModels.CustomerResponse `json:"customer"`
	Loans            []models.Loan                 `json:"loans"`
	AuctionHistory   []models.AuctionRecord        `json:"auction_history"`
	TotalDisbursed   float64                       `json:"total_disbursed"`
	TotalOutstanding float64                       `json:"total_outstanding"`
	TotalPaid        float64                       `json:"total_paid"`
	ActiveLoanCount  int                           `json:"active_loan_count"`
	ClosedLoanCount  int                           `json:"closed_loan_count"`
}

type LoanFilter struct {
	Status             string
	StatusIn           []string
	BranchID           uint
	CustomerID         uint
	BranchIDs          []uint
	CustomerIDs        []uint
	ServicingIn        []string
	SchemeID           uint
	LoanIDs            []uint
	Query              string
	BranchScope        *uint
	OpenedFrom         *time.Time
	OpenedTo           *time.Time
	ExcludeBankPledged bool
	BankPledgeStatus   string
	DueToday           bool
	OnlyDefaulted      bool
	Servicing          string
	AllAuctionCases    bool
	Limit              int
	Offset             int
}

func parseDate(s string) (time.Time, error) {
	if t, err := time.Parse("2006-01-02", s); err == nil {
		return t, nil
	}
	return time.Parse(time.RFC3339, s)
}

func parsePaidOn(s string) (time.Time, error) {
	t, err := parseDate(s)
	if err != nil || len(s) != len("2006-01-02") {
		return t, err
	}
	now := time.Now()
	if s == now.Format("2006-01-02") {
		return now, nil
	}
	return t, nil
}

func applyStatusParam(f *LoanFilter, status string) {
	status = strings.TrimSpace(status)
	if strings.EqualFold(status, "Due Today") {
		f.DueToday = true
		f.Status = ""
		return
	}
	f.Status = status
}

func computeServiceChargeAmount(chargeType string, chargeValue, principalAmount float64) float64 {
	switch chargeType {
	case commonModels.ServiceChargeTypeFlat:
		return chargeValue
	case commonModels.ServiceChargeTypePercent:
		return principalAmount * chargeValue / 100
	default:
		return 0
	}
}

func customerInScope(c echo.Context, ctx context.Context, customerID uint) bool {
	ok, err := customerInBranchScope(ctx, customerID, auth.GetBranchScope(c))
	if err != nil {
		common.FailErr(c, err)
		return false
	}
	if !ok {
		c.JSON(http.StatusNotFound, echo.Map{"success": false, "error": "customer not found"})
		return false
	}
	return true
}

func parseOpenedRange(c echo.Context) (from, to *time.Time, ok bool) {
	if v := c.QueryParam("from"); v != "" {
		parsed, err := parseDate(v)
		if err != nil {
			c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid from: expected YYYY-MM-DD"})
			return nil, nil, false
		}
		from = &parsed
	}
	if v := c.QueryParam("to"); v != "" {
		parsed, err := parseDate(v)
		if err != nil {
			c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid to: expected YYYY-MM-DD"})
			return nil, nil, false
		}
		to = &parsed
	}
	if from != nil && to != nil && to.Before(*from) {
		c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid range: to is before from"})
		return nil, nil, false
	}
	return from, to, true
}

func actorPtr(c echo.Context) (*uint, string, uint) {
	id, role, roleID := auth.ActorFromContext(c)
	if id == 0 {
		return nil, role, roleID
	}
	return &id, role, roleID
}

func loanChain(ctx context.Context, flow string) (*common.Chain, error) {
	return common.WorkflowChain(ctx, flow)
}

func ensureCashInHand(ctx context.Context, branchID uint, amount float64) error {
	if config.IsDemoRun(ctx) {
		return nil
	}
	return cashbook.EnsureCashInHand(ctx, branchID, amount)
}

func checkStagePermission(ctx context.Context, roleID uint, permissionName string) bool {
	allowed, err := common.IsAllowed(ctx, roleID, permissionName)
	if err != nil {
		return false
	}
	return allowed
}

func notifyCustomer(ctx context.Context, customerID uint, phone, title, message, triggerType, relatedEntityType string, relatedEntityID uint) {
	if config.WhatsApp != nil && !config.IsDemoRun(ctx) {
		tenantID, _ := config.TenantFromContext(ctx)
		go func() {
			// A panic in a detached goroutine takes the whole process with it; a failed courtesy message must never do that.
			defer func() {
				if r := recover(); r != nil {
					log.Printf("whatsapp notification panicked (phone %s): %v", phone, r)
				}
			}()
			sendErr := config.WhatsApp.
				Send(phone, message)
			if sendErr != nil {
				log.Printf("whatsapp notification failed (phone %s): %v", phone, sendErr)
			}
			if !config.IsDemoRun(ctx) {
				rec := &commonModels.CommunicationLog{
					RecipientPhone:    phone,
					ChatID:            common.NormalizeChatID(phone),
					Channel:           commonModels.ChannelWhatsApp,
					TriggerType:       triggerType,
					MessageBody:       message,
					RelatedEntityType: relatedEntityType,
					RelatedEntityID:   relatedEntityID,
					Status:            commonModels.StatusSent,
				}
				if sendErr != nil {
					rec.Status = commonModels.StatusFailed
					rec.ErrorMessage = sendErr.Error()
				}
				if err := common.CreateBackground(tenantID, rec); err != nil {
					log.Printf("communication log write failed (phone %s): %v", phone, err)
				}
			}
		}()
	}
	if !config.IsDemoRun(ctx) {
		common.NotifyCustomer(ctx, customerID, triggerType, title, message, relatedEntityType, relatedEntityID)
	}
}

func recalculateTotals(l *models.Loan, ornaments []models.Ornament) {
	var totalNet, totalValue float64
	for _, o := range ornaments {
		totalNet += o.NetWeight
		totalValue += o.GoldValue
	}
	l.TotalNetWeight = totalNet
	l.TotalGoldValue = totalValue
	l.EligibleLoanAmount = totalValue * (l.SchemeLTVPercent / 100)
}

func SaveLoan(ctx context.Context, in CreateInput) (*models.Loan, error) {
	if len(in.Ornaments) == 0 {
		return nil, common.NewBadRequest("at least one ornament is required")
	}
	if in.PrincipalAmount <= 0 {
		return nil, common.NewBadRequest("principal amount must be greater than zero")
	}
	if !in.DueDate.After(in.OpenedDate) {
		return nil, common.NewBadRequest("due date must be after the opened date")
	}
	if in.OpenedDate.Format("2006-01-02") > time.Now().Format("2006-01-02") {
		return nil, common.NewBadRequest("loan date cannot be in the future")
	}
	branchOK, err := common.BranchExists(ctx, in.BranchID)
	if err != nil {
		return nil, err
	}
	if !branchOK {
		return nil, common.NewBadRequest("branch does not exist")
	}
	if _, err := common.FindCustomerByID(ctx, in.CustomerID); err != nil {
		return nil, common.NewBadRequest("customer does not exist")
	}
	sch, err := common.FindSchemeByID(ctx, in.SchemeID)
	if err != nil {
		return nil, common.NewBadRequest("scheme does not exist")
	}
	rate, err := common.FindLatest(ctx)
	if err != nil {
		return nil, common.NewBadRequest("no gold rate has been published yet")
	}
	now := time.Now()
	if rate.Date.Year() != now.Year() || rate.Date.YearDay() != now.YearDay() {
		return nil, common.NewBadRequest("today's gold rate has not been set yet — please publish it before creating a loan")
	}
	ornaments := make([]models.Ornament, 0, len(in.Ornaments))
	for _, oi := range in.Ornaments {
		o := models.Ornament{
			Name:            oi.Name,
			Purity:          oi.Purity,
			GrossWeight:     oi.GrossWeight,
			DeductionWeight: oi.DeductionWeight,
			Quantity:        oi.Quantity,
			Remarks:         oi.Remarks,
		}
		if o.Quantity <= 0 {
			o.Quantity = 1
		}
		if err := valueOrnament(&o, rate); err != nil {
			return nil, err
		}
		ornaments = append(ornaments, o)
	}
	firstStage, err := firstSanctionStage(ctx)
	if err != nil {
		return nil, err
	}
	rec := &models.Loan{
		BranchID:         in.BranchID,
		CustomerID:       in.CustomerID,
		SchemeID:         in.SchemeID,
		OpenedDate:       in.OpenedDate,
		DueDate:          in.DueDate,
		AdditionalInfo:   in.AdditionalInfo,
		Status:           models.StatusPendingApproval,
		ApprovalStage:    firstStage,
		BankPledgeStatus: "Not Pledged",
		LastAccrualDate:  in.OpenedDate,
	}
	applySchemeSnapshot(rec, sch)
	switch in.ServiceChargeMode {
	case "":
	case commonModels.ServiceChargeModeWithheldFromPayout, commonModels.ServiceChargeModeAddedToPrincipal:
		rec.ServiceChargeMode = in.ServiceChargeMode
	default:
		return nil, common.NewBadRequest("invalid service_charge_mode")
	}
	if rec.ServiceChargeMode == "" {
		rec.ServiceChargeMode = commonModels.ServiceChargeModeWithheldFromPayout
	}
	recalculateTotals(rec, ornaments)
	rec.ServiceChargeAmount = computeServiceChargeAmount(rec.ServiceChargeType, rec.ServiceChargeValue, in.PrincipalAmount)
	finalPrincipal := in.PrincipalAmount
	if rec.ServiceChargeMode == commonModels.ServiceChargeModeAddedToPrincipal && rec.ServiceChargeAmount > 0 {
		finalPrincipal = common.RoundMoney(in.PrincipalAmount + rec.ServiceChargeAmount)
	}
	if common.RoundMoney(in.PrincipalAmount) > common.RoundMoney(rec.EligibleLoanAmount) {
		return nil, common.NewBadRequest("principal amount cannot exceed the eligible loan amount")
	}
	rec.EligibleLoanAmount = common.RoundMoney(rec.EligibleLoanAmount)
	rec.PrincipalAmount = finalPrincipal
	rec.OutstandingAmount = rec.PrincipalAmount
	maxSuffix, err := maxLoanNumberSuffix(ctx)
	if err != nil {
		return nil, err
	}
	rec.LoanNumber = fmt.Sprintf("LN-%05d", maxSuffix+1)
	if err := insertLoan(ctx, rec); err != nil {
		return nil, err
	}
	for i := range ornaments {
		ornaments[i].LoanID = rec.ID
		if err := insertOrnament(ctx, &ornaments[i]); err != nil {
			return nil, err
		}
	}
	created, err := findLoanByID(ctx, rec.ID)
	if err != nil {
		return nil, err
	}
	if err := packet.CreatePacketForLoan(ctx, created.ID, in.LockerID); err != nil {
		log.Printf("packet auto-creation failed for loan %d: %v", created.ID, err)
	}
	enrichLoan(ctx, created)
	notifyCustomer(ctx, created.CustomerID, created.Customer.Phone, "Loan Application Submitted", brandedMessage(ctx,
		"Dear %s, your gold loan application %s for ₹%.2f has been submitted and is pending approval. We'll notify you once it's sanctioned. — CloudHouse Finance",
		created.Customer.Name, created.LoanNumber, created.PrincipalAmount,
	), "loan_submission", "loan", created.ID)
	return created, nil
}

func listLoans(ctx context.Context, f LoanFilter) ([]models.Loan, int64, error) {
	limit, offset := f.Limit, f.Offset
	if f.OnlyDefaulted || f.AllAuctionCases || f.Servicing != "" || len(f.ServicingIn) > 0 {
		f.Limit, f.Offset = 0, 0
	}
	loans, total, err := FindLoans(ctx, f)
	if err != nil {
		return nil, 0, err
	}
	now := time.Now()
	for i := range loans {
		l := &loans[i]
		interestDelta, penalDelta, _ := projectAccrual(l, now, nil)
		l.AccruedInterest = common.RoundMoney(l.AccruedInterest + interestDelta)
		l.AccruedPenalInterest = common.RoundMoney(l.AccruedPenalInterest + penalDelta)
		enrichLoan(ctx, l)
	}
	if f.OnlyDefaulted {
		loans, total = pageKept(loans, limit, offset, func(l *models.Loan) bool { return l.IsDefaulted })
	} else if f.AllAuctionCases {
		loans, total = pageKept(loans, limit, offset, isAuctionCase)
	} else if len(f.ServicingIn) > 0 {
		servicingIn, statusIn := f.ServicingIn, f.StatusIn
		loans, total = pageKept(loans, limit, offset, func(l *models.Loan) bool {
			for _, st := range statusIn {
				if l.Status == st {
					return true
				}
			}
			for _, sv := range servicingIn {
				if matchesServicing(l, sv) {
					return true
				}
			}
			return false
		})
	} else if f.Servicing != "" {
		servicing := f.Servicing
		loans, total = pageKept(loans, limit, offset, func(l *models.Loan) bool { return matchesServicing(l, servicing) })
	}
	return loans, total, nil
}

func pageKept(loans []models.Loan, limit, offset int, keep func(*models.Loan) bool) ([]models.Loan, int64) {
	kept := loans[:0]
	for i := range loans {
		l := loans[i]
		if keep(&l) {
			kept = append(kept, l)
		}
	}
	total := int64(len(kept))
	if limit <= 0 {
		return kept, total
	}
	if offset < 0 {
		offset = 0
	}
	if offset > len(kept) {
		offset = len(kept)
	}
	end := offset + limit
	if end > len(kept) {
		end = len(kept)
	}
	return kept[offset:end], total
}

func countList(ctx context.Context, f LoanFilter) (int64, error) {
	return countFiltered(ctx, f)
}

func GetLoan(ctx context.Context, id uint, branchID *uint) (*models.Loan, error) {
	rec, err := findLoanByID(ctx, id)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	if branchID != nil && rec.BranchID != *branchID {
		return nil, common.NewNotFound("loan not found")
	}
	return accrueAndEnrich(ctx, rec)
}

func checkLoanBranch(ctx context.Context, loanID uint, branchID *uint) error {
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return common.NewNotFound("loan not found")
	}
	if branchID != nil && l.BranchID != *branchID {
		return common.NewNotFound("loan not found")
	}
	return nil
}

func getByLoanNumber(ctx context.Context, loanNumber string) (*models.Loan, error) {
	rec, err := findByLoanNumber(ctx, loanNumber)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	return accrueAndEnrich(ctx, rec)
}

func accrueAndEnrich(ctx context.Context, rec *models.Loan) (*models.Loan, error) {
	if accrueAndSave(ctx, rec) {
		saved, err := findLoanByID(ctx, rec.ID)
		if err != nil {
			return nil, err
		}
		rec = saved
	}
	enrichLoan(ctx, rec)
	return rec, nil
}

func updateLoan(ctx context.Context, loanID uint, in UpdateLoanInput) (*models.Loan, error) {
	l, err := findLoanByID(ctx, loanID)
	if err != nil {
		return nil, common.NewNotFound("loan not found")
	}
	switch l.Status {
	case models.StatusClosed, models.StatusRejected, models.StatusAuctioned, models.StatusAuctionedBalanceDue:
		return nil, common.NewBadRequest("loan is already Closed, Auctioned, or Defaulted — nothing left to extend")
	}
	materialChange := (in.SchemeID != nil && *in.SchemeID != l.SchemeID) ||
		(in.PrincipalAmount != nil && common.RoundMoney(*in.PrincipalAmount) != common.RoundMoney(l.PrincipalAmount))
	wasDisbursed := l.DisbursementDate != nil
	priorDisbursed := l.DisbursedAmount
	priorCharge := 0.0
	if l.ServiceChargeMode == commonModels.ServiceChargeModeWithheldFromPayout {
		priorCharge = l.ServiceChargeAmount
	}
	if in.SchemeID != nil {
		sch, err := common.FindSchemeByID(ctx, *in.SchemeID)
		if err != nil {
			return nil, common.NewBadRequest("scheme does not exist")
		}
		l.SchemeID = *in.SchemeID
		applySchemeSnapshot(l, sch)
	}
	if in.PrincipalAmount != nil {
		if *in.PrincipalAmount <= 0 {
			return nil, common.NewBadRequest("principal amount must be greater than zero")
		}
		delta := *in.PrincipalAmount - l.PrincipalAmount
		l.PrincipalAmount = *in.PrincipalAmount
		l.OutstandingAmount = common.RoundMoney(l.OutstandingAmount + delta)
		if l.OutstandingAmount < 0 {
			l.OutstandingAmount = 0
		}
	}
	ornaments, err := FindByLoanID(ctx, l.ID)
	if err != nil {
		return nil, err
	}
	recalculateTotals(l, ornaments)
	capped := l.PrincipalAmount
	if l.ServiceChargeMode == commonModels.ServiceChargeModeAddedToPrincipal && l.ServiceChargeValue > 0 {
		switch l.ServiceChargeType {
		case commonModels.ServiceChargeTypeFlat:
			capped = l.PrincipalAmount - l.ServiceChargeValue
		case commonModels.ServiceChargeTypePercent:
			capped = l.PrincipalAmount / (1 + l.ServiceChargeValue/100)
		}
	}
	if common.RoundMoney(capped) > common.RoundMoney(l.EligibleLoanAmount) {
		return nil, common.NewBadRequest(fmt.Sprintf("principal amount ₹%.2f cannot exceed the eligible loan amount ₹%.2f (based on scheme LTV)", capped, l.EligibleLoanAmount))
	}
	if in.SchemeID != nil || in.PrincipalAmount != nil {
		l.ServiceChargeAmount = computeServiceChargeAmount(l.ServiceChargeType, l.ServiceChargeValue, l.PrincipalAmount)
	}
	firstStage := "LoanOperator"
	if materialChange {
		if firstStage, err = firstSanctionStage(ctx); err != nil {
			return nil, err
		}
		l.ApprovalStage = firstStage
		l.Status = models.StatusPendingApproval
		if wasDisbursed {
			l.SanctionedAmount = 0
			l.DisbursedAmount = 0
			l.DisbursementDate = nil
		}
	}
	if err := persistLoan(ctx, l); err != nil {
		return nil, err
	}
	if materialChange && wasDisbursed {
		reverseDisbursement(ctx, l, priorDisbursed, priorCharge)
	}
	if materialChange {
		audit := &models.LoanApproval{
			LoanID:          l.ID,
			Stage:           firstStage,
			Action:          "Edited",
			ActorEmployeeID: in.ActorEmployeeID,
			ActorRole:       in.ActorRole,
			Remarks:         "Loan edited (scheme/principal changed) — resubmitted for approval",
		}
		if err := insertApproval(ctx, audit); err != nil {
			log.Printf("edit-resubmission audit row failed for loan %d: %v", l.ID, err)
		}
	}
	return GetLoan(ctx, l.ID, nil)
}

func scaleSplit(cash, upi, bank, cheque, total, newTotal float64) (float64, float64, float64, float64) {
	if total <= 0 || math.Abs(newTotal-total) < 0.01 {
		return cash, upi, bank, cheque
	}
	scale := newTotal / total
	c := common.RoundMoney(cash * scale)
	u := common.RoundMoney(upi * scale)
	b := common.RoundMoney(bank * scale)
	return c, u, b, common.RoundMoney(newTotal - c - u - b)
}

func LoansForCustomer(ctx context.Context, customerID uint) ([]common.LoanSummary, error) {
	loans, _, err := FindLoans(ctx, LoanFilter{CustomerID: customerID})
	if err != nil {
		return nil, err
	}
	out := make([]common.LoanSummary, len(loans))
	for i, l := range loans {
		out[i] = common.LoanSummary{ID: l.ID, Number: l.LoanNumber, Status: l.Status}
	}
	return out, nil
}

func PurgeLoan(ctx context.Context, loanID uint) error {
	loan, err := findLoanByID(ctx, loanID)
	if err != nil {
		return common.NewNotFound("loan not found")
	}
	var pledges []models.BankPledgeRecord
	if err := config.DB.
		WithContext(ctx).Where("loan_id = ?", loanID).Find(&pledges).Error; err != nil {
		return err
	}
	var movementIDs, expenseIDs []uint
	for _, p := range pledges {
		for _, id := range []*uint{p.CashMovementID, p.ReleaseCashMovementID} {
			if id != nil {
				movementIDs = append(movementIDs, *id)
			}
		}
		for _, id := range []*uint{p.ExpenseID, p.ReleaseExpenseID} {
			if id != nil {
				expenseIDs = append(expenseIDs, *id)
			}
		}
	}
	if err := hardDeleteLoanRows(ctx, loanID); err != nil {
		return err
	}
	return cashbook.DeleteAllLoanCashEntries(ctx, loan.LoanNumber, movementIDs, expenseIDs)
}

func hardDeleteLoanRows(ctx context.Context, loanID uint) error {
	return config.DB.
		WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where(
			"auction_record_id IN (SELECT id FROM auction_records WHERE loan_id = ?)", loanID,
		).Delete(&models.AuctionDecisionRequest{}).Error; err != nil {
			return err
		}
		if err := tx.Where(
			"auction_record_id IN (SELECT id FROM auction_records WHERE loan_id = ?)", loanID,
		).Delete(&models.AuctionNotice{}).Error; err != nil {
			return err
		}
		if err := tx.Where(
			"auction_record_id IN (SELECT id FROM auction_records WHERE loan_id = ?)", loanID,
		).Delete(&models.AuctionEvent{}).Error; err != nil {
			return err
		}
		if err := tx.Where("loan_id = ?", loanID).Delete(&models.AuctionRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Where(
			"request_id IN (SELECT id FROM loan_requests WHERE loan_id = ?)", loanID,
		).Delete(&models.RequestApproval{}).Error; err != nil {
			return err
		}
		if err := tx.Where("loan_id = ?", loanID).Delete(&models.LoanRequest{}).Error; err != nil {
			return err
		}
		if err := tx.Where(
			"bank_pledge_record_id IN (SELECT id FROM bank_pledge_records WHERE loan_id = ?)", loanID,
		).Delete(&models.BankPledgeEvent{}).Error; err != nil {
			return err
		}
		if err := tx.Where("loan_id = ?", loanID).Delete(&models.BankPledgeRecord{}).Error; err != nil {
			return err
		}
		if err := tx.Where("loan_id = ?", loanID).Delete(&models.LoanPayment{}).Error; err != nil {
			return err
		}
		if err := tx.Where("loan_id = ?", loanID).Delete(&models.LoanApproval{}).Error; err != nil {
			return err
		}
		if err := tx.Where(
			"ornament_id IN (SELECT id FROM ornaments WHERE loan_id = ?)", loanID,
		).Delete(&models.OrnamentImage{}).Error; err != nil {
			return err
		}
		if err := tx.Where(
			"ornament_id IN (SELECT id FROM ornaments WHERE loan_id = ?)", loanID,
		).Delete(&models.OrnamentPurityTest{}).Error; err != nil {
			return err
		}
		if err := tx.Where("loan_id = ?", loanID).Delete(&models.Ornament{}).Error; err != nil {
			return err
		}
		if err := tx.Exec(
			"DELETE FROM packet_movements WHERE packet_id IN (SELECT id FROM packets WHERE loan_id = ?)", loanID,
		).Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM packets WHERE loan_id = ?", loanID).Error; err != nil {
			return err
		}
		if err := tx.Exec("DELETE FROM reminders WHERE loan_id = ?", loanID).Error; err != nil {
			return err
		}
		return tx.Unscoped().Delete(&models.Loan{}, loanID).Error
	})
}

func recalculateAndSave(ctx context.Context, l *models.Loan) (*models.Loan, error) {
	ornaments, err := FindByLoanID(ctx, l.ID)
	if err != nil {
		return nil, err
	}
	recalculateTotals(l, ornaments)
	if err := persistLoan(ctx, l); err != nil {
		return nil, err
	}
	return GetLoan(ctx, l.ID, nil)
}

func SavePurityTest(ctx context.Context, ornamentID uint, in PurityTestInput) (*models.Ornament, error) {
	o, err := findOrnamentByID(ctx, ornamentID)
	if err != nil {
		return nil, common.NewNotFound("ornament not found")
	}
	if _, _, err := ParsePurity(in.TestedPurity); err != nil {
		return nil, common.NewBadRequest("purity must be a karat like \"22K\" (10-24) or a fineness percentage like \"91.6%\" (0-100)")
	}
	if in.TestedGrossWeight <= 0 {
		return nil, common.NewBadRequest("gross weight must be greater than zero")
	}
	t := o.PurityTest
	if t == nil {
		t = &models.OrnamentPurityTest{OrnamentID: ornamentID}
	}
	t.TestedPurity = in.TestedPurity
	t.TestedGrossWeight = in.TestedGrossWeight
	t.TestedDeductionWeight = in.TestedDeductionWeight
	t.TestedNetWeight = in.TestedGrossWeight - in.TestedDeductionWeight
	if t.TestedNetWeight < 0 {
		t.TestedNetWeight = 0
	}
	t.TestingRemarks = in.TestingRemarks
	t.TestedBy = in.TestedBy
	t.TestedAt = in.TestedAt
	if err := insertPurityTest(ctx, t); err != nil {
		return nil, err
	}
	return findOrnamentByID(ctx, ornamentID)
}

func employeeName(ctx context.Context, employeeID uint) string {
	var name string
	if err := config.DB.
		WithContext(ctx).Table("employees").Select("name").Where("id = ?", employeeID).Limit(1).Scan(&name).Error; err != nil {
		log.Printf("employee name lookup failed for employee %d: %v", employeeID, err)
	}
	return name
}

func getInterestCollected(ctx context.Context, from, to time.Time, branchID *uint) (float64, error) {
	return sumInterestCollected(ctx, from, to, branchID)
}

func customerInBranchScope(ctx context.Context, customerID uint, scope *uint) (bool, error) {
	if scope == nil {
		return true, nil
	}
	c, err := common.FindCustomerByID(ctx, customerID)
	if err != nil {
		return false, nil
	}
	return c.BranchID == *scope, nil
}

func undoCashMovement(ctx context.Context, id *uint) {
	if id == nil {
		return
	}
	if err := cashbook.DeleteCashMovement(ctx, *id); err != nil {
		log.Printf("could not roll back cash movement %d after a failed save: %v", *id, err)
	}
}

func requireNoPendingDecision(ctx context.Context, recID uint) error {
	pending, err := hasAnyPendingDecision(ctx, recID)
	if err != nil {
		return err
	}
	if pending {
		return common.NewConflict("a repayment decision is pending on this auction — it must be resolved before the auction can proceed")
	}
	return nil
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate key") ||
		strings.Contains(msg, "unique constraint") ||
		strings.Contains(msg, "uniqueviolation")
}

func derefUint(p *uint) uint {
	if p == nil {
		return 0
	}
	return *p
}

func normalStatusFor(l *models.Loan, asOf time.Time) string {
	if asOf.After(l.DueDate) {
		return models.StatusOverdue
	}
	if int(l.DueDate.Sub(asOf).Hours()/24) <= dueSoonWindowDays {
		return models.StatusDueSoon
	}
	return models.StatusActive
}

func isLoanTerminal(status string) bool {
	return status == models.StatusClosed || status == models.StatusRejected || status == models.StatusAuctioned || status == "Defaulted"
}

func getCustomer360(ctx context.Context, customerID uint, from, to *time.Time) (*Customer360, error) {
	cust, err := common.FindCustomerByID(ctx, customerID)
	if err != nil {
		return nil, common.NewBadRequest("customer does not exist")
	}
	loans, _, err := FindLoans(ctx, LoanFilter{CustomerID: customerID, OpenedFrom: from, OpenedTo: to})
	if err != nil {
		return nil, err
	}
	out := &Customer360{Customer: common.CustomerToResponse(cust)}
	for i := range loans {
		enrichLoan(ctx, &loans[i])
		if loans[i].ApprovalStage == models.ApprovalStageApproved {
			out.TotalDisbursed += loans[i].PrincipalAmount
			out.TotalOutstanding += loans[i].TotalOutstandingBalance
			out.TotalPaid += loans[i].TotalPaid
		}
		switch loans[i].Status {
		case models.StatusClosed, models.StatusAuctioned:
			out.ClosedLoanCount++
		case models.StatusActive, models.StatusDueSoon, models.StatusOverdue, models.StatusClosureRequested,
			models.StatusAuctionedBalanceDue:
			out.ActiveLoanCount++
		}
		if recs, err := findAuctionHistoryByLoanID(ctx, loans[i].ID); err == nil {
			out.AuctionHistory = append(out.AuctionHistory, recs...)
		}
	}
	out.Loans = loans
	return out, nil
}

func listLoansForCustomer(ctx context.Context, customerID uint, from, to *time.Time, search string, limit, offset int) ([]models.Loan, int64, error) {
	if _, err := common.FindCustomerByID(ctx, customerID); err != nil {
		return nil, 0, common.NewBadRequest("customer does not exist")
	}
	return listLoans(ctx, LoanFilter{CustomerID: customerID, OpenedFrom: from, OpenedTo: to, Query: search, Limit: limit, Offset: offset})
}

func bondDataForLoan(ctx context.Context, l *models.Loan) BondData {
	now := time.Now()
	age := 0
	if !l.Customer.DOB.IsZero() {
		age = int(now.Sub(l.Customer.DOB).Hours() / 24 / 365.25)
	}
	ornaments := make([]BondOrnament, 0, len(l.Ornaments))
	for _, o := range l.Ornaments {
		ornaments = append(ornaments, BondOrnament{
			Name:        o.Name,
			Purity:      o.Purity,
			GrossWeight: o.GrossWeight,
			NetWeight:   o.NetWeight,
			Value:       o.GoldValue,
		})
	}
	var aadhaar string
	if l.Customer.AadhaarEncrypted != "" && (config.AadhaarCipher != nil) {
		if plain, err := config.AadhaarCipher.
			Decrypt(l.Customer.AadhaarEncrypted); err == nil {
			aadhaar = plain
		} else {
			log.Printf("pledge agreement: decrypt Aadhaar for customer %d failed: %v", l.Customer.ID, err)
		}
	}
	legalName, addressLine, kmlRegNo, policy := lenderProfile(ctx)
	lenderAge, lenderPAN, lenderAadhaar := lenderIdentity(ctx)
	return BondData{
		LoanNumber:      l.LoanNumber,
		CustomerName:    l.Customer.Name,
		Age:             age,
		Address:         l.Customer.Address,
		BranchName:      bondPlace(singleBranch(ctx), l.Branch.Name, addressLine),
		Phone:           l.Customer.Phone,
		PAN:             l.Customer.PAN,
		Aadhaar:         aadhaar,
		PrincipalAmount: l.PrincipalAmount,
		InterestRate:    l.SchemeInterestRate,
		Ornaments:       ornaments,
		Day:             now.Day(),
		Month:           now.Month().String(),
		Year:            now.Year(),
		BusinessName:    businessName(ctx),
		LegalName:       legalName,
		AddressLine:     addressLine,
		KMLRegNo:        kmlRegNo,
		LenderAge:       lenderAge,
		LenderPAN:       lenderPAN,
		LenderAadhaar:   lenderAadhaar,
		Policy:          policy,
		DueDate:         l.DueDate,
		LenderSignature: lenderSignature(ctx),
		Disbursements:   bondDisbursements(ctx, l),
	}
}

func fillLenderProfile(ctx context.Context, data *BondData) {
	data.LegalName, data.AddressLine, data.KMLRegNo, data.Policy = lenderProfile(ctx)
	data.LenderAge, data.LenderPAN, data.LenderAadhaar = lenderIdentity(ctx)
	data.BusinessName = businessName(ctx)
	data.LenderSignature = lenderSignature(ctx)
}

func preloadAll(db *gorm.DB) *gorm.DB {
	return db.
		Preload("Branch").
		Preload("Customer").
		Preload("Scheme").
		Preload("Ornaments.PurityTest").
		Preload("Ornaments.Images").
		Preload("Approvals").
		Preload("Payments.BankRef").
		Preload("Pledges")
}

func insertLoan(ctx context.Context, l *models.Loan) error {
	return config.DB.
		WithContext(ctx).Create(l).Error
}

func persistLoan(ctx context.Context, l *models.Loan) error {
	return config.DB.
		WithContext(ctx).Save(l).Error
}

func lockByID(ctx context.Context, tx *gorm.DB, id uint) (*models.Loan, error) {
	var l models.Loan
	if err := tx.WithContext(ctx).Clauses(clause.Locking{Strength: "UPDATE"}).First(&l, id).Error; err != nil {
		return nil, err
	}
	return &l, nil
}

func updateLoanTx(ctx context.Context, tx *gorm.DB, l *models.Loan) error {
	return loanDbOr(ctx, tx).Save(l).Error
}

func loanDbOr(ctx context.Context, tx *gorm.DB) *gorm.DB {
	if tx != nil {
		return tx
	}
	return config.DB.
		WithContext(ctx)
}

func findLoanByID(ctx context.Context, id uint) (*models.Loan, error) {
	var l models.Loan
	if err := preloadAll(config.DB.
		WithContext(ctx)).First(&l, id).Error; err != nil {
		return nil, err
	}
	return &l, nil
}

func findByLoanNumber(ctx context.Context, loanNumber string) (*models.Loan, error) {
	var l models.Loan
	if err := preloadAll(config.DB.
		WithContext(ctx)).Where("loan_number = ?", loanNumber).First(&l).Error; err != nil {
		return nil, err
	}
	return &l, nil
}

func startOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

func applyFilters(q *gorm.DB, f LoanFilter) *gorm.DB {
	if len(f.ServicingIn) > 0 {
	} else if len(f.StatusIn) > 0 {
		q = q.Where("loans.status IN ?", f.StatusIn)
	} else if f.Status != "" {
		q = q.Where("loans.status = ?", f.Status)
	}
	if f.BranchID != 0 {
		q = q.Where("loans.branch_id = ?", f.BranchID)
	}
	if len(f.BranchIDs) > 0 {
		q = q.Where("loans.branch_id IN ?", f.BranchIDs)
	}
	if f.CustomerID != 0 {
		q = q.Where("loans.customer_id = ?", f.CustomerID)
	}
	if len(f.CustomerIDs) > 0 {
		q = q.Where("loans.customer_id IN ?", f.CustomerIDs)
	}
	if f.SchemeID != 0 {
		q = q.Where("loans.scheme_id = ?", f.SchemeID)
	}
	if len(f.LoanIDs) > 0 {
		q = q.Where("loans.id IN ?", f.LoanIDs)
	}
	if f.Query != "" {
		like := "%" + f.Query + "%"
		q = q.Joins("JOIN customers ON customers.id = loans.customer_id").
			Where("loans.loan_number ILIKE ? OR customers.name ILIKE ? OR customers.code ILIKE ?", like, like, like)
	}
	if f.BranchScope != nil {
		q = q.Where("loans.branch_id = ?", *f.BranchScope)
	}
	if f.OpenedFrom != nil {
		q = q.Where("loans.opened_date >= ?", startOfDay(*f.OpenedFrom))
	}
	if f.OpenedTo != nil {
		q = q.Where("loans.opened_date < ?", startOfDay(*f.OpenedTo).AddDate(0, 0, 1))
	}
	if f.ExcludeBankPledged {
		q = q.Where("loans.bank_pledge_status <> ?", models.BankPledgeStatusPledged)
		q = q.Where("loans.status NOT IN ?", models.BankPledgeIneligibleStatuses)
	}
	if f.BankPledgeStatus != "" {
		q = q.Where("loans.bank_pledge_status = ?", f.BankPledgeStatus)
	}
	if f.DueToday {
		today := startOfDay(time.Now())
		q = q.Where("loans.status IN ?", openServicingStatuses).
			Where("loans.due_date >= ? AND loans.due_date < ?", today, today.AddDate(0, 0, 1))
	}
	if f.OnlyDefaulted {
		q = q.Where("loans.status NOT IN ?", notDefaultableStatuses).
			Where("loans.due_date < ?", time.Now().AddDate(0, 0, -defaultedAfterDays))
	}
	if f.Servicing != "" {
		notIn, dueBefore, dueFrom := servicingCandidates(f.Servicing, time.Now())
		if len(notIn) > 0 {
			q = q.Where("loans.status NOT IN ?", notIn)
		}
		if dueFrom != nil {
			q = q.Where("loans.due_date >= ?", *dueFrom)
		}
		if dueBefore != nil {
			q = q.Where("loans.due_date < ?", *dueBefore)
		}
	}
	if f.AllAuctionCases {
		q = q.Where("(loans.status IN ?) OR (loans.status NOT IN ? AND loans.due_date < ?)",
			[]string{models.StatusAuctionEligible, models.StatusAuctionedBalanceDue},
			notDefaultableStatuses, time.Now().AddDate(0, 0, -defaultedAfterDays))
	}
	return q
}

func FindLoans(ctx context.Context, f LoanFilter) ([]models.Loan, int64, error) {
	base := preloadAll(config.DB.
		WithContext(ctx)).Model(&models.Loan{})
	if f.BankPledgeStatus == models.BankPledgeStatusPledged {
		base = base.
			Joins("JOIN bank_pledge_records ON bank_pledge_records.loan_id = loans.id AND bank_pledge_records.status = ?", models.BankPledgeStatusRecordActive).
			Order("bank_pledge_records.pledge_date desc, bank_pledge_records.id desc")
	} else {
		base = base.Order("loans.opened_date desc, loans.id desc")
	}
	q := applyFilters(base, f)
	var total int64
	if f.Limit > 0 {
		if err := applyFilters(config.DB.
			WithContext(ctx).Model(&models.Loan{}), f).Count(&total).Error; err != nil {
			return nil, 0, err
		}
		q = q.Limit(f.Limit)
	}
	if f.Offset > 0 {
		q = q.Offset(f.Offset)
	}
	var loans []models.Loan
	err := q.Find(&loans).Error
	return loans, total, err
}

func countFiltered(ctx context.Context, f LoanFilter) (int64, error) {
	var count int64
	err := applyFilters(config.DB.
		WithContext(ctx).Model(&models.Loan{}), f).Count(&count).Error
	return count, err
}

func countAll(ctx context.Context) (int64, error) {
	var count int64
	err := config.DB.
		WithContext(ctx).Model(&models.Loan{}).Count(&count).Error
	return count, err
}

func maxLoanNumberSuffix(ctx context.Context) (int, error) {
	var maxSuffix int
	err := config.DB.
		WithContext(ctx).Model(&models.Loan{}).Unscoped().
		Select("COALESCE(MAX(CAST(SUBSTRING(loan_number FROM 'LN-(\\d+)') AS INTEGER)), 0)").
		Scan(&maxSuffix).Error
	return maxSuffix, err
}

func FindOpenForCalendar(ctx context.Context) ([]models.Loan, error) {
	var loans []models.Loan
	err := config.DB.
		WithContext(ctx).
		Select("id", "loan_number", "customer_id", "branch_id", "opened_date", "due_date", "status").
		Preload("Customer", func(db *gorm.DB) *gorm.DB {
			return db.Select("id", "name", "code")
		}).
		Where("status IN ?", []string{models.StatusActive, models.StatusDueSoon, models.StatusOverdue}).
		Find(&loans).Error
	return loans, err
}

func CreateLoan(c echo.Context) error {
	ctx := auth.RequestContext(c)
	var req loanRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	input, err := req.toInput()
	if err != nil {
		return common.FailErr(c, err)
	}
	input.BranchID = auth.EnforceBranchOnWrite(c, input.BranchID)
	rec, err := SaveLoan(ctx, input)
	if err != nil {
		return common.FailErr(c, err)
	}
	if req.DraftID != nil {
		actorEmployeeID, _, _ := auth.ActorFromContext(c)
		deleteDraftQuietly(ctx, *req.DraftID, actorEmployeeID)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ListLoans(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := common.PageParams(c)
	f := LoanFilter{Query: strings.TrimSpace(c.QueryParam("search"))}
	if statuses := splitCSV(c.QueryParam("status")); len(statuses) > 1 {
		f.StatusIn = statuses
	} else {
		applyStatusParam(&f, c.QueryParam("status"))
	}
	if !applyAuctionCase(&f, c.QueryParam("auction_case")) {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid auctionCase: expected all, eligible, defaulted or auctioned_balance_due"})
	}
	if svs := splitCSV(strings.ToLower(c.QueryParam("servicing"))); len(svs) > 0 {
		for _, sv := range svs {
			if !validServicing(sv) {
				return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid servicing: expected due_soon, overdue or defaulted"})
			}
		}
		if len(svs) == 1 && len(f.StatusIn) == 0 && f.Status == "" {
			f.DueToday, f.Servicing = false, svs[0]
		} else if len(svs) == 1 && f.Status == "" {
			f.DueToday, f.ServicingIn = false, svs
		} else {
			if f.Status != "" {
				f.StatusIn = append(f.StatusIn, f.Status)
			}
			f.Status, f.DueToday, f.ServicingIn = "", false, svs
		}
	}
	f.ExcludeBankPledged = c.QueryParam("exclude_bank_pledged") == "true"
	f.BankPledgeStatus = c.QueryParam("bank_pledge_status")
	if ids := parseUintCSV(c.QueryParam("branch_id")); len(ids) == 1 {
		f.BranchID = ids[0]
	} else {
		f.BranchIDs = ids
	}
	if ids := parseUintCSV(c.QueryParam("customer_id")); len(ids) == 1 {
		f.CustomerID = ids[0]
	} else {
		f.CustomerIDs = ids
	}
	if v := c.QueryParam("scheme_id"); v != "" {
		if id, err := strconv.ParseUint(v, 10, 64); err == nil {
			f.SchemeID = uint(id)
		}
	}
	from, to, ok := parseOpenedRange(c)
	if !ok {
		return nil
	}
	f.OpenedFrom, f.OpenedTo = from, to
	f.BranchScope = auth.GetBranchScope(c)
	if limit > 0 {
		f.Limit, f.Offset = limit, offset
		rec, total, err := listLoans(ctx, f)
		if err != nil {
			return common.FailErr(c, err)
		}
		return common.SuccessPage(c, page, limit, total, rec)
	}
	rec, _, err := listLoans(ctx, f)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessAll(c, rec)
}

func GetLoanById(c echo.Context) error {
	ctx := auth.RequestContext(c)
	id, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	rec, err := GetLoan(ctx, id, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func GetLoanByNumber(c echo.Context) error {
	ctx := auth.RequestContext(c)
	rec, err := getByLoanNumber(ctx, c.Param("loan_number"))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func UpdateLoan(c echo.Context) error {
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req updateLoanRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	actorEmployeeID, actorRole, _ := auth.ActorFromContext(c)
	rec, err := updateLoan(auth.RequestContext(c), loanID, UpdateLoanInput{
		SchemeID:        req.SchemeID,
		PrincipalAmount: req.PrincipalAmount,
		ActorEmployeeID: actorEmployeeID,
		ActorRole:       actorRole,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func RecordPurityTest(c echo.Context) error {
	ctx := auth.RequestContext(c)
	ornamentID, err := common.IDParam(c, "ornament_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var req purityTestRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	testedAt, err := parseDate(req.TestedAt)
	if err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid tested_at: expected YYYY-MM-DD"})
	}
	rec, err := SavePurityTest(ctx, ornamentID, PurityTestInput{
		TestedPurity:          req.TestedPurity,
		TestedGrossWeight:     req.TestedGrossWeight,
		TestedDeductionWeight: req.TestedDeductionWeight,
		TestingRemarks:        req.TestingRemarks,
		TestedBy:              req.TestedBy,
		TestedAt:              testedAt,
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func GetCustomer360(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if !customerInScope(c, ctx, customerID) {
		return nil
	}
	var from, to *time.Time
	if v := c.QueryParam("from"); v != "" {
		parsed, err := parseDate(v)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid from: expected YYYY-MM-DD"})
		}
		from = &parsed
	}
	if v := c.QueryParam("to"); v != "" {
		parsed, err := parseDate(v)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid to: expected YYYY-MM-DD"})
		}
		to = &parsed
	}
	if from != nil && to != nil && to.Before(*from) {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid range: to is before from"})
	}
	rec, err := getCustomer360(ctx, customerID, from, to)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, rec)
}

func ListLoansForCustomer(c echo.Context) error {
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
	rec, total, err := listLoansForCustomer(ctx, customerID, from, to, strings.TrimSpace(c.QueryParam("search")), limit, offset)
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.SuccessPage(c, page, limit, total, rec)
}

func GetInterestCollected(c echo.Context) error {
	ctx := auth.RequestContext(c)
	now := time.Now()
	from := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	to := now
	if v := c.QueryParam("from"); v != "" {
		parsed, err := parseDate(v)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid from: expected YYYY-MM-DD"})
		}
		from = parsed
	}
	if v := c.QueryParam("to"); v != "" {
		parsed, err := parseDate(v)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid to: expected YYYY-MM-DD"})
		}
		to = parsed
	}
	total, err := getInterestCollected(ctx, from, to, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{"interest_collected": total, "from": from.Format("2006-01-02"), "to": to.Format("2006-01-02")})
}

func GetNextLoanNumber(c echo.Context) error {
	maxSuffix, err := maxLoanNumberSuffix(auth.RequestContext(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{"loan_number": fmt.Sprintf("LN-%05d", maxSuffix+1)})
}

func HardDeleteLoan(c echo.Context) error {
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if err := PurgeLoan(auth.RequestContext(c), loanID); err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, echo.Map{"deleted": true})
}
