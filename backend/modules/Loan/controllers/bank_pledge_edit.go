package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	cashbook "cloudhouse/backend/modules/Cash/controllers"
	"cloudhouse/backend/modules/Loan/models"
	packet "cloudhouse/backend/modules/Packet/controllers"
	packetModels "cloudhouse/backend/modules/Packet/models"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// Editing or deleting a bank pledge rewrites what the pledge booked: its cash-in lines, and for a released pledge
// the release cash-out lines and the "Bank Pledge Release" expense entry. The old lines are found by the saved cash
// group (or, for a record from before groups were saved, by the line id the record kept) and are only touched when
// they add up exactly to what the record says; otherwise the edit is refused with 409.

// EditBankPledgeInput holds the fields an edit may change; nil means "leave as is". A pledge or release breakdown is
// taken as a whole: sending any one of its amounts replaces the other three (unsent ones are zero).
type EditBankPledgeInput struct {
	BankID             *uint
	BankName           *string
	PledgedAmount      *float64
	PledgeDate         *time.Time
	BankPledgeDueDate  *time.Time
	ClearDueDate       bool
	BankInterestRate   *float64
	ReferenceNumber    *string
	CashTreatment      *string
	CashAmount         *float64
	UpiAmount          *float64
	BankTransferAmount *float64
	ChequeAmount       *float64
	ReceivedBankID     *uint

	ReleaseDate               *time.Time
	ReleaseCashAmount         *float64
	ReleaseUpiAmount          *float64
	ReleaseBankTransferAmount *float64
	ReleaseChequeAmount       *float64
	ReleaseBankID             *uint
}

// BankPledgeEditResult is returned by an edit or delete: the record before and after (After is nil for a delete).
type BankPledgeEditResult struct {
	Before *models.BankPledgeRecord `json:"before"`
	After  *models.BankPledgeRecord `json:"after"`
	DryRun bool                     `json:"dry_run"`
}

func orF(p *float64, d float64) float64 {
	if p != nil {
		return *p
	}
	return d
}

func sameDayKeep(newT *time.Time, old time.Time) time.Time {
	if newT == nil {
		return old
	}
	ny, nm, nd := newT.Date()
	oy, om, od := old.In(time.Local).Date()
	if ny == oy && nm == om && nd == od {
		return old
	}
	return *newT
}

