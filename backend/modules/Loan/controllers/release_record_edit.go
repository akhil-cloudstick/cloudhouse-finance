package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

// A gold-release request record (the request, its checklist notes, its dates) can be corrected or removed here.
// The money a release took is NOT edited here: it is booked as ordinary loan payments (Partial / Discount) that
// the ledger already edits and deletes through rebuild.go, which recalculates the loan. Completing a release
// (gold handed back, loan closed, ornaments marked released, packet moved) is not undone by this endpoint.

type editReleaseRecordRequest struct {
	RequestedAt       *string `json:"requested_at"`
	Remarks           *string `json:"remarks"`
	VerificationNotes *string `json:"verification_notes"`
}

func loadReleaseRequest(ctx context.Context, tx *gorm.DB, requestID uint, branchID *uint) (*models.LoanRequest, error) {
	var req models.LoanRequest
	if err := tx.WithContext(ctx).First(&req, requestID).Error; err != nil {
		return nil, common.NewNotFound("loan request not found")
	}
	if err := checkLoanBranch(ctx, req.LoanID, branchID); err != nil {
		return nil, err
	}
	if req.Type != models.RequestTypeRelease {
		return nil, common.NewBadRequest("this request is not a Release request")
	}
	return &req, nil
}

// EditReleaseRecord is PATCH /loans/requests/:request_id/release-record.
func EditReleaseRecord(c echo.Context) error {
	ctx := auth.RequestContext(c)
	requestID, err := common.IDParam(c, "request_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	var body editReleaseRecordRequest
	if err := common.BindJSON(c, &body); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	req, err := loadReleaseRequest(ctx, config.DB.WithContext(ctx), requestID, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	old := *req
	if body.RequestedAt != nil {
		d, err := parseDate(*body.RequestedAt)
		if err != nil {
			return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "invalid requested_at: expected YYYY-MM-DD"})
		}
		req.RequestedAt = sameDayKeep(&d, req.RequestedAt)
	}
	if body.Remarks != nil {
		req.Remarks = strings.TrimSpace(*body.Remarks)
	}
	if body.VerificationNotes != nil {
		req.VerificationNotes = strings.TrimSpace(*body.VerificationNotes)
	}
	if len(req.Remarks) > 255 || len(req.VerificationNotes) > 255 {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "notes can be at most 255 characters"})
	}
	if err := persistLoanRequest(ctx, req); err != nil {
		return common.FailErr(c, err)
	}
	writeReleaseRecordAudit(ctx, c, "Release record edited", &old, req)
	return common.Success(c, http.StatusOK, req)
}

// DeleteReleaseRecord is DELETE /loans/requests/:request_id/release-record. Only a request that has not taken any
// money and has not been approved can be removed; otherwise 409.
func DeleteReleaseRecord(c echo.Context) error {
	ctx := auth.RequestContext(c)
	requestID, err := common.IDParam(c, "request_id")
	if err != nil {
		return common.FailErr(c, err)
	}
	req, err := loadReleaseRequest(ctx, config.DB.WithContext(ctx), requestID, auth.GetBranchScope(c))
	if err != nil {
		return common.FailErr(c, err)
	}
	if req.Status == models.RequestStatusApproved {
		return common.FailErr(c, common.NewConflict("an approved release request cannot be deleted — the release was completed from it"))
	}
	if req.PaymentRecorded || req.Locked || req.RecordedPayment > 0 || req.RecordedDiscount > 0 {
		return common.FailErr(c, common.NewConflict("a payment was already recorded against this release request — delete or edit that payment in the ledger first"))
	}
	err = config.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("request_id = ?", req.ID).Delete(&models.LoanRequestOrnament{}).Error; err != nil {
			return err
		}
		if err := tx.Where("request_id = ?", req.ID).Delete(&models.RequestApproval{}).Error; err != nil {
			return err
		}
		return tx.Delete(&models.LoanRequest{}, req.ID).Error
	})
	if err != nil {
		return common.FailErr(c, err)
	}
	writeReleaseRecordAudit(ctx, c, "Release record deleted", req, nil)
	return common.Success(c, http.StatusOK, echo.Map{"deleted": true})
}

func writeReleaseRecordAudit(ctx context.Context, c echo.Context, action string, old, now *models.LoanRequest) {
	actorEmployeeID, _, _ := auth.ActorFromContext(c)
	actorName := "unknown"
	if actor, err := common.FindEmployeeByID(ctx, actorEmployeeID); err == nil {
		actorName = actor.Name
	}
	detail := fmt.Sprintf("release request #%d before: requested_at=%s remarks=%q notes=%q", old.ID, old.RequestedAt.Format(time.RFC3339), old.Remarks, old.VerificationNotes)
	if now != nil {
		detail += fmt.Sprintf(" | after: requested_at=%s remarks=%q notes=%q", now.RequestedAt.Format(time.RFC3339), now.Remarks, now.VerificationNotes)
	}
	_ = common.InsertAuditLog(ctx, &commonModels.Entry{
		ActorEmployeeID: actorEmployeeID, ActorName: actorName, Action: action,
		EntityType: "loan", EntityID: old.LoanID, EntityName: loanNumberOf(ctx, old.LoanID), Detail: detail,
	})
}
