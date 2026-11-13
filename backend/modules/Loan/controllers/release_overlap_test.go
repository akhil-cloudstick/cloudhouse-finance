package controllers

// Release request overlap rule (bug 197) and the locked-ornament exclusion (bug 196). Needs the same scratch
// database as release_integration_test.go (skipped without it):
//
//	WHATSAPP_ORIGIN=http://127.0.0.1:1 WHATSAPP_API_KEY=off DB_NAME=ambikagold_scratch MIGRATIONS_DIR=../../../migrations \
//	  go test ./modules/Loan/controllers/ -run IntegrationReleaseOverlap -v

import (
	"strings"
	"testing"

	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
)

func TestIntegrationReleaseOverlap_DifferentOrnamentsAllowed(t *testing.T) {
	ctx := integrationCtx(t)
	id := cloneLoan(t, "Monthly simple interest", 30, 5)
	orn := cloneOrnaments(t, id, 3, 200)
	if _, err := SaveReleaseRequest(ctx, id, ReleaseRequestInput{OrnamentIDs: orn[:1]}); err != nil {
		t.Fatal(err)
	}
	if _, err := SaveReleaseRequest(ctx, id, ReleaseRequestInput{OrnamentIDs: orn[1:2]}); err != nil {
		t.Fatalf("a second request for different ornaments was refused: %v", err)
	}
}

func TestIntegrationReleaseOverlap_OverlapRejected(t *testing.T) {
	ctx := integrationCtx(t)
	id := cloneLoan(t, "Monthly simple interest", 30, 5)
	orn := cloneOrnaments(t, id, 3, 200)
	if _, err := SaveReleaseRequest(ctx, id, ReleaseRequestInput{OrnamentIDs: orn[:2]}); err != nil {
		t.Fatal(err)
	}
	_, err := SaveReleaseRequest(ctx, id, ReleaseRequestInput{OrnamentIDs: orn[1:3]})
	if err == nil || !strings.Contains(err.Error(), "already been requested") {
		t.Fatalf("overlapping request was not refused: %v", err)
	}
}

func TestIntegrationReleaseOverlap_EmptyMeansAllActive(t *testing.T) {
	ctx := integrationCtx(t)
	id := cloneLoan(t, "Monthly simple interest", 30, 5)
	orn := cloneOrnaments(t, id, 3, 200)
	if _, err := SaveReleaseRequest(ctx, id, ReleaseRequestInput{OrnamentIDs: orn[:1]}); err != nil {
		t.Fatal(err)
	}
	if _, err := SaveReleaseRequest(ctx, id, ReleaseRequestInput{}); err == nil {
		t.Fatal("an all-ornaments request was allowed while one ornament is already requested")
	}
}

func TestIntegrationReleaseOverlap_ApprovedIncompleteStillLocks(t *testing.T) {
	ctx := integrationCtx(t)
	id := cloneLoan(t, "Monthly simple interest", 30, 5)
	orn := cloneOrnaments(t, id, 3, 200)
	first, err := SaveReleaseRequest(ctx, id, ReleaseRequestInput{OrnamentIDs: orn[:1]})
	if err != nil {
		t.Fatal(err)
	}
	if err := config.DB.WithContext(ctx).Model(&models.LoanRequest{}).Where("id = ?", first.ID).
		Update("status", models.RequestStatusApproved).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := SaveReleaseRequest(ctx, id, ReleaseRequestInput{OrnamentIDs: orn[:1]}); err == nil {
		t.Fatal("an approved-but-incomplete request did not lock its ornament")
	}
	if _, err := SaveReleaseRequest(ctx, id, ReleaseRequestInput{OrnamentIDs: orn[2:3]}); err != nil {
		t.Fatalf("other ornaments should stay requestable: %v", err)
	}
}

// Bug 196: ornaments locked by an earlier open request are left out of a later request's amount entirely, so
// they are not counted as collateral that stays.
func TestIntegrationReleaseOverlap_LockedOrnamentsExcludedFromAmount(t *testing.T) {
	ctx := integrationCtx(t)
	id := cloneLoan(t, "Monthly simple interest", 30, 5)
	orn := cloneOrnaments(t, id, 3, 200)
	if _, err := SaveReleaseRequest(ctx, id, ReleaseRequestInput{OrnamentIDs: orn[:1]}); err != nil {
		t.Fatal(err)
	}
	second, err := SaveReleaseRequest(ctx, id, ReleaseRequestInput{OrnamentIDs: orn[1:2]})
	if err != nil {
		t.Fatal(err)
	}
	l, _ := GetLoan(ctx, id, nil)
	// Only orn[2] (200) still counts as kept collateral; orn[0] is locked by the earlier request.
	want := l.TotalOutstandingBalance - 200*l.SchemeLTVPercent/100
	if !near(second.SettlementAmount, want) {
		t.Errorf("saved %.2f, want %.2f", second.SettlementAmount, want)
	}
	needed, err := releaseAmountNeeded(ctx, second, nil)
	if err != nil || !near(needed, second.SettlementAmount-second.Charges) {
		t.Errorf("releaseAmountNeeded %.2f (err %v) disagrees with the saved amount %.2f", needed, err, second.SettlementAmount)
	}
}