// applyBankPledgeEdit returns the pledge as it will be after the edit, or a 4xx error when the edit is not valid.
// legacyRelease is the split of the release lines on the ledger, used when a released record has none saved.
func applyBankPledgeEdit(old models.BankPledgeRecord, in EditBankPledgeInput, legacyRelease *[4]float64, legacyBankID *uint) (models.BankPledgeRecord, error) {
	n := old
	if n.Status != models.BankPledgeStatusRecordActive && n.Status != "Released" {
		return n, common.NewConflict("only an active or released bank pledge can be edited")
	}
	if in.BankID != nil {
		n.BankID = in.BankID
	}
	if in.BankName != nil {
		n.BankName = strings.TrimSpace(*in.BankName)
		if n.BankName == "" {
			return n, common.NewBadRequest("bank name is required")
		}
	}
	if in.PledgedAmount != nil {
		n.PledgedAmount = common.RoundMoney(*in.PledgedAmount)
	}
	if n.PledgedAmount <= 0 {
		return n, common.NewBadRequest("amount must be greater than zero")
	}
	n.PledgeDate = sameDayKeep(in.PledgeDate, old.PledgeDate)
	if in.ClearDueDate {
		n.BankPledgeDueDate = nil
	} else if in.BankPledgeDueDate != nil {
		n.BankPledgeDueDate = in.BankPledgeDueDate
	}
	if in.BankInterestRate != nil {
		if *in.BankInterestRate < 0 {
			return n, common.NewBadRequest("interest rate cannot be negative")
		}
		n.BankInterestRate = *in.BankInterestRate
	}
	if in.ReferenceNumber != nil {
		n.ReferenceNumber = strings.TrimSpace(*in.ReferenceNumber)
		if utf8.RuneCountInString(n.ReferenceNumber) > 150 {
			return n, common.NewBadRequest("reference number can be at most 150 characters")
		}
	}
	if in.CashTreatment != nil {
		n.CashTreatment = *in.CashTreatment
	}
	switch n.CashTreatment {
	case models.BankPledgeCashTreatmentCashIn, models.BankPledgeCashTreatmentRecordOnly:
	default:
		return n, common.NewBadRequest("cash_treatment must be either \"CashIn\" or \"RecordOnly\"")
	}
	if n.CashTreatment == models.BankPledgeCashTreatmentRecordOnly {
		n.CashAmount, n.UpiAmount, n.BankTransferAmount, n.ChequeAmount, n.ReceivedBankID = 0, 0, 0, 0, nil
		n.ReleaseCashAmount, n.ReleaseUpiAmount, n.ReleaseBankTransferAmount, n.ReleaseChequeAmount, n.ReleaseBankID = 0, 0, 0, 0, nil
	} else {
		sent := in.CashAmount != nil || in.UpiAmount != nil || in.BankTransferAmount != nil || in.ChequeAmount != nil
		cash, upi, bt, chq := old.CashAmount, old.UpiAmount, old.BankTransferAmount, old.ChequeAmount
		recvBank := old.ReceivedBankID
		if sent {
			cash, upi, bt, chq = orF(in.CashAmount, 0), orF(in.UpiAmount, 0), orF(in.BankTransferAmount, 0), orF(in.ChequeAmount, 0)
			recvBank = in.ReceivedBankID
		} else if in.ReceivedBankID != nil {
			recvBank = in.ReceivedBankID
		}
		if !sent && upi+bt+chq == 0 {
			cash = n.PledgedAmount // an all-cash pledge follows its amount
		}
		if !sent && n.PledgedAmount != old.PledgedAmount && (upi+bt+chq > 0) {
			return n, common.NewBadRequest("the amount changed — enter the payment breakdown again so it adds up to the new amount")
		}
		var err error
		n.CashAmount, n.UpiAmount, n.BankTransferAmount, n.ChequeAmount, err = common.NormalizeSplit(cash, upi, bt, chq, n.PledgedAmount, recvBank)
		if err != nil {
			return n, err
		}
		n.ReceivedBankID = nil
		if n.UpiAmount+n.BankTransferAmount+n.ChequeAmount > 0 {
			n.ReceivedBankID = recvBank
		}
	}
	if n.Status == "Released" {
		if n.ReleaseDate == nil {
			return n, common.NewConflict("this released pledge has no release date, so it cannot be edited safely")
		}
		d := sameDayKeep(in.ReleaseDate, *n.ReleaseDate)
		n.ReleaseDate = &d
		if startOfDay(d).Before(startOfDay(n.PledgeDate)) {
			return n, common.NewBadRequest("the release date cannot be before the pledge date")
		}
		if n.CashTreatment == models.BankPledgeCashTreatmentCashIn {
			sent := in.ReleaseCashAmount != nil || in.ReleaseUpiAmount != nil || in.ReleaseBankTransferAmount != nil || in.ReleaseChequeAmount != nil
			var cash, upi, bt, chq float64
			var bankID *uint
			switch {
			case sent:
				cash, upi, bt, chq = orF(in.ReleaseCashAmount, 0), orF(in.ReleaseUpiAmount, 0), orF(in.ReleaseBankTransferAmount, 0), orF(in.ReleaseChequeAmount, 0)
				bankID = in.ReleaseBankID
			case old.CashTreatment != models.BankPledgeCashTreatmentCashIn:
			case old.ReleaseCashAmount+old.ReleaseUpiAmount+old.ReleaseBankTransferAmount+old.ReleaseChequeAmount > 0:
				cash, upi, bt, chq, bankID = old.ReleaseCashAmount, old.ReleaseUpiAmount, old.ReleaseBankTransferAmount, old.ReleaseChequeAmount, old.ReleaseBankID
			case legacyRelease != nil:
				cash, upi, bt, chq, bankID = legacyRelease[0], legacyRelease[1], legacyRelease[2], legacyRelease[3], legacyBankID
			}
			if !sent && upi+bt+chq == 0 {
				cash = n.PledgedAmount
			}
			if !sent && n.PledgedAmount != old.PledgedAmount && (upi+bt+chq > 0) {
				return n, common.NewBadRequest("the amount changed — enter the release payment breakdown again so it adds up to the new amount")
			}
			var err error
			n.ReleaseCashAmount, n.ReleaseUpiAmount, n.ReleaseBankTransferAmount, n.ReleaseChequeAmount, err = common.NormalizeSplit(cash, upi, bt, chq, n.PledgedAmount, bankID)
			if err != nil {
				return n, err
			}
			n.ReleaseBankID = nil
			if n.ReleaseUpiAmount+n.ReleaseBankTransferAmount+n.ReleaseChequeAmount > 0 {
				n.ReleaseBankID = bankID
			}
		}
	}
	return n, nil
}

