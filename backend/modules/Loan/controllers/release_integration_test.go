package controllers

// Runs the release rules against a real database, like integration_minimum_period_test.go (same scratch database,
// same refusal to run anywhere else). WhatsApp must point nowhere, or a release notifies the template loan's
// real customer:
//
//	WHATSAPP_ORIGIN=http://127.0.0.1:1 WHATSAPP_API_KEY=off DB_NAME=ambikagold_scratch MIGRATIONS_DIR=../../../migrations \
//	  go test ./modules/Loan/controllers/ -run IntegrationRelease -v

import (
	"context"
	"strings"
	"testing"

	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/Loan/models"
	packet "cloudhouse/backend/modules/Packet/controllers"
	packetModels "cloudhouse/backend/modules/Packet/models"

	"gorm.io/gorm"
)

const (
	// tenant 5's Administrator role (holds "can verify release checklist") and one of its employees.
	scratchRole     = uint(19)
	scratchEmployee = uint(21)
)

// cloneOrnaments gives the loan `n` ornaments worth `value` each, copied from the template loan's.
func cloneOrnaments(t *testing.T, loanID uint, n int, value float64) []uint {
	t.Helper()
	var ids []uint
	for i := 0; i < n; i++ {
		var id uint
		err := config.BaseDB.Transaction(func(tx *gorm.DB) error {
			if err := tx.Exec(`CREATE TEMP TABLE tmp_orn ON COMMIT DROP AS SELECT * FROM ornaments WHERE loan_id = ? ORDER BY id LIMIT 1`, scratchTemplate).Error; err != nil {
				return err
			}
			if err := tx.Exec(`UPDATE tmp_orn SET id = nextval(pg_get_serial_sequence('ornaments','id')), loan_id = ?, gold_value = ?, released_at = NULL`, loanID, value).Error; err != nil {
				return err
			}
			if err := tx.Exec(`INSERT INTO ornaments SELECT * FROM tmp_orn`).Error; err != nil {
				return err
			}
			return tx.Raw(`SELECT max(id) FROM ornaments WHERE loan_id = ?`, loanID).Scan(&id).Error
		})
		if err != nil || id == 0 {
			t.Fatalf("could not create a test ornament: %v", err)
		}
		ids = append(ids, id)
	}
	return ids
}

func payRelease(ctx context.Context, requestID uint, amount float64) (*models.LoanRequest, error) {
	return recordReleaseRequestPayment(ctx, requestID, nil, ReleasePaymentInput{
		Type: models.PaymentTypePartial, Amount: amount, Method: "Cash", CashAmount: amount,
		ActorEmployeeID: scratchEmployee, ActorRoleID: scratchRole,
	})
}

func outstanding(t *testing.T, ctx context.Context, loanID uint) float64 {
	t.Helper()
	l, err := GetLoan(ctx, loanID, nil)
	if err != nil {
		t.Fatal(err)
	}
	return l.TotalOutstandingBalance
}

// A request logged for a full release carries the loan's whole balance; a partial one carries what the
// ornaments that stay can't support. Neither includes any buffer.
func TestIntegrationRelease_AmountSavedWhenLogged(t *testing.T) {
	ctx := integrationCtx(t)

	full := cloneLoan(t, "Monthly simple interest", 30, 5)
	cloneOrnaments(t, full, 3, 200)
	req, err := SaveReleaseRequest(ctx, full, ReleaseRequestInput{})
	if err != nil {
		t.Fatal(err)
	}
	if want := outstanding(t, ctx, full); !near(req.SettlementAmount, want) || want < 900 {
		t.Errorf("full release: saved %.2f, balance %.2f", req.SettlementAmount, want)
	}

	part := cloneLoan(t, "Monthly simple interest", 30, 5)
	orn := cloneOrnaments(t, part, 3, 200)
	req, err = SaveReleaseRequest(ctx, part, ReleaseRequestInput{OrnamentIDs: orn[:1]})
	if err != nil {
		t.Fatal(err)
	}
	l, _ := GetLoan(ctx, part, nil)
	want := l.TotalOutstandingBalance - 400*l.SchemeLTVPercent/100 // two ornaments of 200 stay
	if want < 500 || !near(req.SettlementAmount, want) {
		t.Errorf("partial release: saved %.2f, want %.2f (balance %.2f, LTV %.0f%%)", req.SettlementAmount, want, l.TotalOutstandingBalance, l.SchemeLTVPercent)
	}
	t.Logf("full ₹%.2f saved; partial ₹%.2f saved (balance ₹%.2f, LTV %.0f%%)", outstanding(t, ctx, full), req.SettlementAmount, l.TotalOutstandingBalance, l.SchemeLTVPercent)
}

