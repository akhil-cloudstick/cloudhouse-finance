package demoseed

import (
	"context"
	"fmt"
	"time"

	"cloudhouse/backend/internal/auditlog"
	"cloudhouse/backend/internal/cash"
	"cloudhouse/backend/internal/commlog"
	"cloudhouse/backend/internal/dashboard"
	"cloudhouse/backend/internal/notification"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/reminder"
)

// cashMovementFixture is one till movement not already produced by a loan,
// pledge or investment flow.
//
// A non-Cash mode, or a movement sourced from "Loan", requires a bank name —
// cash.MovementService.Record rejects it otherwise. Every row below that
// needs one has one.
var cashMovementFixtures = []struct {
	Type, Source, Purpose, Mode, Bank, Status string
	Amount                                    float64
	DaysAgo                                   int
}{
	{"in", "Savings", "", "Cash", "", "Closed", 150000, 20},
	{"in", "Savings", "", "UPI", "State Bank of India", "Closed", 85000, 18},
	{"in", "Loan", "", "Bank Transfer", "Federal Bank", "Open", 250000, 16},
	{"in", "Savings", "", "Cash", "", "Closed", 60000, 14},
	{"in", "Savings", "", "UPI", "Canara Bank", "Open", 42000, 12},
	{"out", "", "Branch float top-up", "Cash", "", "Closed", 30000, 11},
	{"out", "", "Vault cash deposit", "Bank Transfer", "South Indian Bank", "Closed", 200000, 9},
	{"out", "", "Petty cash issue", "Cash", "", "Closed", 5000, 7},
	{"out", "", "Inter-branch transfer", "Bank Transfer", "Union Bank of India", "Open", 120000, 5},
	{"out", "", "Bank charges settlement", "UPI", "Bank of Baroda", "Closed", 2500, 3},
	{"in", "Savings", "", "Cash", "", "Closed", 95000, 2},
	{"out", "", "Staff advance", "Cash", "", "Closed", 15000, 1},
}

// seedCashAndExpenses fills the cash book: opening balances per branch,
// explicit till movements, and the operating expenses across their approval
// states.
//
// The loan, pledge, auction and investment flows have already produced a good
// number of cash_movements rows through the real cashRecorder, so the twelve
// here are additions rather than the whole picture.
func seedCashAndExpenses(ctx context.Context, d *Deps, st *state, rep *Report) error {
	// Today and yesterday, because a cash book has an opening balance per
	// branch per DAY — one day only would leave the day-over-day comparison
	// on the cash screen with nothing to compare against.
	balances := 0
	for _, day := range []time.Time{st.clk.daysAgo(1), st.clk.today} {
		for i, branchID := range st.branchIDs {
			// Varied by branch so the branch filter visibly changes the
			// figures rather than showing the same number everywhere.
			amount := float64(75000 + i*15000)
			if _, err := d.openingSvc.Set(ctx, branchID, day, cash.CashModeCash, nil, nil, amount); err != nil {
				return fmt.Errorf("set opening balance for branch %d on %s: %w",
					branchID, day.Format("2006-01-02"), err)
			}
			balances++
		}
	}
	rep.created("opening cash balances", balances)

	for i, f := range cashMovementFixtures {
		branchID := st.branchIDs[i%len(st.branchIDs)]
		if _, err := d.movementSvc.Record(ctx, cash.RecordMovementInput{
			Type:       f.Type,
			Source:     f.Source,
			Purpose:    f.Purpose,
			Mode:       f.Mode,
			Bank:       f.Bank,
			Amount:     f.Amount,
			BranchID:   &branchID,
			OccurredOn: st.clk.daysAgo(f.DaysAgo),
		}, nil); err != nil {
			return fmt.Errorf("record cash movement %d: %w", i+1, err)
		}
	}
	rep.created("cash movements", len(cashMovementFixtures))

	// Expenses, then a decision pass so the approval queue is not uniformly
	// pending: eight approved, two rejected, five left waiting.
	expenseIDs := make([]uint, 0, len(expenseFixtures))
	for i, f := range expenseFixtures {
		var receipt string
		if i < 4 && i < len(st.uploadKeys) {
			receipt = st.uploadKeys[i]
		}
		e, err := d.expenseSvc.Record(ctx, cash.RecordExpenseInput{
			OccurredOn:   st.clk.daysAgo(2 + i*2),
			Category:     f.Category,
			Amount:       f.Amount,
			Mode:         f.Mode,
			Payee:        f.Payee,
			BranchID:     st.branchIDs[i%len(st.branchIDs)],
			Remarks:      f.Remarks,
			ReceiptImage: receipt,
		})
		if err != nil {
			return fmt.Errorf("record expense %q: %w", f.Category, err)
		}
		expenseIDs = append(expenseIDs, e.ID)
	}
	rep.created("expenses", len(expenseIDs))

	for i, id := range expenseIDs {
		switch {
		case i < 8:
			if _, err := d.expenseSvc.Approve(ctx, id, "Admin", nil); err != nil {
				return fmt.Errorf("approve expense %d: %w", id, err)
			}
		case i < 10:
			if _, err := d.expenseSvc.Reject(ctx, id, "Admin", "Not budgeted this quarter", nil); err != nil {
				return fmt.Errorf("reject expense %d: %w", id, err)
			}
		}
	}

	return nil
}