// bankPledgeLoanStatus is the loan's bank-pledge status once the remaining pledges are known.
func bankPledgeLoanStatus(active, released int64) string {
	switch {
	case active > 0:
		return models.BankPledgeStatusPledged
	case released > 0:
		return "Released"
	}
	return "Not Pledged"
}

// editBankPledge edits (in != nil) or deletes (in == nil) one bank pledge together with its cash lines.
func editBankPledge(ctx context.Context, loanID, pledgeID uint, in *EditBankPledgeInput, dryRun bool) (*BankPledgeEditResult, error) {
	res := &BankPledgeEditResult{DryRun: dryRun}
	lastPledgeGone := false
	err := config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		l, err := lockByID(ctx, tx, loanID)
		if err != nil {
			return common.NewNotFound("loan not found")
		}
		var p models.BankPledgeRecord
		if err := tx.WithContext(ctx).First(&p, pledgeID).Error; err != nil || p.LoanID != loanID {
			return common.NewNotFound("bank pledge record not found")
		}
		if p.Status != models.BankPledgeStatusRecordActive && p.Status != "Released" {
			return common.NewConflict("a voided bank pledge is kept as history and cannot be edited or deleted")
		}
		before := p
		res.Before = &before
		txCtx := cashbook.WithTx(ctx, tx)

		// the lines this pledge booked; refused when they cannot be identified exactly
		var pledgeLines, releaseLines *cashbook.BankPledgeLines
		var expenseID *uint
		if p.CashTreatment == models.BankPledgeCashTreatmentCashIn {
			if pledgeLines, err = cashbook.FindMovementGroup(txCtx, p.CashTransactionGroupID, p.CashMovementID, "in", p.PledgedAmount); err != nil {
				return err
			}
			if p.Status == "Released" {
				if releaseLines, err = cashbook.FindMovementGroup(txCtx, p.ReleaseCashTransactionGroupID, p.ReleaseCashMovementID, "out", p.PledgedAmount); err != nil {
					return err
				}
				if p.ReleaseExpenseID == nil {
					return common.NewConflict("this release's expense entry cannot be identified, so it cannot be edited safely")
				}
				if _, err = cashbook.FindBankPledgeReleaseExpense(txCtx, *p.ReleaseExpenseID, p.PledgedAmount); err != nil {
					return err
				}
				expenseID = p.ReleaseExpenseID
			}
		}

		if in == nil {
			// delete: the packet must still be where this pledge put it
			if p.Status == models.BankPledgeStatusRecordActive {
				if pk, perr := packet.FindActiveByLoanID(ctx, loanID); perr == nil && pk.Status != packetModels.StatusBankPledged {
					// A packet that was never marked as pledged (the gold was not in a locker yet when the pledge was
					// recorded) has nothing to move back. Only one that was pledged and has since gone elsewhere is refused.
					var pledgedMoves int64
					if err := tx.WithContext(ctx).Model(&packetModels.PacketMovement{}).
						Where("packet_id = ? AND to_status = ?", pk.ID, packetModels.StatusBankPledged).Count(&pledgedMoves).Error; err != nil {
						return err
					}
					if pledgedMoves > 0 {
						return common.NewConflict("the gold packet has moved since it was pledged (it is now " + pk.Status + "), so this pledge cannot be deleted")
					}
				}
			}
			if dryRun {
				return errDryRun
			}
			if pledgeLines != nil {
				if err := cashbook.DeleteMovementGroup(txCtx, pledgeLines.GroupID); err != nil {
					return err
				}
			}
			if releaseLines != nil {
				if err := cashbook.DeleteMovementGroup(txCtx, releaseLines.GroupID); err != nil {
					return err
				}
			}
			if expenseID != nil {
				if err := cashbook.DeleteBankPledgeReleaseExpense(txCtx, *expenseID); err != nil {
					return err
				}
			}
			if err := tx.WithContext(ctx).Where("bank_pledge_record_id = ?", p.ID).Delete(&models.BankPledgeEvent{}).Error; err != nil {
				return err
			}
			if err := tx.WithContext(ctx).Delete(&models.BankPledgeRecord{}, p.ID).Error; err != nil {
				return err
			}
			var active, released int64
			if err := tx.Model(&models.BankPledgeRecord{}).Where("loan_id = ? AND status = ?", loanID, models.BankPledgeStatusRecordActive).Count(&active).Error; err != nil {
				return err
			}
			if err := tx.Model(&models.BankPledgeRecord{}).Where("loan_id = ? AND status = ?", loanID, "Released").Count(&released).Error; err != nil {
				return err
			}
			l.BankPledgeStatus = bankPledgeLoanStatus(active, released)
			lastPledgeGone = p.Status == models.BankPledgeStatusRecordActive && active == 0
			return updateLoanTx(ctx, tx, l)
		}

		var legacy *[4]float64
		var legacyBank *uint
		if releaseLines != nil {
			legacy = &[4]float64{releaseLines.Cash, releaseLines.UPI, releaseLines.Bank, 0}
			legacyBank = releaseLines.BankID
		}
		n, err := applyBankPledgeEdit(p, *in, legacy, legacyBank)
		if err != nil {
			return err
		}
		res.After = &n
		if dryRun {
			return errDryRun
		}

		// remove the old lines, then book the corrected ones
		if pledgeLines != nil {
			if err := cashbook.DeleteMovementGroup(txCtx, pledgeLines.GroupID); err != nil {
				return err
			}
		}
		if releaseLines != nil {
			if err := cashbook.DeleteMovementGroup(txCtx, releaseLines.GroupID); err != nil {
				return err
			}
		}
		n.CashMovementID, n.CashTransactionGroupID = nil, ""
		if n.CashTreatment == models.BankPledgeCashTreatmentCashIn {
			id, err := cashbook.RecordBankPledgeCashIn(txCtx, loanID, l.LoanNumber, n.BankName, n.PledgedAmount, n.CashAmount, n.UpiAmount, n.BankTransferAmount, n.ChequeAmount, n.ReceivedBankID, n.PledgeDate)
			if err != nil {
				return fmt.Errorf("could not record the corrected pledge in Cash-in-Hand: %w", err)
			}
			n.CashMovementID = &id
			n.CashTransactionGroupID = cashbook.MovementGroupOf(txCtx, id)
		}
		n.ReleaseCashMovementID, n.ReleaseCashTransactionGroupID = nil, ""
		if n.Status == "Released" && n.CashTreatment == models.BankPledgeCashTreatmentCashIn {
			id, err := cashbook.RecordBankPledgeCashOut(txCtx, loanID, l.LoanNumber, n.BankName, n.PledgedAmount, n.ReleaseCashAmount, n.ReleaseUpiAmount, n.ReleaseBankTransferAmount, n.ReleaseChequeAmount, n.ReleaseBankID, *n.ReleaseDate, l.BranchID)
			if err != nil {
				return fmt.Errorf("could not record the corrected release in Cash-in-Hand: %w", err)
			}
			n.ReleaseCashMovementID = &id
			n.ReleaseCashTransactionGroupID = cashbook.MovementGroupOf(txCtx, id)
			if expenseID != nil {
				if err := cashbook.UpdateBankPledgeReleaseExpense(txCtx, *expenseID, n.BankName, n.PledgedAmount, *n.ReleaseDate); err != nil {
					return err
				}
				n.ReleaseExpenseID = expenseID
			} else {
				eid, err := cashbook.RecordBankPledgeReleaseExpense(txCtx, loanID, n.BankName, n.PledgedAmount, *n.ReleaseDate, l.BranchID)
				if err != nil {
					return fmt.Errorf("could not record the release expense: %w", err)
				}
				n.ReleaseExpenseID = &eid
			}
		} else if expenseID != nil {
			if err := cashbook.DeleteBankPledgeReleaseExpense(txCtx, *expenseID); err != nil {
				return err
			}
			n.ReleaseExpenseID = nil
		}
		if err := tx.WithContext(ctx).Save(&n).Error; err != nil {
			return err
		}
		res.After = &n
		return nil
	})
	if errors.Is(err, errDryRun) {
		return res, nil
	}
	if err != nil {
		return nil, err
	}
	if lastPledgeGone {
		if err := packet.RecordBankReleaseMovement(ctx, loanID, "Bank pledge deleted"); err != nil {
			log.Printf("packet movement (pledge delete) failed for loan %d: %v", loanID, err)
		}
	}
	return res, nil
}