// A payment short of the amount needed is refused before anything is posted; one that covers it is accepted
// and marks the request.
func TestIntegrationRelease_PaymentMustCoverAmount(t *testing.T) {
	ctx := integrationCtx(t)
	for _, partial := range []bool{false, true} {
		id := cloneLoan(t, "Monthly simple interest", 30, 5)
		orn := cloneOrnaments(t, id, 3, 200)
		var ids []uint
		if partial {
			ids = orn[:1]
		}
		req, err := SaveReleaseRequest(ctx, id, ReleaseRequestInput{OrnamentIDs: ids})
		if err != nil {
			t.Fatal(err)
		}
		needed, err := releaseAmountNeeded(ctx, req, nil)
		if err != nil || needed < 500 {
			t.Fatalf("partial=%v: needed %.2f, err %v", partial, needed, err)
		}
		before := outstanding(t, ctx, id)

		_, err = payRelease(ctx, req.ID, needed-5)
		if err == nil || !strings.Contains(err.Error(), "short") {
			t.Fatalf("partial=%v: a payment ₹5 short was not refused: %v", partial, err)
		}
		t.Logf("partial=%v: refused — %v", partial, err)
		if after := outstanding(t, ctx, id); !near(after, before) {
			t.Errorf("partial=%v: the refused payment still moved the balance %.2f -> %.2f", partial, before, after)
		}

		got, err := payRelease(ctx, req.ID, needed)
		if err != nil {
			t.Fatalf("partial=%v: a payment covering the amount was refused: %v", partial, err)
		}
		if !got.QuoteMet || !got.PaymentRecorded || !near(got.SettlementAmount, needed+got.Charges) {
			t.Errorf("partial=%v: quote_met=%v recorded=%v settlement=%.2f, want %.2f", partial, got.QuoteMet, got.PaymentRecorded, got.SettlementAmount, needed)
		}
	}
}

// useTwoStageChain puts the scratch tenant's gold release behind two approvals (Branch Manager, then Management)
// for the length of the test, so a payment leaves the request waiting.
func useTwoStageChain(t *testing.T) {
	t.Helper()
	del := func() {
		config.BaseDB.Exec(`DELETE FROM approval_chains WHERE tenant_id = ? AND scope = ?`, scratchTenant, common.FlowLoanRelease)
	}
	del()
	if err := config.BaseDB.Exec(`INSERT INTO approval_chains (tenant_id, scope, role_ids, updated_at) VALUES (?, ?, '21,20', now())`, scratchTenant, common.FlowLoanRelease).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(del)
}

// approveThroughChain approves the request at each stage in turn, as the staff would.
func approveThroughChain(t *testing.T, ctx context.Context, requestID, loanID uint) {
	t.Helper()
	for i := 0; i < 3; i++ {
		cur, err := findLoanRequestByID(ctx, requestID)
		if err != nil {
			t.Fatal(err)
		}
		if cur.Status != models.RequestStatusPending {
			return
		}
		stage := cur.ApprovalStage
		if stage == "" {
			stage = models.ApprovalStagePendingManager
		}
		chain, _ := loanChain(ctx, common.FlowLoanRelease)
		step, ok := chain.ByPending(stage)
		if !ok {
			t.Fatalf("no approval stage for %q", stage)
		}
		if _, err := ApproveReleaseRequest(ctx, requestID, nil, ReleaseApprovalInput{
			Stage: step.Key, Action: models.ApprovalStageApproved, ActorEmployeeID: scratchEmployee, ActorRoleID: step.RoleID,
		}); err != nil {
			t.Fatalf("approving at stage %q (balance ₹%.2f): %v", step.Label, outstanding(t, ctx, loanID), err)
		}
		t.Logf("approved at stage %q", step.Label)
	}
}

func packetOf(t *testing.T, loanID uint) (status string, netWeight float64) {
	t.Helper()
	if err := config.BaseDB.Raw(`SELECT status, total_net_weight FROM packets WHERE loan_id = ? ORDER BY id DESC LIMIT 1`, loanID).Row().Scan(&status, &netWeight); err != nil {
		t.Fatal(err)
	}
	return
}

// A full release goes through both approvals, closes the loan and — although the packet was never checked
// into a locker — marks it Released.
func TestIntegrationRelease_FullReleaseThroughChainReleasesPacket(t *testing.T) {
	ctx := integrationCtx(t)
	useTwoStageChain(t)

	id := cloneLoan(t, "Monthly simple interest", 0, 5)
	cloneOrnaments(t, id, 2, 200)
	if err := packet.CreatePacketForLoan(ctx, id, nil); err != nil {
		t.Fatal(err)
	}
	if status, _ := packetOf(t, id); status != "Packet Generated" {
		t.Fatalf("packet before release: %q", status)
	}
	req, err := SaveReleaseRequest(ctx, id, ReleaseRequestInput{})
	if err != nil {
		t.Fatal(err)
	}
	if err := config.BaseDB.Exec(`UPDATE loan_requests SET customer_saw_gold = true WHERE id = ?`, req.ID).Error; err != nil {
		t.Fatal(err)
	}
	needed, _ := releaseAmountNeeded(ctx, req, nil)
	paid, err := payRelease(ctx, req.ID, needed)
	if err != nil {
		t.Fatal(err)
	}
	if paid.Status != models.RequestStatusPending {
		t.Fatalf("expected the request to wait for approval after the payment, got %q", paid.Status)
	}
	approveThroughChain(t, ctx, req.ID, id)

	if l, _ := GetLoan(ctx, id, nil); l.Status != models.StatusClosed {
		t.Errorf("loan status %q, want Closed", l.Status)
	}
	if status, _ := packetOf(t, id); status != packetModels.StatusReleased {
		t.Errorf("packet status %q, want Released", status)
	}
}