// seedReminders fills the follow-up calendar, spread from three days ago to a
// month ahead so overdue, today and upcoming all have entries.
func seedReminders(ctx context.Context, d *Deps, st *state, rep *Report) error {
	if len(st.customerIDs) == 0 {
		return nil
	}

	ids := make([]uint, 0, len(reminderFixtures))
	for i, f := range reminderFixtures {
		in := reminder.CreateInput{
			CustomerID:          st.customerIDs[i%len(st.customerIDs)],
			Type:                f.Type,
			DueDate:             st.clk.daysAhead(f.DueInDays),
			Note:                f.Note,
			CreatedByEmployeeID: st.keep.adminID,
		}
		// Attach roughly half to a loan, so the calendar shows both
		// loan-linked and standalone follow-ups.
		if i%2 == 0 && i < len(st.loanIDs) {
			id := st.loanIDs[i]
			in.LoanID = &id
		}
		r, err := d.reminderSvc.Create(ctx, in)
		if err != nil {
			return fmt.Errorf("create reminder %d: %w", i+1, err)
		}
		ids = append(ids, r.ID)
	}
	rep.created("reminders", len(ids))

	// Three done, two cancelled, the rest pending. Set directly: the only
	// service path to a terminal state is an operator action, and a seeder
	// pretending to be five different operators adds nothing.
	for i, id := range ids {
		var status string
		switch {
		case i < 3:
			status = reminder.StatusDone
		case i < 5:
			status = reminder.StatusCancelled
		default:
			continue
		}
		if err := d.db.WithContext(ctx).
			Model(&reminder.Reminder{}).
			Where("id = ?", id).
			Update("status", status).Error; err != nil {
			return fmt.Errorf("set reminder %d status: %w", id, err)
		}
	}

	return nil
}

// notificationFixtures are the in-app messages a borrower would have
// received. Type values match the strings loan.Service itself emits.
var notificationFixtures = []struct {
	Type, Title, Body string
	Delivered, Read   bool
	DaysAgo           int
}{
	{"LoanSanctioned", "Loan sanctioned", "Your gold loan has been sanctioned and disbursed.", true, true, 30},
	{"PaymentRecorded", "Payment received", "We have received your payment. Thank you.", true, true, 25},
	{"LoanDueSoon", "Loan due soon", "Your gold loan is due in 7 days.", true, true, 20},
	{"PaymentRecorded", "Payment received", "We have received your interest payment.", true, true, 18},
	{"LoanSanctioned", "Loan sanctioned", "Your gold loan has been sanctioned.", true, true, 15},
	{"LoanOverdue", "Loan overdue", "Your gold loan is now overdue. Please settle at the earliest.", true, true, 12},
	{"LoanDueSoon", "Loan due soon", "Your gold loan is due in 3 days.", true, false, 10},
	{"PaymentRecorded", "Payment received", "Part payment received against your loan.", true, false, 8},
	{"ExtensionApproved", "Extension approved", "Your extension request has been approved.", true, false, 6},
	{"ReleaseApproved", "Release approved", "Your gold release request has been approved.", true, false, 5},
	{"AuctionNotice", "Auction notice", "A statutory auction notice has been issued for your loan.", false, false, 4},
	{"AuctionScheduled", "Auction scheduled", "The auction of your pledged gold has been scheduled.", false, false, 3},
	{"LoanOverdue", "Loan overdue", "Your gold loan remains overdue.", false, false, 2},
	{"PaymentRecorded", "Payment received", "Payment received against your personal loan.", false, false, 1},
	{"InterestPayout", "Interest paid out", "Your monthly interest payout has been processed.", false, false, 1},
}