func writeBankPledgeAudit(ctx context.Context, actorEmployeeID uint, action string, loanID uint, loanNumber string, res *BankPledgeEditResult) {
	actorName := "unknown"
	if actor, err := common.FindEmployeeByID(ctx, actorEmployeeID); err == nil {
		actorName = actor.Name
	}
	before, _ := json.Marshal(res.Before)
	after, _ := json.Marshal(res.After)
	_ = common.InsertAuditLog(ctx, &commonModels.Entry{
		ActorEmployeeID: actorEmployeeID, ActorName: actorName, Action: action,
		EntityType: "loan", EntityID: loanID, EntityName: loanNumber,
		Detail: fmt.Sprintf("bank pledge before: %s | after: %s", before, after),
	})
}

type editBankPledgeRequest struct {
	BankID             *uint    `json:"bank_id"`
	BankName           *string  `json:"bank_name"`
	PledgedAmount      *float64 `json:"pledged_amount"`
	PledgeDate         *string  `json:"pledge_date"`
	BankPledgeDueDate  *string  `json:"bank_pledge_due_date"`
	BankInterestRate   *float64 `json:"bank_interest_rate"`
	ReferenceNumber    *string  `json:"reference_number"`
	CashTreatment      *string  `json:"cash_treatment"`
	CashAmount         *float64 `json:"cash_amount"`
	UpiAmount          *float64 `json:"upi_amount"`
	BankTransferAmount *float64 `json:"bank_transfer_amount"`
	ChequeAmount       *float64 `json:"cheque_amount"`
	ReceivedBankID     *uint    `json:"received_bank_id"`

	ReleaseDate               *string  `json:"release_date"`
	ReleaseCashAmount         *float64 `json:"release_cash_amount"`
	ReleaseUpiAmount          *float64 `json:"release_upi_amount"`
	ReleaseBankTransferAmount *float64 `json:"release_bank_transfer_amount"`
	ReleaseChequeAmount       *float64 `json:"release_cheque_amount"`
	ReleaseBankID             *uint    `json:"release_bank_id"`
}

