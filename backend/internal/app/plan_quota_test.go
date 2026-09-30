package app

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestPlanQuotaEnforced covers the "Up to 5 Branches" and "Unlimited" plans
// end to end through the real router — TestBranchQuotaIsEnforced already
// covers "Single Branch" and the reactivation path.
//
// It also proves the two things a tenant might try over the raw API:
//   - smuggling "tenantId"/"tierId" into the branch body changes nothing
//     (the business and its plan come only from the session), and
//   - GET /branches/quota reports the caller's own plan, never another's.
func TestPlanQuotaEnforced(t *testing.T) {
	h := newHarness(t)
	_, saTok := h.newSuperAdminUser(t, fmt.Sprintf("planprobe-%d", time.Now().UnixNano()))

	var tiers struct {
		Data []struct {
			ID          uint   `json:"id"`
			Name        string `json:"name"`
			BranchQuota uint   `json:"branchQuota"`
		} `json:"data"`
	}
	r := h.do(t, http.MethodGet, "/api/v1/superadmin/tiers", saTok, nil)
	if err := jsonUnmarshal(r.body, &tiers); err != nil {
		t.Fatalf("reading tiers: %v: %s", err, truncate(r.body))
	}
	tierID := map[string]uint{}
	for _, tr := range tiers.Data {
		tierID[tr.Name] = tr.ID
		switch tr.Name {
		case "Single Branch":
			if tr.BranchQuota != 1 {
				t.Errorf("Single Branch quota = %d, want 1", tr.BranchQuota)
			}
		case "Up to 5 Branches":
			if tr.BranchQuota != 5 {
				t.Errorf("Up to 5 Branches quota = %d, want 5", tr.BranchQuota)
			}
		case "Unlimited":
			if tr.BranchQuota != 0 {
				t.Errorf("Unlimited quota = %d, want 0 (unlimited)", tr.BranchQuota)
			}
		}
	}
	for _, name := range []string{"Single Branch", "Up to 5 Branches", "Unlimited"} {
		if tierID[name] == 0 {
			t.Fatalf("plan %q missing from the seeded catalogue: %s", name, truncate(r.body))
		}
	}

	five := planProbeBusiness(t, h, saTok, tierID["Up to 5 Branches"])
	unlimited := planProbeBusiness(t, h, saTok, tierID["Unlimited"])

	// Head Office fills slot 1 of 5; four more fit. The body tries to point
	// each create at the unlimited business and its plan — both ignored.
	smuggle := fmt.Sprintf(`,"tenantId":%d,"tierId":%d`, unlimited.tenantID, tierID["Unlimited"])
	for i := 2; i <= 5; i++ {
		if code, body := planProbeCreateBranch(t, h, five.token, i, smuggle); code != http.StatusCreated {
			t.Fatalf("5-branch plan: branch %d got %d, want 201: %s", i, code, body)
		}
	}
	code, body := planProbeCreateBranch(t, h, five.token, 6, smuggle)
	if code != http.StatusConflict {
		t.Errorf("5-branch plan: 6th branch got %d, want 409: %s", code, body)
	}
	if !strings.Contains(body, "Up to 5 Branches") || !strings.Contains(body, "contact your administrator") {
		t.Errorf("5-branch plan: refusal should name the plan and say to contact the administrator: %s", body)
	}

	// The smuggled tenantId must not have added anything to the unlimited
	// business: it still has only its Head Office.
	assertUsage(t, h, unlimited.token, "Unlimited", 1, true)
	assertUsage(t, h, five.token, "Up to 5 Branches", 5, false)

	// Unlimited: well past every capped plan.
	for i := 2; i <= 12; i++ {
		if code, body := planProbeCreateBranch(t, h, unlimited.token, i, ""); code != http.StatusCreated {
			t.Fatalf("unlimited plan: branch %d got %d, want 201: %s", i, code, body)
		}
	}
	assertUsage(t, h, unlimited.token, "Unlimited", 12, true)
}

type planProbe struct {
	tenantID uint
	token    string
}