// commlogFixtures are the outbound WhatsApp messages.
//
// Seeded directly rather than by letting the loan service send them, for two
// reasons: the service only writes a commlog row from inside its WhatsApp
// goroutine, which this seeder deliberately disabled (see Deps), and that
// goroutine's timing would make the row count non-deterministic.
var commlogFixtures = []struct {
	Trigger, Status, Body, Err string
	DaysAgo                    int
}{
	{"loan_submission", "sent", "Your gold loan application has been submitted.", "", 30},
	{"loan_sanction", "sent", "Your gold loan has been sanctioned and disbursed.", "", 29},
	{"payment", "sent", "We have received your payment. Thank you.", "", 25},
	{"closure", "sent", "Your gold loan is now fully settled and closed.", "", 22},
	{"loan_due_soon", "sent", "Your gold loan is due in 7 days.", "", 20},
	{"loan_overdue", "sent", "Your gold loan is now overdue.", "", 18},
	{"reminder", "sent", "This is a reminder about your pending interest.", "", 16},
	{"auction_notice", "sent", "A statutory auction notice has been issued.", "", 14},
	{"auction_event", "sent", "The auction of your pledged gold has been scheduled.", "", 12},
	{"extension_request", "sent", "Your extension request has been received.", "", 10},
	{"release_request", "sent", "Your gold release request has been received.", "", 9},
	{"interest_payout", "sent", "Your interest payout has been processed.", "", 8},
	{"investment_matured", "sent", "Your deposit has matured.", "", 7},
	{"otp", "sent", "Your verification code is 123456.", "", 6},
	{"payment", "failed", "We have received your payment.", "Recipient not on WhatsApp", 5},
	{"loan_due_soon", "failed", "Your gold loan is due in 3 days.", "Message send timed out", 4},
	{"reminder", "failed", "This is a reminder about your pending interest.", "Session disconnected", 3},
	{"loan_overdue", "failed", "Your gold loan remains overdue.", "Recipient not on WhatsApp", 2},
}

// seedCommsAndAudit fills the customer-facing message history and the staff
// audit trail.
//
// All direct repository inserts. notification.Service is unusable here — its
// Notify dereferences a *realtime.Hub this seeder has no reason to construct
// — and the audit entries that branch operations would have written are
// missing because seedBranches bypasses branch.Service (see its comment), so
// they are added explicitly.
func seedCommsAndAudit(ctx context.Context, d *Deps, st *state, rep *Report) error {
	if len(st.customerIDs) == 0 {
		return nil
	}

	for i, f := range notificationFixtures {
		n := notification.Notification{
			CustomerID: st.customerIDs[i%len(st.customerIDs)],
			Type:       f.Type,
			Title:      f.Title,
			Body:       f.Body,
			Delivered:  f.Delivered,
			Read:       f.Read,
			// CreatedAt is set explicitly so the list is spread over a month.
			// GORM only auto-fills a zero value, so this sticks.
			CreatedAt: st.clk.daysAgo(f.DaysAgo),
		}
		if i < len(st.loanIDs) {
			n.RelatedEntityType = "loan"
			n.RelatedEntityID = st.loanIDs[i]
		}
		n.TenantID = st.tenantID
		if err := d.notifRepo.Create(ctx, &n); err != nil {
			return fmt.Errorf("create notification %d: %w", i+1, err)
		}
	}
	rep.created("notifications", len(notificationFixtures))

	for i, f := range commlogFixtures {
		cf := customerFixtures[i%len(customerFixtures)]
		rec := commlog.CommunicationLog{
			RecipientName:  cf.Name,
			RecipientPhone: cf.Phone,
			Channel:        commlog.ChannelWhatsApp,
			TriggerType:    f.Trigger,
			MessageBody:    f.Body,
			Status:         f.Status,
			ErrorMessage:   f.Err,
			CreatedAt:      st.clk.daysAgo(f.DaysAgo),
		}
		if i < len(st.loanIDs) {
			rec.RelatedEntityType = "loan"
			rec.RelatedEntityID = st.loanIDs[i]
		}
		rec.TenantID = st.tenantID
		if err := d.commlogRepo.Create(ctx, &rec); err != nil {
			return fmt.Errorf("create communication log %d: %w", i+1, err)
		}
	}
	rep.created("message logs", len(commlogFixtures))

	// Branch lifecycle entries. seedEmployees already produced one audit row
	// per hire through employee.Service, so the log is not empty without
	// these — but branch activity would be missing entirely.
	branchAudits := []struct {
		action, name, detail string
	}{
		{auditlog.ActionBranchCreated, "Thrissur", "Branch opened"},
		{auditlog.ActionBranchCreated, "Kochi", "Branch opened"},
		{auditlog.ActionBranchCreated, "Kozhikode", "Branch opened"},
		{auditlog.ActionBranchUpdated, "Kannur", "Address updated"},
		{auditlog.ActionBranchUpdated, "Palakkad", "Phone number updated"},
		{auditlog.ActionBranchDeactivated, "Malappuram", "Branch closed for consolidation"},
		{auditlog.ActionEmployeeUpdated, "Sreejith Varma", "Role changed to Cashier"},
		{auditlog.ActionEmployeeUpdated, "Divya Pillai", "Branch reassigned"},
	}
	for i, a := range branchAudits {
		e := auditlog.Entry{
			ActorEmployeeID: st.keep.adminID,
			ActorName:       "Admin",
			Action:          a.action,
			EntityType:      "branch",
			EntityID:        st.branchIDs[i%len(st.branchIDs)],
			EntityName:      a.name,
			Detail:          a.detail,
			CreatedAt:       st.clk.daysAgo(20 - i),
		}
		e.TenantID = st.tenantID
		if err := d.auditRepo.Create(ctx, &e); err != nil {
			return fmt.Errorf("create audit entry %d: %w", i+1, err)
		}
	}
	rep.created("audit log entries", len(branchAudits))

	return nil
}

