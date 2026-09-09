// Command seeddemo populates a dev database with realistic demo data for
// manual testing across both sides of the business:
//
//   - Borrowers: 10 customers spanning all three verification states
//     (Verified / Part Verified / Unverified), 20 gold loans spanning
//     Active / Due Soon / Overdue / Auction Eligible, 5 lockers checked in
//     against the 5 auction-bound loans' packets, and those 5 loans driven
//     all the way to a live Auction (started, one bid recorded).
//   - Investors: 4 investor customers (bank-payout details on file), 2
//     investment plans (Simple/Monthly and Compound/Yearly), and 6
//     investments spanning fresh/Active, partway-through-with-payouts-
//     already-collected, and one already past its maturity date (flagged
//     Matured by the same sweep the background job runs).
//
// Ad hoc — not wired into internal/migrate, run manually with:
//
//	go run ./cmd/seeddemo
//
// Idempotent-ish: re-running adds a fresh batch of "Demo Customer N" /
// "Demo Investor N" rows rather than upserting, since customer.Service.Create
// has no natural dedupe key beyond phone number (which this script varies
// per run via a timestamp suffix) — safe to run against a throwaway dev DB,
// not meant for a shared/staging one.
package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"gorm.io/gorm"

	"cloudhouse/backend/internal/authz"
	"cloudhouse/backend/internal/branch"
	"cloudhouse/backend/internal/cash"
	"cloudhouse/backend/internal/commlog"
	"cloudhouse/backend/internal/customer"
	"cloudhouse/backend/internal/employee"
	"cloudhouse/backend/internal/goldrate"
	"cloudhouse/backend/internal/investment"
	"cloudhouse/backend/internal/loan"
	"cloudhouse/backend/internal/locker"
	"cloudhouse/backend/internal/migrate"
	"cloudhouse/backend/internal/packet"
	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/scheme"
)

func must(err error, what string) {
	if err != nil {
		log.Fatalf("%s: %v", what, err)
	}
}

