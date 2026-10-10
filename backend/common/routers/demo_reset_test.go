package routers

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"cloudhouse/backend/auth"
	"cloudhouse/backend/config"
)

func TestDemoResetSeedsCurrentSchema(t *testing.T) {
	h := newHarness(t)
	ctx := config.AllowCrossTenant(context.Background())
	if err := h.db.WithContext(ctx).Exec(`UPDATE tenants SET enabled_modules = CASE WHEN COALESCE(enabled_modules, '') = '' THEN 'demo_reset' ELSE enabled_modules || ',demo_reset' END WHERE id = ?`, h.a.id).Error; err != nil {
		t.Fatalf("enabling the demo reset module: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, h.selfPath(t, "/api/v1/users/:user_id/demo/reset?seed=true", h.a.tokens["Administrator"]), nil)
	req.Header.Set("Authorization", "Bearer "+h.a.tokens["Administrator"])
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST demo/reset: %d: %s", rec.Code, truncate(rec.Body.String()))
	}
	var last struct {
		Error string `json:"error"`
		Done  bool   `json:"done"`
		Step  string `json:"step"`
	}
	steps := 0
	sc := bufio.NewScanner(strings.NewReader(rec.Body.String()))
	sc.Buffer(make([]byte, 1<<20), 1<<24)
	for sc.Scan() {
		if strings.TrimSpace(sc.Text()) == "" {
			continue
		}
		if err := json.Unmarshal(sc.Bytes(), &last); err != nil {
			t.Fatalf("unparseable progress line %q: %v", sc.Text(), err)
		}
		if last.Error != "" {
			t.Fatalf("demo reset failed after %d steps: %s", steps, last.Error)
		}
		steps++
	}
	if !last.Done {
		t.Fatalf("demo reset stream ended without done after %d steps (last step %q)", steps, last.Step)
	}
	for _, table := range []string{
		"branches", "employees", "schemes", "gold_rates", "customers", "loans", "ornaments", "loan_payments",
		"packets", "loan_requests", "auction_records", "personal_loans", "investments", "cash_movements",
		"expenses", "reminders", "communication_logs",
	} {
		var n int64
		if err := h.db.WithContext(ctx).Table(table).Where("tenant_id = ?", h.a.id).Count(&n).Error; err != nil {
			t.Errorf("counting %s: %v", table, err)
			continue
		}
		if n == 0 {
			t.Errorf("demo reset left %s empty", table)
		}
	}
	claims, err := auth.ParseToken(h.a.tokens["Administrator"], h.cfg.JWTSecret)
	if err != nil {
		t.Fatalf("reading the administrator token: %v", err)
	}
	var admins int64
	if err := h.db.WithContext(ctx).Table("employees").Where("tenant_id = ? AND id = ?", h.a.id, claims.EmployeeID).Count(&admins).Error; err != nil || admins != 1 {
		t.Errorf("the administrator who pressed reset must survive it (found %d, err %v)", admins, err)
	}
	t.Logf("demo reset finished in %d progress lines", steps)
}