// seedSnapshots writes a fortnight of daily dashboard counters, so the trend
// charts have a line rather than a single point.
//
// dashboard_snapshots carries NO tenant column and is uniquely indexed on
// date alone, so these rows are shared by every business on the deployment.
// That is a pre-existing quirk of the model; acceptable here only because
// this whole deployment is one demo.
func seedSnapshots(ctx context.Context, d *Deps, st *state, rep *Report) error {
	n := 0
	for i := 13; i >= 0; i-- {
		s := dashboard.Snapshot{
			Date: st.clk.daysAgo(i),
			// Figures drift upward towards today so the chart trends rather
			// than flatlining.
			ActiveCount:          18 + (13 - i),
			OverdueCount:         3 + (13-i)/3,
			PendingApprovalCount: 6 - (13-i)/5,
			OpenedTodayCount:     1 + (13-i)%3,
			DueTodayCount:        (13 - i) % 4,
		}
		if err := d.db.WithContext(ctx).Create(&s).Error; err != nil {
			return fmt.Errorf("create dashboard snapshot for %s: %w", s.Date.Format("2006-01-02"), err)
		}
		n++
	}
	rep.created("dashboard snapshots", n)
	return nil
}

// seedSequences points the code sequences past the codes just created.
//
// Nothing reads this table today — every entity code comes from an
// Unscoped() CountAll()+1 — so this is insurance rather than a requirement.
// It matters the day those generators switch over to platform.NextSequence:
// without it the first new loan after a reset would try to reuse LN-00001.
//
// SeedSequenceFrom only ever raises a sequence (it is a GREATEST), which is
// why the wipe deletes the rows outright instead of relying on this to rewind
// them.
func seedSequences(ctx context.Context, d *Deps, st *state, rep *Report) error {
	kinds := map[string]struct{ table, column string }{
		platform.SeqLoan:     {"loans", "loan_number"},
		platform.SeqCustomer: {"customers", "code"},
		platform.SeqEmployee: {"employees", "code"},
		platform.SeqPacket:   {"packets", "code"},
		platform.SeqScheme:   {"schemes", "code"},
	}
	for kind, src := range kinds {
		var highest uint64
		// The codes are prefixed (LN-00001, CUST-01), so strip everything
		// that is not a digit before taking the maximum.
		row := d.db.WithContext(ctx).
			Table(src.table).
			Where("tenant_id = ?", st.tenantID).
			Select("COALESCE(MAX(NULLIF(regexp_replace(" + src.column + ", '[^0-9]', '', 'g'), '')::bigint), 0)").
			Row()
		if err := row.Scan(&highest); err != nil {
			// A table with no coded rows is not a failure.
			continue
		}
		if highest == 0 {
			continue
		}
		if err := platform.SeedSequenceFrom(d.db, st.tenantID, kind, highest); err != nil {
			return fmt.Errorf("seed %s sequence: %w", kind, err)
		}
	}
	return nil
}
