// Command seeddemo populates a dev database with demo data for manual
// testing: 10 customers spanning all three verification states (Verified /
// Part Verified / Unverified), 20 loans spanning Active / Due Soon /
// Overdue / Auction Eligible, and 5 lockers checked in against the 5
// auction-bound loans' packets.
//
// Ad hoc — not wired into internal/migrate, run manually with:
//
//	go run ./cmd/seeddemo
//
// Idempotent-ish: re-running adds a fresh batch of "Demo Customer N"
// rows/loans rather than upserting, since customer.Service.Create has no
// natural dedupe key beyond phone number (which this script varies per
// run via a timestamp suffix) — safe to run against a throwaway dev DB,
// not meant for a shared/staging one.
package main

import (
	"fmt"
	"log"
	"time"

	"gorm.io/gorm"

	"ambikagold/backend/internal/authz"
	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/cash"
	"ambikagold/backend/internal/commlog"
	"ambikagold/backend/internal/customer"
	"ambikagold/backend/internal/employee"
	"ambikagold/backend/internal/goldrate"
	"ambikagold/backend/internal/loan"
	"ambikagold/backend/internal/locker"
	"ambikagold/backend/internal/migrate"
	"ambikagold/backend/internal/packet"
	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/scheme"
)

func must(err error, what string) {
	if err != nil {
		log.Fatalf("%s: %v", what, err)
	}
}

func main() {
	cfg := platform.LoadConfig()
	db, err := platform.NewDatabase(cfg)
	must(err, "database connection")

	// Bring the schema/permissions/bootstrap-admin up to date first — this
	// script is a separate binary from the API server, so nothing has run
	// migrate.Run yet on this process.
	must(migrate.Run(db), "migration")

	aadhaarCipher, err := platform.NewAadhaarCipher(cfg.AadhaarEncryptionKey)
	must(err, "aadhaar cipher setup")

	branchRepo := branch.NewRepository(db)
	schemeRepo := scheme.NewRepository(db)
	goldRateRepo := goldrate.NewRepository(db)
	customerRepo := customer.NewRepository(db)
	customerSvc := customer.NewService(customerRepo, branchRepo, aadhaarCipher, nil, nil)
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
		nil, aadhaarCipher, authzPermChecker)

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
		br, err = branchRepo.FirstOrCreateByName("Head Office")
		must(err, "create branch")
	}

	// --- Admin actor (drives every approval/auction step below) --------
	admin, err := employeeRepo.FindByUsername(employee.AdminUsername)
	must(err, "find bootstrap admin")

	// --- Today's gold rate (loan.Create requires one) -------------------
	rate, err := goldRateRepo.FindLatest()
	if err != nil || rate.Date.YearDay() != time.Now().YearDay() || rate.Date.Year() != time.Now().Year() {
		rate = &goldrate.GoldRate{Date: time.Now(), K24: 6000, SetBy: "seeddemo"}
		must(goldRateRepo.Create(rate), "gold rate")
	}

	// --- Scheme ---------------------------------------------------------
	schemes, _, err := schemeRepo.FindAll("", &br.ID, 100, 0)
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
		created, err := schemeSvc.Create(scheme.CreateInput{
			Name: "Demo Gold Scheme", BranchID: br.ID, InterestRate: 12, DurationMonths: 12,
			LTVPercent: 75, InterestMethod: "Monthly simple interest", PenalRate: 2, IsActive: true,
		})
		must(err, "create scheme")
		sch = created
	}

	// --- Customers: 3 Verified, 3 Part Verified, 4 Unverified -----------
	stamp := time.Now().Unix() % 100000
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
		rec, err := customerSvc.Create(customer.CreateInput{
			Name:    fmt.Sprintf("Demo Customer %d", n),
			Phone:   fmt.Sprintf("9%09d", stamp*10+int64(n)),
			DOB:     time.Date(1985, time.Month(1+n%12), 10, 0, 0, 0, 0, time.UTC),
			Address: "123 Demo Street, Demo City",
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
		must(customerRepo.Update(rec), fmt.Sprintf("update customer %d verification", n))
		custIDs = append(custIDs, rec.ID)
	}
	log.Printf("seeded %d customers", len(custIDs))

	// --- Lockers ----------------------------------------------------------
	lockerIDs := make([]uint, 0, 5)
	for i := 1; i <= 5; i++ {
		v, err := lockerSvc.Create(locker.CreateInput{Code: fmt.Sprintf("DEMO-LKR-%02d-%d", i, stamp), BranchID: br.ID, Capacity: 2})
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
		l, err := loanSvc.Create(in)
		must(err, fmt.Sprintf("create loan %d", i+1))

		// Drive the loan fully through its 3-stage sanction chain so it
		// leaves Pending Approval and starts accruing interest.
		for _, step := range []struct{ stage, action string }{
			{loan.SanctionStageLoanOperator, loan.ApprovalActionVerified},
			{loan.SanctionStageBranchManager, loan.ApprovalStageApproved},
			{loan.SanctionStageFinalSanction, loan.ApprovalStageApproved},
		} {
			_, err := loanSvc.Approve(l.ID, loan.ApprovalInput{
				Stage: step.stage, Action: step.action,
				ActorEmployeeID: admin.ID, ActorRole: "Administrator", ActorRoleID: admin.RoleID,
			})
			must(err, fmt.Sprintf("approve loan %d stage %s", l.ID, step.stage))
		}

		// A read triggers accrueAndSave, which — given the backdated
		// Opened/Due dates above — persists real Overdue/Due-Soon status
		// and, for the far-backdated batch, genuine payment arrears
		// (IsDefaulted) that MarkAuctionEligible below requires.
		_, err = loanSvc.Get(l.ID, nil)
		must(err, fmt.Sprintf("accrue loan %d", l.ID))

		if lp.locker {
			_, err := loanSvc.MarkAuctionEligible(l.ID, nil, &admin.ID, "Administrator", admin.RoleID)
			must(err, fmt.Sprintf("mark loan %d auction eligible", l.ID))
			auctionLoanIDs = append(auctionLoanIDs, l.ID)
		}
	}

	log.Printf("seeded 20 loans (%d marked Auction Eligible, lockers assigned to those)", len(auctionLoanIDs))
	log.Println("done")
}