// A partial release stays Active, so interest keeps building between the payment and the approvals. That used to
// make the last approval fail ("drifted above what the remaining collateral supports"); now it goes through, the
// chosen ornament is released and the packet's weight comes down.
func TestIntegrationRelease_PartialReleaseSurvivesInterestAfterPayment(t *testing.T) {
	ctx := integrationCtx(t)
	useTwoStageChain(t)

	id := cloneLoan(t, "Monthly simple interest", 0, 5)
	orn := cloneOrnaments(t, id, 3, 200)
	if err := packet.CreatePacketForLoan(ctx, id, nil); err != nil {
		t.Fatal(err)
	}
	_, weightBefore := packetOf(t, id)
	req, err := SaveReleaseRequest(ctx, id, ReleaseRequestInput{OrnamentIDs: orn[:1]})
	if err != nil {
		t.Fatal(err)
	}
	if err := config.BaseDB.Exec(`UPDATE loan_requests SET customer_saw_gold = true WHERE id = ?`, req.ID).Error; err != nil {
		t.Fatal(err)
	}
	needed, _ := releaseAmountNeeded(ctx, req, nil)
	if _, err := payRelease(ctx, req.ID, needed); err != nil {
		t.Fatal(err)
	}

	// 20 more days of interest build up before the approvals.
	if err := config.BaseDB.Exec(`UPDATE loans SET opened_date = opened_date - interval '20 days', last_accrual_date = last_accrual_date - interval '20 days' WHERE id = ?`, id).Error; err != nil {
		t.Fatal(err)
	}
	l, _ := GetLoan(ctx, id, nil)
	if drift := partialReleaseDrift(l.TotalOutstandingBalance, 400, l.SchemeLTVPercent); drift <= 0.01 {
		t.Fatalf("test setup: no drift built up after the payment (drift %.4f, balance %.2f)", drift, l.TotalOutstandingBalance)
	} else {
		t.Logf("drift before approval: ₹%.2f (balance ₹%.2f) — the old check would have refused", drift, l.TotalOutstandingBalance)
	}
	approveThroughChain(t, ctx, req.ID, id)

	var releasedAt *string
	config.BaseDB.Raw(`SELECT released_at::text FROM ornaments WHERE id = ?`, orn[0]).Scan(&releasedAt)
	if releasedAt == nil {
		t.Error("the chosen ornament was not released")
	}
	var keptReleased int
	config.BaseDB.Raw(`SELECT count(*) FROM ornaments WHERE id IN (?, ?) AND released_at IS NOT NULL`, orn[1], orn[2]).Scan(&keptReleased)
	if keptReleased != 0 {
		t.Errorf("%d ornament(s) that should have stayed were released", keptReleased)
	}
	if l, _ := GetLoan(ctx, id, nil); l.Status == models.StatusClosed {
		t.Error("a partial release closed the loan")
	}
	status, weightAfter := packetOf(t, id)
	if status != "Packet Generated" || !(weightAfter < weightBefore) {
		t.Errorf("packet: status %q (want unchanged), net weight %.3f -> %.3f (want lower)", status, weightBefore, weightAfter)
	}
}

// Without the quote check passing, the old rule still holds: an unpaid balance blocks a full release.
func TestIntegrationRelease_UnpaidBalanceStillBlocksFullRelease(t *testing.T) {
	ctx := integrationCtx(t)
	id := cloneLoan(t, "Monthly simple interest", 30, 5)
	cloneOrnaments(t, id, 2, 200)
	if _, err := SaveReleaseRequest(ctx, id, ReleaseRequestInput{}); err != nil {
		t.Fatal(err)
	}
	if err := config.BaseDB.Exec(`UPDATE loan_requests SET status = 'Approved', approval_stage = 'Approved' WHERE loan_id = ?`, id).Error; err != nil {
		t.Fatal(err)
	}
	_, err := completeRelease(ctx, id, nil, scratchEmployee)
	if err == nil || !strings.Contains(err.Error(), "not been fully paid") {
		t.Fatalf("an unpaid, unverified release went through: %v", err)
	}
}