func main() {
	ctx := context.Background()
	cfg := platform.LoadConfig()
	db, err := platform.NewDatabase(cfg)
	must(err, "database connection")

	// Bring the schema/permissions/bootstrap-admin up to date first — this
	// script is a separate binary from the API server, so nothing has run
	// migrate.Run yet on this process.
	must(migrate.Run(db, cfg), "migration")

	aadhaarCipher, err := platform.NewAadhaarCipher(cfg.AadhaarEncryptionKey)
	must(err, "aadhaar cipher setup")

	branchRepo := branch.NewRepository(db)
	schemeRepo := scheme.NewRepository(db)
	goldRateRepo := goldrate.NewRepository(db)
	customerRepo := customer.NewRepository(db)
	customerSvc := customer.NewService(db, customerRepo, branchRepo, aadhaarCipher, nil, nil)
	employeeRepo := employee.NewRepository(db)

	lockerRepo := locker.NewRepository(db)
	packetRepo := packet.NewRepository(db)
	packetSvc := packet.NewService(packetRepo, lockerRepo)
	lockerSvc := locker.NewService(lockerRepo, branchRepo, packetRepo)

	movementRepo := cash.NewMovementRepository(db)
	expenseRepo := cash.NewExpenseRepository(db)
	movementSvc := cash.NewMovementService(movementRepo, expenseRepo, branchRepo)

	commlogRepo := commlog.NewRepository(db)
	authzPermChecker := authz.NewRepository(db)

	loanRepo := loan.NewRepository(db)
	loanOrnamentRepo := loan.NewOrnamentRepository(db)
	loanApprovalRepo := loan.NewApprovalRepository(db)
	loanPaymentRepo := loan.NewPaymentRepository(db)
	loanPledgeRepo := loan.NewBankPledgeRepository(db)
	loanRequestRepo := loan.NewLoanRequestRepository(db)
	requestApprovalRepo := loan.NewRequestApprovalRepository(db)
	loanAuctionRepo := loan.NewAuctionRepository(db)
	loanApprovalLimitRepo := loan.NewApprovalLimitRepository(db)

	loanSvc := loan.NewService(db, loanRepo, loanOrnamentRepo, loanApprovalRepo, loanPaymentRepo, loanPledgeRepo,
		loanRequestRepo, requestApprovalRepo, loanAuctionRepo, loanApprovalLimitRepo, branchRepo, customerRepo,
		schemeRepo, goldRateRepo, packetSvc, packetSvc, movementSvc, nil, nil, commlogRepo, nil, cfg.UploadsDir,
		nil, nil, nil, aadhaarCipher, authzPermChecker)

	investmentRepo := investment.NewRepository(db)
	investmentSvc := investment.NewService(investmentRepo, customerRepo, movementSvc, nil)

	// --- Branch -------------------------------------------------------
	// Prefer whatever branch already exists, blank name/code included —
	// FirstOrCreateByName fails when a legacy branch with a blank code
	// already occupies the single-blank-code slot (same workaround as
	// cmd/seedphoneadmin, which queries the raw table rather than
	// branchRepo.FindAll — that helper excludes blank-name rows).
	br := &branch.Branch{}
	if err := db.Order("id").First(br).Error; err != nil {
		if err != gorm.ErrRecordNotFound {
			must(err, "list branches")
		}
		br, err = branchRepo.FirstOrCreateByName(ctx, "Head Office")
		must(err, "create branch")
	}

	// --- Admin actor (drives every approval/auction step below) --------
	admin, err := employeeRepo.FindByUsername(ctx, employee.AdminUsername)
	must(err, "find bootstrap admin")

	// --- Today's gold rate (loan.Create requires one) -------------------
	rate, err := goldRateRepo.FindLatest(ctx)
	if err != nil || rate.Date.YearDay() != time.Now().YearDay() || rate.Date.Year() != time.Now().Year() {
		rate = &goldrate.GoldRate{Date: time.Now(), K24: 6000, SetBy: "seeddemo"}
		must(goldRateRepo.Create(ctx, rate), "gold rate")
	}

	// --- Scheme ---------------------------------------------------------
	schemes, _, err := schemeRepo.FindAll(ctx, "", &br.ID, 100, 0)
	must(err, "list schemes")
	var sch *scheme.Scheme
	for i := range schemes {
		if schemes[i].IsActive {
			sch = &schemes[i]
			break
		}
	}
	if sch == nil {
		schemeSvc := scheme.NewService(schemeRepo, branchRepo)
		created, err := schemeSvc.Create(ctx, scheme.CreateInput{
			Name: "Demo Gold Scheme", BranchID: br.ID, InterestRate: 12, DurationMonths: 12,
			LTVPercent: 75, InterestMethod: "Monthly simple interest", PenalRate: 2, IsActive: true,
		})
		must(err, "create scheme")
		sch = created
	}

	stamp := time.Now().Unix() % 100000

	// =====================================================================
	// BORROWERS: customers, gold loans, auctions
	// =====================================================================

	// --- Customers: 3 Verified, 3 Part Verified, 4 Unverified -----------
	type custPlan struct {
		pan, aadhaar string // "Verified" or "Pending" per document
	}
	plans := []custPlan{
		{"Verified", "Verified"}, {"Verified", "Verified"}, {"Verified", "Verified"}, // fully verified
		{"Verified", "Pending"}, {"Pending", "Verified"}, {"Verified", "Pending"}, // part verified
		{"Pending", "Pending"}, {"Pending", "Pending"}, {"Pending", "Pending"}, {"Pending", "Pending"}, // unverified
	}
	custIDs := make([]uint, 0, len(plans))
	for i, p := range plans {
		n := i + 1
		rec, err := customerSvc.Create(ctx, customer.CreateInput{
			Name:     fmt.Sprintf("Demo Customer %d", n),
			Phone:    fmt.Sprintf("9%09d", stamp*10+int64(n)),
			DOB:      time.Date(1985, time.Month(1+n%12), 10, 0, 0, 0, 0, time.UTC),
			Address:  "123 Demo Street, Demo City",
			BranchID: br.ID,
			PAN:      fmt.Sprintf("DEMO%05dP", n),
			Aadhaar:  fmt.Sprintf("%011d%d", stamp, n),
		})
		must(err, fmt.Sprintf("create customer %d", n))

		rec.PANStatus = p.pan
		rec.AadhaarStatus = p.aadhaar
		switch {
		case p.pan == "Verified" && p.aadhaar == "Verified":
			rec.KYCStatus = "Verified"
		default:
			rec.KYCStatus = "Pending"
		}
		must(customerRepo.Update(ctx, rec), fmt.Sprintf("update customer %d verification", n))
		custIDs = append(custIDs, rec.ID)
	}
	log.Printf("seeded %d borrower customers", len(custIDs))

	// --- Lockers ----------------------------------------------------------
	lockerIDs := make([]uint, 0, 5)
	for i := 1; i <= 5; i++ {
		v, err := lockerSvc.Create(ctx, locker.CreateInput{Code: fmt.Sprintf("DEMO-LKR-%02d-%d", i, stamp), BranchID: br.ID, Capacity: 2})
		must(err, fmt.Sprintf("create locker %d", i))
		lockerIDs = append(lockerIDs, v.ID)
	}
	log.Printf("seeded %d lockers", len(lockerIDs))

	// --- Loans: 20 total, 5 destined for auction, 3 overdue, 2 due soon,
	// 10 plain active. Each loan pledges one ornament sized so the eligible
	// amount comfortably covers a fixed principal at the scheme's 75% LTV.
	type loanPlan struct {
		openedDaysAgo, dueDaysAgo int // dueDaysAgo negative means due in the future
		locker                    bool
	}
	var loanPlans []loanPlan
	for i := 0; i < 5; i++ {
		loanPlans = append(loanPlans, loanPlan{200, 150, true}) // >90 days overdue -> auction eligible
	}
	for i := 0; i < 3; i++ {
		loanPlans = append(loanPlans, loanPlan{60, 30, false}) // overdue, not yet defaulted
	}
	for i := 0; i < 2; i++ {
		loanPlans = append(loanPlans, loanPlan{25, -5, false}) // due in 5 days -> Due Soon
	}
	for i := 0; i < 10; i++ {
		loanPlans = append(loanPlans, loanPlan{10, -180, false}) // due in 180 days -> Active
	}

	auctionLoanIDs := make([]uint, 0, 5)
	for i, lp := range loanPlans {
		custID := custIDs[i%len(custIDs)]
		opened := time.Now().AddDate(0, 0, -lp.openedDaysAgo)
		due := time.Now().AddDate(0, 0, -lp.dueDaysAgo)

		in := loan.CreateInput{
			BranchID:   br.ID,
			CustomerID: custID,
			SchemeID:   sch.ID,
			OpenedDate: opened,
			DueDate:    due,
			Ornaments: []loan.OrnamentInput{
				{Name: "Gold Chain", Purity: "22K", GrossWeight: 20, DeductionWeight: 1, Quantity: 1},
			},
			PrincipalAmount: 50000,
			AdditionalInfo:  "Seeded demo loan",
		}
		if lp.locker {
			lid := lockerIDs[len(auctionLoanIDs)%len(lockerIDs)]
			in.LockerID = &lid
		}
		l, err := loanSvc.Create(ctx, in)
		must(err, fmt.Sprintf("create loan %d", i+1))

		// Drive the loan fully through its 3-stage sanction chain so it
		// leaves Pending Approval and starts accruing interest.
		for _, step := range []struct{ stage, action string }{
			{loan.SanctionStageLoanOperator, loan.ApprovalActionVerified},
			{loan.SanctionStageBranchManager, loan.ApprovalStageApproved},
			{loan.SanctionStageFinalSanction, loan.ApprovalStageApproved},
		} {
			_, err := loanSvc.Approve(ctx, l.ID, loan.ApprovalInput{
				Stage: step.stage, Action: step.action,
				ActorEmployeeID: admin.ID, ActorRole: "Administrator", ActorRoleID: admin.RoleID,
			})
			must(err, fmt.Sprintf("approve loan %d stage %s", l.ID, step.stage))
		}

		// A read triggers accrueAndSave, which — given the backdated
		// Opened/Due dates above — persists real Overdue/Due-Soon status
		// and, for the far-backdated batch, genuine payment arrears
		// (IsDefaulted) that MarkAuctionEligible below requires.
		_, err = loanSvc.Get(ctx, l.ID, nil)
		must(err, fmt.Sprintf("accrue loan %d", l.ID))

		if lp.locker {
			_, err := loanSvc.MarkAuctionEligible(ctx, l.ID, nil, &admin.ID, "Administrator", admin.RoleID)
			must(err, fmt.Sprintf("mark loan %d auction eligible", l.ID))
			auctionLoanIDs = append(auctionLoanIDs, l.ID)
		}
	}
	log.Printf("seeded 20 gold loans (%d marked Auction Eligible, lockers assigned to those)", len(auctionLoanIDs))

	// --- Auctions: start a live auction against the 5 auction-eligible
	// loans and record one bid on the first, so the Auctions page has both
	// a scheduled case and one already in progress to look at.
	if len(auctionLoanIDs) > 0 {
		auctioned := 0
		for i, loanID := range auctionLoanIDs {
			rec, err := loanSvc.ScheduleAuction(ctx, loanID, nil,
				time.Now().AddDate(0, 0, 7+i), fmt.Sprintf("DEMO-AUC-%d-%d", stamp, i+1),
				&admin.ID, "Administrator", admin.RoleID)
			if err != nil {
				log.Printf("schedule auction for loan %d: %v (skipping)", loanID, err)
				continue
			}
			auctioned++
			if i == 0 {
				_, err := loanSvc.RecordAuctionSale(ctx, loanID, nil, 55000, 500, &admin.ID, "Administrator", admin.RoleID)
				if err != nil {
					log.Printf("record auction sale for loan %d: %v", loanID, err)
				} else {
					log.Printf("auction record %d: sale recorded for loan %d", rec.ID, loanID)
				}
			}
		}
		log.Printf("seeded %d scheduled auctions (1 sold)", auctioned)
	}

	// =====================================================================
	// INVESTORS: investor customers, investment plans, investments
	// =====================================================================

	investorNames := []string{"Radha Menon", "Suresh Pillai", "Ammini Varghese", "Joseph Thomas"}
	investorIDs := make([]uint, 0, len(investorNames))
	for i, name := range investorNames {
		n := i + 1
		rec, err := customerSvc.Create(ctx, customer.CreateInput{
			Name:              name,
			Phone:             fmt.Sprintf("8%09d", stamp*10+int64(n)),
			Address:           "45 Investor Lane, Demo City",
			BranchID:          br.ID,
			CustomerType:      customer.CustomerTypeInvestor,
			BankAccountName:   name,
			BankAccountNumber: fmt.Sprintf("5000%08d", stamp*10+int64(n)),
			BankIFSC:          "SBIN0001234",
		})
		must(err, fmt.Sprintf("create investor %d", n))
		investorIDs = append(investorIDs, rec.ID)
	}
	log.Printf("seeded %d investor customers", len(investorIDs))

	monthlyPlan, err := investmentSvc.CreatePlan(ctx, investment.PlanInput{
		Name:                "Gold Saver 12mo",
		InterestRateType:    investment.InterestRateTypeSimple,
		InterestRatePercent: 8,
		PayoutFrequency:     investment.PayoutFrequencyMonthly,
		TenureMonths:        12,
		MinPrincipal:        10000,
		IsActive:            true,
	})
	must(err, "create monthly investment plan")

	yearlyPlan, err := investmentSvc.CreatePlan(ctx, investment.PlanInput{
		Name:                "Gold Growth 24mo",
		InterestRateType:    investment.InterestRateTypeCompound,
		InterestRatePercent: 10,
		PayoutFrequency:     investment.PayoutFrequencyYearly,
		TenureMonths:        24,
		MinPrincipal:        50000,
		IsActive:            true,
	})
	must(err, "create yearly investment plan")
	log.Printf("seeded 2 investment plans (%q, %q)", monthlyPlan.Name, yearlyPlan.Name)

	type invPlan struct {
		investorIdx     int
		planID          uint
		principal       float64
		startedMonthsAgo int // how far back to backdate StartDate
		markPaidCount   int // mark this many earliest payouts as paid, for payout history
	}
	invPlans := []invPlan{
		{0, monthlyPlan.ID, 100000, 0, 0},  // brand-new, fresh Active investment
		{1, monthlyPlan.ID, 250000, 4, 3},  // 4 months in, 3 interest payouts already collected
		{2, yearlyPlan.ID, 500000, 0, 0},   // brand-new yearly investment
		{3, yearlyPlan.ID, 1000000, 13, 1}, // partway through a 24mo term, 1 annual payout collected
		{0, monthlyPlan.ID, 150000, 0, 0},  // a second investment for the same investor
		{1, monthlyPlan.ID, 300000, 13, 12}, // started 13mo ago on a 12mo plan -> already past maturity
	}

	maturedCandidate := uint(0)
	for i, ip := range invPlans {
		start := time.Now().AddDate(0, -ip.startedMonthsAgo, 0)
		inv, err := investmentSvc.CreateInvestment(ctx, investment.CreateInput{
			BranchID:            br.ID,
			CustomerID:          investorIDs[ip.investorIdx],
			PlanID:              ip.planID,
			PrincipalAmount:     ip.principal,
			StartDate:           start,
			CreatedByEmployeeID: admin.ID,
		})
		must(err, fmt.Sprintf("create investment %d", i+1))

		if ip.markPaidCount > 0 {
			payouts, err := investmentRepo.FindPayouts(ctx, inv.ID, ip.markPaidCount, 0)
			must(err, fmt.Sprintf("list payouts for investment %d", inv.ID))
			for j := 0; j < ip.markPaidCount && j < len(payouts); j++ {
				_, err := investmentSvc.MarkPayoutPaid(ctx, inv.ID, payouts[j].ID, nil, admin.ID)
				must(err, fmt.Sprintf("mark payout %d paid for investment %d", payouts[j].ID, inv.ID))
			}
		}
		if ip.startedMonthsAgo >= 13 && i == len(invPlans)-1 {
			maturedCandidate = inv.ID
		}
	}
	log.Printf("seeded %d investments across %d investors", len(invPlans), len(investorIDs))

	// Flag the one investment whose plan tenure has already elapsed as
	// Matured — exactly the background sweep app.StartBackgroundJobs runs
	// hourly (investment.Service.SweepMaturities), so its Close/Renew
	// decision screen has something to act on immediately.
	if maturedCandidate != 0 {
		must(investmentSvc.SweepMaturities(ctx), "sweep investment maturities")
		log.Printf("swept maturities — investment %d should now show Matured", maturedCandidate)
	}

	log.Println("done")
}