// planProbeBusiness creates a business on tierID through the superadmin API
// and logs in as its Administrator.
func planProbeBusiness(t *testing.T, h *harness, saTok string, tierID uint) planProbe {
	t.Helper()
	code := fmt.Sprintf("planprobe%d", time.Now().UnixNano())
	createBody := fmt.Sprintf(`{
		"name": "Plan Probe Co", "code": %q, "tierId": %d,
		"adminUsername": "admin", "adminPassword": "correcthorsebattery",
		"modules": ["branches"],
		"reason": "isolation harness plan-quota proof"
	}`, code, tierID)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/superadmin/businesses", strings.NewReader(createBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+saTok)
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	raw, _ := io.ReadAll(rec.Body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("creating business on tier %d: %d: %s", tierID, rec.Code, truncate(string(raw)))
	}
	var created struct {
		Data struct {
			ID uint `json:"id"`
		} `json:"data"`
	}
	if err := jsonUnmarshal(string(raw), &created); err != nil || created.Data.ID == 0 {
		t.Fatalf("reading created business: %v: %s", err, truncate(string(raw)))
	}

	loginBody := fmt.Sprintf(`{"identifier":"admin","password":"correcthorsebattery","businessCode":%q}`, code)
	lreq := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(loginBody))
	lreq.Header.Set("Content-Type", "application/json")
	lrec := httptest.NewRecorder()
	h.router.ServeHTTP(lrec, lreq)
	lraw, _ := io.ReadAll(lrec.Body)
	var login struct {
		Data struct {
			Token string `json:"token"`
		} `json:"data"`
	}
	if err := jsonUnmarshal(string(lraw), &login); err != nil || login.Data.Token == "" {
		t.Fatalf("logging into plan probe business: %v: %s", err, truncate(string(lraw)))
	}
	return planProbe{tenantID: created.Data.ID, token: login.Data.Token}
}

func planProbeCreateBranch(t *testing.T, h *harness, tok string, n int, extra string) (int, string) {
	t.Helper()
	body := fmt.Sprintf(`{"name":"Branch %d","code":"BR-%02d","address":"x"%s}`, n, n, extra)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/branches", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+tok)
	rec := httptest.NewRecorder()
	h.router.ServeHTTP(rec, req)
	raw, _ := io.ReadAll(rec.Body)
	return rec.Code, truncate(string(raw))
}

func assertUsage(t *testing.T, h *harness, tok, plan string, used int64, unlimited bool) {
	t.Helper()
	r := h.do(t, http.MethodGet, "/api/v1/branches/quota", tok, nil)
	var got struct {
		Data struct {
			Plan      string `json:"plan"`
			Used      int64  `json:"used"`
			Unlimited bool   `json:"unlimited"`
		} `json:"data"`
	}
	if err := jsonUnmarshal(r.body, &got); err != nil {
		t.Fatalf("GET /branches/quota: %v: %s", err, truncate(r.body))
	}
	if got.Data.Plan != plan || got.Data.Used != used || got.Data.Unlimited != unlimited {
		t.Errorf("GET /branches/quota = %+v, want plan %q used %d unlimited %v", got.Data, plan, used, unlimited)
	}
}