func (r editBankPledgeRequest) toInput() (*EditBankPledgeInput, error) {
	in := &EditBankPledgeInput{
		BankID: r.BankID, BankName: r.BankName, PledgedAmount: r.PledgedAmount, BankInterestRate: r.BankInterestRate,
		ReferenceNumber: r.ReferenceNumber, CashTreatment: r.CashTreatment, CashAmount: r.CashAmount, UpiAmount: r.UpiAmount,
		BankTransferAmount: r.BankTransferAmount, ChequeAmount: r.ChequeAmount, ReceivedBankID: r.ReceivedBankID,
		ReleaseCashAmount: r.ReleaseCashAmount, ReleaseUpiAmount: r.ReleaseUpiAmount,
		ReleaseBankTransferAmount: r.ReleaseBankTransferAmount, ReleaseChequeAmount: r.ReleaseChequeAmount, ReleaseBankID: r.ReleaseBankID,
	}
	if r.PledgeDate != nil {
		d, err := parseDate(*r.PledgeDate)
		if err != nil {
			return nil, common.NewBadRequest("invalid pledge_date: expected YYYY-MM-DD")
		}
		in.PledgeDate = &d
	}
	if r.ReleaseDate != nil {
		d, err := parseDate(*r.ReleaseDate)
		if err != nil {
			return nil, common.NewBadRequest("invalid release_date: expected YYYY-MM-DD")
		}
		in.ReleaseDate = &d
	}
	if r.BankPledgeDueDate != nil {
		if strings.TrimSpace(*r.BankPledgeDueDate) == "" {
			in.ClearDueDate = true
		} else {
			d, err := parseDate(*r.BankPledgeDueDate)
			if err != nil {
				return nil, common.NewBadRequest("invalid bank_pledge_due_date: expected YYYY-MM-DD")
			}
			in.BankPledgeDueDate = &d
		}
	}
	return in, nil
}

