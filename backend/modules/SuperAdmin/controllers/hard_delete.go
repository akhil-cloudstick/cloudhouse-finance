package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"cloudhouse/backend/modules/SuperAdmin/models"
	"context"
	"fmt"
	"os"
	"path/filepath"

	"gorm.io/gorm"
)

var hardDeleteOrder = []string{
	"loan_request_ornaments",
	"loan_top_ups",
	"personal_loan_history",
	"investment_transactions",
	"ornament_purity_tests",
	"ornament_images",
	"packet_movements",
	"auction_events",
	"auction_notices",
	"auction_decision_requests",
	"request_approvals",
	"bank_pledge_events",
	"personal_loan_payments",
	"personal_loan_installments",
	"investment_payouts",
	"loan_draft_ornaments",
	"loan_approvals",
	"loan_payments",
	"auction_records",
	"loan_requests",
	"bank_pledge_records",
	"packets",
	"ornaments",
	"reminders",
	"notifications",
	"investments",
	"personal_loans",
	"loan_drafts",
	"loans",
	"gold_sales",
	"cash_movements",
	"customer_otp",
	"customer_device_tokens",
	"customers",
	"investment_plans",
	"schemes",
	"lockers",
	"banks",
	"ornament_types",
	"gold_rates",
	"expenses",
	"opening_cash_balances",
	"approval_limits",
	"approval_stage_settings",
	"approval_actions",
	"communication_logs",
	"audit_log_entries",
	"purity_standards",
	"uploaded_files",
	"employees",
	"role_permissions",
	"roles",
	"branches",
	"sequences",
	"usage_counters",
}

var hardDeleteUntenanted = map[string]bool{
	"investments":        true,
	"investment_plans":   true,
	"investment_payouts": true,
}

var hardDeleteChildOf = map[string]struct{ fk, parent string }{
	"loan_request_ornaments":     {"request_id", "loan_requests"},
	"loan_top_ups":               {"loan_id", "loans"},
	"personal_loan_history":      {"personal_loan_id", "personal_loans"},
	"investment_transactions":    {"investment_id", "investments"},
	"ornament_purity_tests":      {"ornament_id", "ornaments"},
	"ornament_images":            {"ornament_id", "ornaments"},
	"packet_movements":           {"packet_id", "packets"},
	"auction_events":             {"auction_record_id", "auction_records"},
	"auction_notices":            {"auction_record_id", "auction_records"},
	"auction_decision_requests":  {"auction_record_id", "auction_records"},
	"bank_pledge_events":         {"bank_pledge_record_id", "bank_pledge_records"},
	"personal_loan_payments":     {"personal_loan_id", "personal_loans"},
	"personal_loan_installments": {"personal_loan_id", "personal_loans"},
	"investment_payouts":         {"investment_id", "investments"},
	"loan_draft_ornaments":       {"draft_id", "loan_drafts"},
	"loan_approvals":             {"loan_id", "loans"},
	"loan_payments":              {"loan_id", "loans"},
	"loan_requests":              {"loan_id", "loans"},
	"bank_pledge_records":        {"loan_id", "loans"},
	"packets":                    {"loan_id", "loans"},
	"ornaments":                  {"loan_id", "loans"},
	"reminders":                  {"customer_id", "customers"},
	"personal_loans":             {"customer_id", "customers"},
	"loan_drafts":                {"customer_id", "customers"},
	"investments":                {"customer_id", "customers"},
	"loans":                      {"customer_id", "customers"},
	"cash_movements":             {"party_customer_id", "customers"},
}

func hardDeletePredicate(table string, tenantID uint) string {
	clause := fmt.Sprintf("%s.tenant_id = %d", table, tenantID)
	if hardDeleteUntenanted[table] {
		clause = fmt.Sprintf("(%s OR %s.tenant_id = 0 OR %s.tenant_id IS NULL)",
			clause, table, table)
	}
	c, ok := hardDeleteChildOf[table]
	if !ok {
		return clause
	}
	return fmt.Sprintf("(%s OR %s.%s IN (SELECT %s.id FROM %s WHERE %s))",
		clause, table, c.fk, c.parent, c.parent, hardDeletePredicate(c.parent, tenantID))
}

func hardDeleteFromTable(tx *gorm.DB, table string, tenantID uint) error {
	return tx.Exec("DELETE FROM " + table + " WHERE " + hardDeletePredicate(table, tenantID)).Error
}

func hardDeleteBusiness(ctx context.Context, actor *models.SuperAdminUser, id uint, reason string) error {
	if err := validateReason(reason); err != nil {
		return err
	}
	crossCtx := config.AllowCrossTenant(ctx)
	t, err := common.FindTenantByID(crossCtx, id)
	if err != nil {
		return common.NewNotFound("business not found")
	}
	name, code := t.Name, t.Code
	err = config.BaseDB.
		WithContext(crossCtx).Transaction(func(tx *gorm.DB) error {
		for _, table := range hardDeleteOrder {
			if err := hardDeleteFromTable(tx, table, id); err != nil {
				return fmt.Errorf("delete %s: %w", table, err)
			}
		}
		return tx.Unscoped().Exec("DELETE FROM tenants WHERE id = ?", id).Error
	})
	if err != nil {
		return fmt.Errorf("hard delete business %d: %w", id, err)
	}
	removeBusinessUploads(config.Env.UploadsDir,
		id)
	auditBusiness(ctx, actor, "delete_business", nil, name,
		fmt.Sprintf("business %q (code %s) permanently deleted — all data and files removed", name, code), reason)
	return nil
}

func removeBusinessUploads(uploadsDir string, tenantID uint) {
	if uploadsDir == "" {
		return
	}
	dir := common.TenantDir(uploadsDir, tenantID)
	abs, err := filepath.Abs(dir)
	if err != nil {
		fmt.Printf("superadmin: hard delete business %d: resolve uploads dir: %v\n", tenantID, err)
		return
	}
	// Refuse to sweep a root or empty path — an id of 0 must never turn into os.RemoveAll(uploadsRoot).
	root, err := filepath.Abs(uploadsDir)
	if err != nil || abs == root || abs == filepath.VolumeName(abs)+string(filepath.Separator) {
		fmt.Printf("superadmin: hard delete business %d: refusing to sweep uploads dir %q\n", tenantID, abs)
		return
	}
	if err := os.RemoveAll(abs); err != nil {
		fmt.Printf("superadmin: hard delete business %d: remove uploads dir %q: %v\n", tenantID, abs, err)
	}
}