// TestBusinessOverviewAndPaymentsStayPerBusiness covers the superadmin
// business detail page: a payment recorded against business A appears only
// in A's overview, never in B's, and cannot be deleted through B's URL.
func TestBusinessOverviewAndPaymentsStayPerBusiness(t *testing.T) {
	h := newHarness(t)
	_, saTok := h.newSuperAdminUser(t, fmt.Sprintf("overviewprobe-%d", time.Now().UnixNano()))

	var tiers struct {
		Data []struct {
			ID   uint   `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	r := h.do(t, http.MethodGet, "/api/v1/superadmin/tiers", saTok, nil)
	if err := jsonUnmarshal(r.body, &tiers); err != nil || len(tiers.Data) == 0 {
		t.Fatalf("reading tiers: %v: %s", err, truncate(r.body))
	}
	a := planProbeBusiness(t, h, saTok, tiers.Data[0].ID)
	b := planProbeBusiness(t, h, saTok, tiers.Data[0].ID)

	send := func(method, path, body string) (int, string) {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+saTok)
		rec := httptest.NewRecorder()
		h.router.ServeHTTP(rec, req)
		raw, _ := io.ReadAll(rec.Body)
		return rec.Code, string(raw)
	}

	code, body := send(http.MethodPost, fmt.Sprintf("/api/v1/superadmin/businesses/%d/payments", a.tenantID),
		`{"amountInPaise":150000,"paidOn":"2026-09-01","mode":"upi","reference":"UPI-OVERVIEWPROBE","note":"September plan"}`)
	if code != http.StatusCreated {
		t.Fatalf("recording a payment for A: %d: %s", code, truncate(body))
	}
	var created struct {
		Data struct {
			ID uint `json:"id"`
		} `json:"data"`
	}
	if err := jsonUnmarshal(body, &created); err != nil || created.Data.ID == 0 {
		t.Fatalf("reading recorded payment: %v: %s", err, truncate(body))
	}

	type overview struct {
		Data struct {
			Business struct {
				ID uint `json:"id"`
			} `json:"business"`
			Usage struct {
				Branches  int64 `json:"branches"`
				Employees int64 `json:"employees"`
			} `json:"usage"`
			Payments  []struct{ ID uint } `json:"payments"`
			TotalPaid int64               `json:"totalPaidInPaise"`
		} `json:"data"`
	}
	var ovA, ovB overview
	_, bodyA := send(http.MethodGet, fmt.Sprintf("/api/v1/superadmin/businesses/%d/overview", a.tenantID), "")
	_, bodyB := send(http.MethodGet, fmt.Sprintf("/api/v1/superadmin/businesses/%d/overview", b.tenantID), "")
	if err := jsonUnmarshal(bodyA, &ovA); err != nil {
		t.Fatalf("overview A: %v: %s", err, truncate(bodyA))
	}
	if err := jsonUnmarshal(bodyB, &ovB); err != nil {
		t.Fatalf("overview B: %v: %s", err, truncate(bodyB))
	}
	if ovA.Data.Business.ID != a.tenantID || len(ovA.Data.Payments) != 1 || ovA.Data.TotalPaid != 150000 {
		t.Errorf("overview A = %+v, want business %d with exactly one ₹1500 payment: %s", ovA.Data, a.tenantID, truncate(bodyA))
	}
	if ovA.Data.Usage.Branches != 1 || ovA.Data.Usage.Employees != 1 {
		t.Errorf("overview A usage = %+v, want the new business's 1 branch and 1 employee", ovA.Data.Usage)
	}
	if len(ovB.Data.Payments) != 0 || ovB.Data.TotalPaid != 0 || strings.Contains(bodyB, "UPI-OVERVIEWPROBE") {
		t.Errorf("CROSS-BUSINESS LEAK: B's overview shows A's payment: %s", truncate(bodyB))
	}

	// A's payment id through B's URL must be refused, and must survive.
	code, body = send(http.MethodDelete,
		fmt.Sprintf("/api/v1/superadmin/businesses/%d/payments/%d", b.tenantID, created.Data.ID), `{"reason":"probe"}`)
	if code != http.StatusNotFound {
		t.Errorf("deleting A's payment through B's URL got %d, want 404: %s", code, truncate(body))
	}
	_, bodyA = send(http.MethodGet, fmt.Sprintf("/api/v1/superadmin/businesses/%d/payments", a.tenantID), "")
	if !strings.Contains(bodyA, "UPI-OVERVIEWPROBE") {
		t.Errorf("A's payment disappeared after a refused cross-business delete: %s", truncate(bodyA))
	}

	// Validation: zero amount, unknown mode, future date.
	for _, bad := range []string{
		`{"amountInPaise":0,"paidOn":"2026-09-01","mode":"upi"}`,
		`{"amountInPaise":100,"paidOn":"2026-09-01","mode":"bitcoin"}`,
		`{"amountInPaise":100,"paidOn":"2999-01-01","mode":"cash"}`,
	} {
		if code, body := send(http.MethodPost, fmt.Sprintf("/api/v1/superadmin/businesses/%d/payments", a.tenantID), bad); code != http.StatusBadRequest {
			t.Errorf("invalid payment %s got %d, want 400: %s", bad, code, truncate(body))
		}
	}
}