// EditBankPledge is PATCH /loans/:id/bank-pledge/:pledge_id[?dry_run=true].
func EditBankPledge(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	pledgeID, err := common.IDParam(c, "pledge_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if err := checkLoanBranch(ctx, loanID, auth.GetBranchScope(c)); err != nil {
		return common.FailErr(c, err)
	}
	var req editBankPledgeRequest
	if err := common.BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	in, err := req.toInput()
	if err != nil {
		return common.FailErr(c, err)
	}
	dryRun, _ := strconv.ParseBool(c.QueryParam("dry_run"))
	res, err := editBankPledge(ctx, loanID, pledgeID, in, dryRun)
	if err != nil {
		return common.FailErr(c, err)
	}
	if !dryRun {
		actorEmployeeID, _, _ := auth.ActorFromContext(c)
		writeBankPledgeAudit(ctx, actorEmployeeID, "Bank pledge edited", loanID, loanNumberOf(ctx, loanID), res)
	}
	return common.Success(c, http.StatusOK, res)
}

// DeleteBankPledge is DELETE /loans/:id/bank-pledge/:pledge_id[?dry_run=true].
func DeleteBankPledge(c echo.Context) error {
	ctx := auth.RequestContext(c)
	loanID, err := common.IDParam(c, "id")
	if err != nil {
		return common.FailErr(c, err)
	}
	pledgeID, err := common.IDParam(c, "pledge_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	if err := checkLoanBranch(ctx, loanID, auth.GetBranchScope(c)); err != nil {
		return common.FailErr(c, err)
	}
	dryRun, _ := strconv.ParseBool(c.QueryParam("dry_run"))
	res, err := editBankPledge(ctx, loanID, pledgeID, nil, dryRun)
	if err != nil {
		return common.FailErr(c, err)
	}
	if !dryRun {
		actorEmployeeID, _, _ := auth.ActorFromContext(c)
		writeBankPledgeAudit(ctx, actorEmployeeID, "Bank pledge deleted", loanID, loanNumberOf(ctx, loanID), res)
	}
	return common.Success(c, http.StatusOK, res)
}
