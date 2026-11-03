package demo

import (
	common "cloudhouse/backend/common/controllers"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	cash "cloudhouse/backend/modules/Cash/controllers"
	cashModels "cloudhouse/backend/modules/Cash/models"
	dashboard "cloudhouse/backend/modules/Dashboard/controllers"
	dashboardModels "cloudhouse/backend/modules/Dashboard/models"
	investment "cloudhouse/backend/modules/Investment/controllers"
	loan "cloudhouse/backend/modules/Loan/controllers"
	loanModels "cloudhouse/backend/modules/Loan/models"
	locker "cloudhouse/backend/modules/Locker/controllers"
	packet "cloudhouse/backend/modules/Packet/controllers"
	packetModels "cloudhouse/backend/modules/Packet/models"
	personalLoan "cloudhouse/backend/modules/PersonalLoan/controllers"
	personalLoanModels "cloudhouse/backend/modules/PersonalLoan/models"
	reminder "cloudhouse/backend/modules/Reminder/controllers"
	reminderModels "cloudhouse/backend/modules/Reminder/models"
	"context"
	"fmt"
	"math"
	"time"
)

var auctionPlans = []auctionPlan{
	{20, loanModels.AuctionStageEligible, 0, ""},
	{21, loanModels.AuctionStageEligible, 0, ""},
	{22, loanModels.AuctionStageNotice, 0, ""},
	{23, loanModels.AuctionStageNotice, 0, ""},
	{24, loanModels.AuctionStageScheduled, 0, ""},
	{25, loanModels.AuctionStageScheduled, 0, ""},
	{26, loanModels.AuctionStageAuctioned, 200000, ""},
	{27, loanModels.AuctionStageAuctioned, 60000, ""},
	{30, loanModels.AuctionStageEligible, 0, ""},
	{31, loanModels.AuctionStageNotice, 0, ""},
	{32, loanModels.AuctionStageNotice, 0, ""},
	{33, loanModels.AuctionStageNotice, 0, ""},
	{34, loanModels.AuctionStageNotice, 0, ""},
	{35, loanModels.AuctionStageAuctioned, 400000, ""},
	{36, loanModels.AuctionStageAuctioned, 90000, ""},
}

var loanPlans = []loanPlan{
	{approvals: 0, openedDaysAgo: 1, dueInDays: 180, principal: 45000},
	{approvals: 0, openedDaysAgo: 2, dueInDays: 180, principal: 62000},
	{approvals: 1, openedDaysAgo: 3, dueInDays: 180, principal: 78000},
	{approvals: 1, openedDaysAgo: 4, dueInDays: 180, principal: 120000},
	{approvals: 2, openedDaysAgo: 5, dueInDays: 180, principal: 95000},
	{approvals: 2, openedDaysAgo: 6, dueInDays: 180, principal: 150000},
	{approvals: 3, openedDaysAgo: 20, dueInDays: 300, principal: 85000},
	{approvals: 3, openedDaysAgo: 35, dueInDays: 240, principal: 110000},
	{approvals: 3, openedDaysAgo: 50, dueInDays: 220, principal: 65000},
	{approvals: 3, openedDaysAgo: 60, dueInDays: 190, principal: 140000},
	{approvals: 3, openedDaysAgo: 75, dueInDays: 160, principal: 52000},
	{approvals: 3, openedDaysAgo: 90, dueInDays: 130, principal: 175000},
	{approvals: 3, openedDaysAgo: 100, dueInDays: 110, principal: 98000},
	{approvals: 3, openedDaysAgo: 120, dueInDays: 60, principal: 72000},
	{approvals: 3, openedDaysAgo: 175, dueInDays: 2, principal: 88000},
	{approvals: 3, openedDaysAgo: 178, dueInDays: 4, principal: 132000},
	{approvals: 3, openedDaysAgo: 180, dueInDays: 7, principal: 59000},
	{approvals: 3, openedDaysAgo: 210, dueInDays: -20, principal: 76000},
	{approvals: 3, openedDaysAgo: 240, dueInDays: -40, principal: 105000},
	{approvals: 3, openedDaysAgo: 260, dueInDays: -60, principal: 68000},
	{approvals: 3, openedDaysAgo: 420, dueInDays: -200, principal: 125000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 425, dueInDays: -205, principal: 92000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 430, dueInDays: -210, principal: 158000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 435, dueInDays: -215, principal: 74000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 440, dueInDays: -220, principal: 186000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 445, dueInDays: -225, principal: 63000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 450, dueInDays: -230, principal: 142000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 455, dueInDays: -235, principal: 97000, auctionPool: true},
	{approvals: 1, reject: true, openedDaysAgo: 15, dueInDays: 170, principal: 55000},
	{approvals: 3, openedDaysAgo: 150, dueInDays: 40, principal: 48000},
	{approvals: 3, openedDaysAgo: 460, dueInDays: -240, principal: 118000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 465, dueInDays: -245, principal: 83000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 470, dueInDays: -250, principal: 136000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 475, dueInDays: -255, principal: 79000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 480, dueInDays: -260, principal: 112000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 485, dueInDays: -265, principal: 95000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 490, dueInDays: -270, principal: 128000, auctionPool: true},
	{approvals: 3, openedDaysAgo: 40, dueInDays: 250, principal: 91000},
	{approvals: 3, openedDaysAgo: 45, dueInDays: 245, principal: 67000},
	{approvals: 3, openedDaysAgo: 55, dueInDays: 235, principal: 124000},
	{approvals: 3, openedDaysAgo: 65, dueInDays: 225, principal: 58000},
	{approvals: 3, openedDaysAgo: 70, dueInDays: 215, principal: 103000},
}

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

var notificationFixtures = []struct {
	Type, Title, Body string
	Delivered, Read   bool
	DaysAgo           int
}{
	{"loan_sanction", "Loan sanctioned", "Your gold loan has been sanctioned and disbursed.", true, true, 30},
	{"payment", "Payment received", "We have received your payment. Thank you.", true, true, 25},
	{"loan_due_soon", "Loan due soon", "Your gold loan is due in 7 days.", true, true, 20},
	{"payment", "Payment received", "We have received your interest payment.", true, true, 18},
	{"loan_sanction", "Loan sanctioned", "Your gold loan has been sanctioned.", true, true, 15},
	{"loan_overdue", "Loan overdue", "Your gold loan is now overdue. Please settle at the earliest.", true, true, 12},
	{"loan_due_soon", "Loan due soon", "Your gold loan is due in 3 days.", true, false, 10},
	{"payment", "Payment received", "Part payment received against your loan.", true, false, 8},
	{"extension_request", "Extension approved", "Your extension request has been approved.", true, false, 6},
	{"release_request", "Release approved", "Your gold release request has been approved.", true, false, 5},
	{"auction_notice", "Auction notice", "A statutory auction notice has been issued for your loan.", false, false, 4},
	{"auction_event", "Auction scheduled", "The auction of your pledged gold has been scheduled.", false, false, 3},
	{"loan_overdue", "Loan overdue", "Your gold loan remains overdue.", false, false, 2},
	{"payment", "Payment received", "Payment received against your personal loan.", false, false, 1},
	{"investment_interest_payout", "Interest paid out", "Your monthly interest payout has been processed.", false, false, 1},
}

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

var packetMovePlans = []packetMovePlan{
	{6, []string{packetModels.StatusLockerStored}},
	{7, []string{packetModels.StatusLockerStored}},
	{8, []string{packetModels.StatusLockerStored}},
	{9, []string{packetModels.StatusLockerStored}},
	{10, []string{packetModels.StatusLockerStored}},
	{11, []string{packetModels.StatusLockerStored}},
	{12, []string{packetModels.StatusLockerStored}},
	{13, []string{packetModels.StatusLockerStored}},
	{14, []string{packetModels.StatusLockerStored}},
	{15, []string{packetModels.StatusLockerStored}},
	{16, []string{packetModels.StatusLockerStored}},
	{17, []string{packetModels.StatusLockerStored}},
	{18, []string{packetModels.StatusLockerStored}},
	{19, []string{packetModels.StatusLockerStored}},
	{29, []string{packetModels.StatusLockerStored}},
	{26, []string{packetModels.StatusLockerStored}},
	{27, []string{packetModels.StatusLockerStored}},
	{35, []string{packetModels.StatusLockerStored}},
	{36, []string{packetModels.StatusLockerStored}},
	{37, []string{packetModels.StatusLockerStored}},
	{38, []string{packetModels.StatusLockerStored}},
	{39, []string{packetModels.StatusLockerStored}},
	{40, []string{packetModels.StatusLockerStored}},
	{41, []string{packetModels.StatusLockerStored}},
}

var pledgePlans = []pledgePlan{
	{6, 0, 60000, 18, loanModels.BankPledgeCashTreatmentCashIn, false},
	{8, 1, 45000, 22, loanModels.BankPledgeCashTreatmentCashIn, false},
	{10, 2, 38000, 26, loanModels.BankPledgeCashTreatmentCashIn, false},
	{12, 3, 70000, 30, loanModels.BankPledgeCashTreatmentRecordOnly, false},
	{14, 4, 55000, 34, loanModels.BankPledgeCashTreatmentRecordOnly, true},
	{37, 5, 62000, 12, loanModels.BankPledgeCashTreatmentCashIn, false},
	{38, 6, 44000, 15, loanModels.BankPledgeCashTreatmentCashIn, false},
	{39, 7, 85000, 19, loanModels.BankPledgeCashTreatmentRecordOnly, false},
	{40, 8, 39000, 24, loanModels.BankPledgeCashTreatmentCashIn, false},
	{41, 9, 71000, 28, loanModels.BankPledgeCashTreatmentRecordOnly, false},
}

// Every payment is dated on or after its loan opened and is sized from what was owed on its own date
// (loan.OwedAsOf), the way the payment screen sizes it. Discounts are given with a payment, the way staff
// enter them now (a standalone Waiver/Discount row can no longer be entered).
var paymentPlans = []paymentPlan{
	{loanIdx: 6, kind: loanModels.PaymentTypeInterest, fraction: 0.6, daysAgo: 12, description: "Monthly interest"},
	{loanIdx: 7, kind: loanModels.PaymentTypeInterest, fraction: 0.5, daysAgo: 20, description: "Monthly interest", mode: "UPI"},
	{loanIdx: 8, kind: loanModels.PaymentTypeInterest, fraction: 0.7, daysAgo: 15, description: "Monthly interest"},
	{loanIdx: 9, kind: loanModels.PaymentTypeInterest, fraction: 0.4, daysAgo: 30, description: "Monthly interest"},
	{loanIdx: 10, kind: loanModels.PaymentTypeInterest, fraction: 0.8, daysAgo: 22, description: "Monthly interest", mode: "Bank Transfer"},
	{loanIdx: 11, kind: loanModels.PaymentTypeInterest, fraction: 0.5, daysAgo: 18, description: "Monthly interest"},
	{loanIdx: 12, kind: loanModels.PaymentTypeInterest, fraction: 0.6, daysAgo: 12, description: "Monthly interest", mode: "UPI"},
	{loanIdx: 13, kind: loanModels.PaymentTypeInterest, fraction: 0.9, daysAgo: 40, description: "Monthly interest"},
	{loanIdx: 14, kind: loanModels.PaymentTypeInterest, fraction: 0.5, daysAgo: 28, description: "Monthly interest"},
	{loanIdx: 15, kind: loanModels.PaymentTypeInterest, fraction: 0.6, daysAgo: 26, description: "Monthly interest"},
	{loanIdx: 16, kind: loanModels.PaymentTypeInterest, fraction: 0.7, daysAgo: 24, description: "Monthly interest"},
	{loanIdx: 7, kind: loanModels.PaymentTypePrincipal, fraction: 0.2, daysAgo: 10, description: "Part principal repayment"},
	{loanIdx: 9, kind: loanModels.PaymentTypePrincipal, fraction: 0.25, daysAgo: 14, description: "Part principal repayment", mode: "Bank Transfer"},
	{loanIdx: 11, kind: loanModels.PaymentTypePrincipal, fraction: 0.15, daysAgo: 8, description: "Part principal repayment"},
	{loanIdx: 12, kind: loanModels.PaymentTypePrincipal, fraction: 0.2, daysAgo: 6, description: "Part principal repayment"},
	{loanIdx: 13, kind: loanModels.PaymentTypePrincipal, fraction: 0.3, daysAgo: 16, description: "Part principal repayment"},
	{loanIdx: 15, kind: loanModels.PaymentTypePrincipal, fraction: 0.1, daysAgo: 9, description: "Part principal repayment", mode: "UPI"},
	{loanIdx: 17, kind: loanModels.PaymentTypePartial, fraction: 0.15, daysAgo: 5, description: "Part payment towards dues"},
	{loanIdx: 18, kind: loanModels.PaymentTypePartial, fraction: 0.2, daysAgo: 7, description: "Part payment towards dues"},
	{loanIdx: 19, kind: loanModels.PaymentTypePartial, fraction: 0.1, daysAgo: 11, description: "Part payment towards dues"},
	{loanIdx: 17, kind: loanModels.PaymentTypeInterest, fraction: 0.5, daysAgo: 3, description: "Interest received",
		discountKind: "penal_interest", discountFraction: 0.3, discountReason: "Penal interest waived by management"},
	{loanIdx: 18, kind: loanModels.PaymentTypeInterest, fraction: 0.5, daysAgo: 4, description: "Interest received",
		discountKind: "penal_interest", discountFraction: 0.4, discountReason: "Penal interest waived by management"},
	{loanIdx: 19, kind: loanModels.PaymentTypePartial, fraction: 0.1, daysAgo: 2, description: "Part payment towards dues",
		discountKind: "customer", discountFraction: 0.02, discountReason: "Goodwill discount"},
	{loanIdx: 13, kind: loanModels.PaymentTypeInterest, fraction: 0.5, daysAgo: 5, description: "Interest received",
		discountKind: "interest", discountFraction: 0.1, discountReason: "Goodwill discount on interest"},
	{loanIdx: 29, kind: loanModels.PaymentTypeFullSettlement, fraction: 1.0, daysAgo: 1, description: "Loan closed in full"},
}

var personalLoanFixtures = []personalLoanFixture{
	{50000, "Flat", 2, "Monthly", 12, 200},
	{75000, "Percentage", 18, "Monthly", 12, 180},
	{30000, "Flat", 1.5, "Monthly", 6, 150},
	{120000, "Percentage", 15, "Monthly", 24, 300},
	{45000, "Flat", 2.5, "Weekly", 20, 90},
	{25000, "Percentage", 24, "Weekly", 12, 60},
	{60000, "Flat", 2, "Monthly", 18, 240},
	{90000, "Percentage", 16, "Monthly", 12, 120},
	{15000, "Flat", 3, "Daily", 30, 25},
	{200000, "Percentage", 14, "Monthly", 24, 330},
	{35000, "Flat", 2, "Weekly", 16, 100},
	{80000, "Percentage", 17, "Monthly", 12, 210},
}

type auctionPlan struct {
	loanIdx     int
	stage       string
	saleAmount  float64
	disposition string
}

type loanPlan struct {
	approvals     int
	reject        bool
	openedDaysAgo int
	dueInDays     int
	principal     float64
	auctionPool   bool
}

type packetMovePlan struct {
	loanIdx int
	path    []string
}

type pledgePlan struct {
	loanIdx      int
	bankIdx      int
	amount       float64
	daysAgo      int
	treatment    string
	releaseAfter bool
}

type paymentPlan struct {
	loanIdx     int
	kind        string
	fraction    float64
	daysAgo     int
	description string
	mode        string // "" or Cash, UPI, Bank Transfer
	// discountKind ("customer", "interest", "penal_interest") gives a discount of discountFraction of that
	// bucket with the payment, on the same date.
	discountKind     string
	discountFraction float64
	discountReason   string
}

type personalLoanFixture struct {
	Principal     float64
	InterestType  string
	Value         float64
	Frequency     string
	Tenure        int
	openedDaysAgo int
}

func seedAppraisals(ctx context.Context, st *state, rep *Report) error {
	tests, images := 0, 0
	for i, loanID := range st.loanIDs {
		if i >= 20 {
			break
		}
		ornaments, err := loan.FindByLoanID(ctx, loanID)
		if err != nil || len(ornaments) == 0 {
			continue
		}
		o := ornaments[0]
		if _, err := loan.SavePurityTest(ctx, o.ID, loan.PurityTestInput{
			TestedPurity:          o.Purity,
			TestedGrossWeight:     o.GrossWeight - 0.2,
			TestedDeductionWeight: o.DeductionWeight + 0.1,
			TestingRemarks:        "Touchstone assay, within tolerance",
			TestedBy:              "Appraiser",
			TestedAt:              st.clk.daysAgo(1),
		}); err != nil {
			return fmt.Errorf("record purity test on ornament %d: %w", o.ID, err)
		}
		tests++
		if len(st.uploadKeys) == 0 {
			continue
		}
		for j := 0; j < 2; j++ {
			key := st.uploadKeys[(i+j)%len(st.uploadKeys)]
			if _, err := loan.SaveOrnamentImage(ctx, o.ID, key); err != nil {
				return fmt.Errorf("add image to ornament %d: %w", o.ID, err)
			}
			images++
		}
	}
	rep.created("ornament purity tests", tests)
	rep.created("ornament images", images)
	return nil
}

func seedBranches(ctx context.Context, st *state, rep *Report) error {
	st.branchIDs = append(st.branchIDs, st.keep.adminBranchID)
	for _, f := range branchFixtures {
		b := commonModels.Branch{
			Name:     f.Name,
			Code:     f.Code,
			Address:  f.Address,
			Phone:    f.Phone,
			IsActive: f.Active,
		}
		b.TenantID = st.tenantID
		if err := common.InsertBranch(ctx, &b); err != nil {
			return fmt.Errorf("create branch %q: %w", f.Name, err)
		}
		if f.Active {
			st.branchIDs = append(st.branchIDs, b.ID)
		} else if err := config.BaseDB.WithContext(ctx).Model(&commonModels.Branch{}).
			Where("id = ?", b.ID).Update("is_active", false).Error; err != nil {
			return fmt.Errorf("close branch %q: %w", f.Name, err)
		}
	}
	rep.created("branches", len(branchFixtures)+1)
	return nil
}

func seedEmployees(ctx context.Context, st *state, rep *Report) error {
	for i, f := range employeeFixtures {
		in := common.EmployeeCreateInput{
			Name:     f.Name,
			Role:     f.Role,
			BranchID: st.branchIDs[i%len(st.branchIDs)],
			Phone:    f.Phone,
			Username: f.Username,
			Password: "demo@123",
		}
		emp, err := common.SaveEmployee(ctx, in, st.keep.adminID)
		if err != nil {
			return fmt.Errorf("create employee %q: %w", f.Name, err)
		}
		st.employeeIDs = append(st.employeeIDs, emp.ID)
	}
	rep.created("employees", len(employeeFixtures))
	return nil
}

func seedCustomers(ctx context.Context, st *state, rep *Report) error {
	for i, f := range customerFixtures {
		in := common.CustomerCreateInput{
			Name:            f.Name,
			Phone:           f.Phone,
			Address:         f.Address,
			BranchID:        st.branchIDs[i%len(st.branchIDs)],
			PAN:             f.PAN,
			District:        f.District,
			Taluk:           f.Taluk,
			Village:         f.Village,
			NomineeName:     f.NomineeName,
			NomineeRelation: f.NomineeRelation,
			NomineePhone:    f.Phone,
			FatherName:      customerFathers[i%len(customerFathers)],
			Place:           f.Village,
			PinCode:         customerPins[i%len(customerPins)],
			Age:             intPtr(f.Age),
			DOB:             st.clk.today.AddDate(-f.Age, 0, 0),
		}
		if f.Investor {
			in.CustomerType = "Investor"
			in.BankAccountName = f.BankAccountName
			in.BankAccountNumber = f.BankAccountNumber
			in.BankIFSC = f.BankIFSC
		} else {
			in.CustomerType = "Borrower"
		}
		if f.Aadhaar != "" {
			if config.AadhaarCipher != nil {
				in.Aadhaar = f.Aadhaar
			} else if f.Investor {
				return fmt.Errorf(
					"cannot seed investor %q: an investor requires an Aadhaar number and AADHAAR_ENCRYPTION_KEY is not configured",
					f.Name)
			}
		}
		c, err := common.SaveCustomer(ctx, in)
		if err != nil {
			return fmt.Errorf("create customer %q: %w", f.Name, err)
		}
		st.customerIDs = append(st.customerIDs, c.ID)
	}
	for i, id := range st.customerIDs {
		plan := customerKYCPlan[i%len(customerKYCPlan)]
		if err := config.BaseDB.WithContext(ctx).
			Model(&commonModels.Customer{}).
			Where("id = ?", id).
			Updates(map[string]any{
				"kyc_status":     plan.KYC,
				"pan_status":     plan.PAN,
				"aadhaar_status": plan.Aadhaar,
			}).Error; err != nil {
			return fmt.Errorf("set verification state on customer %d: %w", id, err)
		}
	}
	rep.created("customers", len(customerFixtures))
	return nil
}

var customerFathers = []string{"Chandran Pillai", "Muhammed Kutty", "Mathew Joseph", "Rajan Menon", "Abdul Rahman", "Sasi Kumar",
	"Gopala Pillai", "Thomas Varghese", "Hamza Haji", "Raman Nair", "Varkey Mathai", "Subramania Iyer"}

var customerPins = []string{"680306", "680307", "683572", "683542", "676101", "680664", "688524", "686691", "679577", "680101", "686661", "678003"}

func seedUploads(ctx context.Context, st *state, rep *Report) error {
	for i := 0; i < 10; i++ {
		name := fmt.Sprintf("demo-document-%02d.png", i+1)
		key, err := common.SaveBytesRecorded(ctx, config.Env.UploadsDir, name, onePixelPNG())
		if err != nil {
			return fmt.Errorf("save upload %q: %w", name, err)
		}
		st.uploadKeys = append(st.uploadKeys, key)
	}
	for i := 0; i < 6 && i < len(st.customerIDs); i++ {
		if err := config.BaseDB.WithContext(ctx).
			Model(&commonModels.Customer{}).
			Where("id = ?", st.customerIDs[i]).
			Updates(map[string]any{
				"photo_url":        st.uploadKeys[i],
				"kyc_document_url": st.uploadKeys[(i+1)%len(st.uploadKeys)],
			}).Error; err != nil {
			return fmt.Errorf("attach documents to customer %d: %w", st.customerIDs[i], err)
		}
	}
	rep.created("uploaded files", len(st.uploadKeys))
	return nil
}

func onePixelPNG() []byte {
	return []byte{
		0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A,
		0x00, 0x00, 0x00, 0x0D, 'I', 'H', 'D', 'R',
		0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
		0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
		0x89, 0x00, 0x00, 0x00, 0x0A, 'I', 'D', 'A', 'T',
		0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05,
		0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00,
		0x00, 0x00, 'I', 'E', 'N', 'D', 0xAE, 0x42, 0x60, 0x82,
	}
}

func intPtr(v int) *int { return &v }

func seedDrafts(ctx context.Context, st *state, rep *Report) error {
	if len(st.customerIDs) == 0 {
		return nil
	}
	for i := 0; i < 10; i++ {
		customerID := st.customerIDs[i%len(st.customerIDs)]
		in := loan.DraftInput{
			BranchID:   st.branchIDs[i%len(st.branchIDs)],
			CustomerID: &customerID,
		}
		if i%3 != 0 && len(st.schemeIDs) > 0 {
			schemeID := st.schemeIDs[i%len(st.schemeIDs)]
			in.SchemeID = &schemeID
		}
		if i%4 != 0 {
			f := ornamentFixtures[i%len(ornamentFixtures)]
			in.Ornaments = []loan.DraftOrnamentInput{{
				Name:        f.Name,
				Purity:      f.Purity,
				GrossWeight: f.Gross,
				Quantity:    f.Quantity,
			}}
		}
		if _, err := loan.SaveDraft(ctx, st.keep.adminID, in); err != nil {
			return fmt.Errorf("save loan draft %d: %w", i+1, err)
		}
	}
	rep.created("loan drafts", 10)
	return nil
}

func seedGrants(ctx context.Context, st *state, rep *Report) error {
	roles, err := common.FindRoles(ctx)
	if err != nil {
		return fmt.Errorf("list roles: %w", err)
	}
	existing := make(map[string]bool, len(roles))
	for _, r := range roles {
		existing[r.Name] = true
	}
	created := 0
	for _, r := range customRoleFixtures {
		if existing[r.Name] {
			continue
		}
		if _, err := common.InsertRole(ctx, r.Name, r.Description); err != nil {
			return fmt.Errorf("create role %q: %w", r.Name, err)
		}
		created++
	}
	if created > 0 {
		rep.created("custom roles", created)
		if roles, err = common.FindRoles(ctx); err != nil {
			return fmt.Errorf("list roles: %w", err)
		}
	}
	if len(roles) == 0 {
		return fmt.Errorf("no roles found for this business — run `go run ./cmd/migrate` first")
	}
	var perms []commonModels.Permission
	if err := config.BaseDB.WithContext(config.AllowCrossTenant(ctx)).Find(&perms).Error; err != nil {
		return fmt.Errorf("list permissions: %w", err)
	}
	if len(perms) == 0 {
		return fmt.Errorf("permission catalogue is empty — run `go run ./cmd/migrate` first")
	}
	for _, r := range roles {
		if r.Name == "Administrator" {
			st.adminRoleID = r.ID
		}
	}
	if st.adminRoleID == 0 {
		return fmt.Errorf("no %q role found for this business", "Administrator")
	}
	var granted []uint
	if err := config.BaseDB.WithContext(config.AllowCrossTenant(ctx)).
		Raw(`SELECT DISTINCT role_id FROM role_permissions
		     WHERE role_id IN (SELECT id FROM roles WHERE tenant_id = ?)`, st.tenantID).
		Scan(&granted).Error; err != nil {
		return fmt.Errorf("read existing grants: %w", err)
	}
	hasGrants := make(map[uint]bool, len(granted))
	for _, id := range granted {
		hasGrants[id] = true
	}
	rows := make([]commonModels.RolePermission, 0, len(roles)*len(perms))
	for _, r := range roles {
		if hasGrants[r.ID] {
			continue
		}
		for _, p := range perms {
			rp := commonModels.RolePermission{RoleID: r.ID, PermissionID: p.ID, Permission: true}
			rp.TenantID = st.tenantID
			rows = append(rows, rp)
		}
	}
	if len(rows) > 0 {
		if err := config.BaseDB.WithContext(ctx).CreateInBatches(rows, 200).Error; err != nil {
			return fmt.Errorf("insert grants: %w", err)
		}
		if err := common.ApplyRestrictions(ctx, common.Restrictions); err != nil {
			return fmt.Errorf("apply restrictions: %w", err)
		}
		rep.created("permission grants", len(rows))
	}
	return nil
}

func seedLoanRequests(ctx context.Context, st *state, rep *Report) error {
	extensionTargets := []int{6, 7, 8, 9, 10}
	created := 0
	for n, idx := range extensionTargets {
		if idx >= len(st.loanIDs) {
			continue
		}
		loanID := st.loanIDs[idx]
		if _, err := recordPayment(ctx, st, loanID, paymentPlan{
			kind:        loanModels.PaymentTypeInterest,
			fraction:    1.0,
			description: "Interest cleared before requesting extension",
		}, st.clk.today, n); err != nil {
			return fmt.Errorf("clear interest before extension request on loan index %d: %w", idx, err)
		}
		req, err := loan.SaveExtensionRequest(ctx, loanID, loan.ExtensionRequestInput{
			Months:      3,
			Detail:      "Customer requested additional time",
			RequestedBy: loanModels.RequestedByStaff,
		})
		if err != nil {
			return fmt.Errorf("create extension request on loan index %d: %w", idx, err)
		}
		created++
		cur := req
		for s := 0; s < n; s++ {
			key, ok, err := requestStageKey(ctx, common.FlowLoanExtension, cur.ApprovalStage, "PendingLoanOfficer")
			if err != nil {
				return err
			}
			if !ok {
				break
			}
			next, err := loan.ApproveExtensionRequest(ctx, req.ID, nil, loan.ExtensionApprovalInput{
				Stage:           key,
				Action:          loanModels.ApprovalStageApproved,
				ActorEmployeeID: st.keep.adminID,
				ActorRole:       "Administrator",
				ActorRoleID:     st.adminRoleID,
				Remarks:         "Demo approval",
			})
			if err != nil {
				return fmt.Errorf("advance extension request on loan index %d: %w", idx, err)
			}
			cur = next
		}
	}
	const settledLoanIdx = 29
	releaseTargets := []int{11, 13, 15, 17, settledLoanIdx}
	yes := true
	for n, idx := range releaseTargets {
		if idx >= len(st.loanIDs) {
			continue
		}
		req, err := loan.SaveReleaseRequest(ctx, st.loanIDs[idx], loan.ReleaseRequestInput{
			Detail:      "Customer requested release of pledged gold",
			RequestedBy: loanModels.RequestedByStaff,
		})
		if err != nil {
			return fmt.Errorf("create release request on loan index %d: %w", idx, err)
		}
		created++
		if n < 2 {
			continue
		}
		notes := "Demo verification"
		check := loan.ChecklistInput{
			CustomerSawGold:    &yes,
			PacketVerified:     &yes,
			BankPledgeVerified: &yes,
			CustomerConfirmed:  &yes,
			VerificationNotes:  &notes,
			ActorRoleID:        st.adminRoleID,
		}
		if idx == settledLoanIdx {
			check.PaymentVerified = &yes
		}
		if _, err := loan.SaveReleaseChecklist(ctx, req.ID, nil, check); err != nil {
			return fmt.Errorf("verify release checklist on loan index %d: %w", idx, err)
		}
		if idx != settledLoanIdx {
			continue
		}
		cur := req
		for {
			key, ok, err := requestStageKey(ctx, common.FlowLoanRelease, cur.ApprovalStage, loanModels.ApprovalStagePendingManager)
			if err != nil {
				return err
			}
			if !ok {
				break
			}
			next, err := loan.ApproveReleaseRequest(ctx, req.ID, nil, loan.ReleaseApprovalInput{
				Stage:           key,
				Action:          loanModels.ApprovalStageApproved,
				ActorEmployeeID: st.keep.adminID,
				ActorRoleID:     st.adminRoleID,
				Remarks:         "Demo approval",
			})
			if err != nil {
				return fmt.Errorf("approve release request on loan index %d: %w", idx, err)
			}
			cur = next
		}
	}
	rep.created("loan requests", created)
	return nil
}

func seedAuctions(ctx context.Context, st *state, rep *Report) error {
	actor := st.keep.adminID
	role := "Administrator"
	n := 0
	for _, p := range auctionPlans {
		if p.loanIdx >= len(st.loanIDs) {
			continue
		}
		id := st.loanIDs[p.loanIdx]
		if _, err := loan.SaveAuctionEligibility(ctx, id, nil, &actor, role, st.adminRoleID); err != nil {
			return fmt.Errorf("mark loan index %d auction eligible: %w", p.loanIdx, err)
		}
		n++
		if p.stage == loanModels.AuctionStageEligible {
			continue
		}
		if _, err := loan.SaveAuctionNotice(ctx, id, nil, "Demo statutory notice", &actor, role, st.adminRoleID); err != nil {
			return fmt.Errorf("issue auction notice on loan index %d: %w", p.loanIdx, err)
		}
		if p.stage == loanModels.AuctionStageNotice {
			continue
		}
		when := st.clk.daysAhead(10 + p.loanIdx%14)
		if p.stage == loanModels.AuctionStageAuctioned {
			when = st.clk.daysAgo(9)
		}
		if _, err := loan.SaveAuctionSchedule(ctx, id, nil, when, fmt.Sprintf("AUC-DEMO-%02d", p.loanIdx), &actor, role, st.adminRoleID); err != nil {
			return fmt.Errorf("schedule auction on loan index %d: %w", p.loanIdx, err)
		}
		if p.stage == loanModels.AuctionStageScheduled {
			continue
		}
		if _, err := loan.SaveAuctionSale(ctx, id, nil, p.saleAmount, 2500, loan.AuctionSalePayment{}, &actor, role, st.adminRoleID); err != nil {
			return fmt.Errorf("record auction sale on loan index %d: %w", p.loanIdx, err)
		}
	}
	rep.created("auction records", n)
	return nil
}

func requestStageKey(ctx context.Context, flow, approvalStage, fallback string) (string, bool, error) {
	if approvalStage == loanModels.ApprovalStageApproved || approvalStage == loanModels.ApprovalStageRejected {
		return "", false, nil
	}
	chain, err := common.WorkflowChain(ctx, flow)
	if err != nil {
		return "", false, fmt.Errorf("read the %s chain: %w", flow, err)
	}
	if approvalStage == "" {
		approvalStage = fallback
	}
	step, ok := chain.ByPending(approvalStage)
	return step.Key, ok, nil
}

func seedLoans(ctx context.Context, st *state, rep *Report) error {
	if len(st.customerIDs) == 0 || len(st.schemeIDs) == 0 {
		return fmt.Errorf("no customers or active schemes to attach loans to")
	}
	chain, err := common.WorkflowChain(ctx, common.FlowLoanSanction)
	if err != nil {
		return fmt.Errorf("read the loan sanction chain: %w", err)
	}
	for i, p := range loanPlans {
		in := loan.CreateInput{
			BranchID:        st.branchIDs[i%len(st.branchIDs)],
			CustomerID:      st.customerIDs[i%len(st.customerIDs)],
			SchemeID:        st.schemeIDs[i%len(st.schemeIDs)],
			OpenedDate:      st.clk.daysAgo(p.openedDaysAgo),
			DueDate:         st.clk.daysAhead(p.dueInDays),
			PrincipalAmount: p.principal,
			Ornaments:       ornamentsFor(i, p.principal),
			AdditionalInfo:  "Demo record",
		}
		if len(st.employeeIDs) > 4 {
			// the two loan operators take turns keying loans in
			k := 3 + i%2
			in.CreatedByEmployeeID, in.CreatedByName = st.employeeIDs[k], employeeFixtures[k].Name
		}
		if len(st.uploadKeys) > 0 {
			in.OverallPhotoURL = st.uploadKeys[i%len(st.uploadKeys)]
		}
		l, err := loan.SaveLoan(ctx, in)
		if err != nil {
			return fmt.Errorf("create loan %d: %w", i+1, err)
		}
		st.loanIDs = append(st.loanIDs, l.ID)
		for stage := 0; stage < p.approvals; stage++ {
			cur, err := loan.GetLoan(ctx, l.ID, nil)
			if err != nil {
				return fmt.Errorf("reload loan %d: %w", i+1, err)
			}
			if cur.ApprovalStage == loanModels.ApprovalStageApproved || cur.ApprovalStage == loanModels.ApprovalStageRejected {
				break
			}
			action := loanModels.ApprovalStageApproved
			if stage == 0 {
				action = "Verified"
			}
			if p.reject && stage == p.approvals-1 {
				action = loanModels.ApprovalStageRejected
			}
			approval := loan.ApprovalInput{
				Stage:           cur.ApprovalStage,
				Action:          action,
				ActorEmployeeID: st.keep.adminID,
				ActorRole:       "Administrator",
				ActorRoleID:     st.adminRoleID,
				Remarks:         "Demo approval",
			}
			if chain.IsFinal(cur.ApprovalStage) && action == loanModels.ApprovalStageApproved {
				approval.CashAmount = p.principal
			}
			if _, err := loan.SaveLoanApproval(ctx, l.ID, approval); err != nil {
				return fmt.Errorf("approve loan %d at %s: %w", i+1, cur.ApprovalStage, err)
			}
		}
	}
	rep.created("gold loans", len(loanPlans))
	rep.created("packets", len(loanPlans))
	return nil
}

func ornamentsFor(i int, principal float64) []loan.OrnamentInput {
	grams := math.Ceil(principal/3400.0*10) / 10
	primary := ornamentFixtures[i%len(ornamentFixtures)]
	out := []loan.OrnamentInput{{
		Name:            primary.Name,
		Purity:          "22K",
		GrossWeight:     grams + primary.Deduction,
		DeductionWeight: primary.Deduction,
		Quantity:        primary.Quantity,
		Remarks:         "Demo ornament",
	}}
	for j := 1; j < 1+i%3; j++ {
		f := ornamentFixtures[(i+j)%len(ornamentFixtures)]
		out = append(out, loan.OrnamentInput{
			Name:            f.Name,
			Purity:          f.Purity,
			GrossWeight:     f.Gross,
			DeductionWeight: f.Deduction,
			Quantity:        f.Quantity,
			Remarks:         "Demo ornament",
		})
	}
	return out
}

func isAuctionPool(i int) bool {
	if i >= len(loanPlans) {
		return false
	}
	return loanPlans[i].auctionPool
}

func seedMasters(ctx context.Context, st *state, rep *Report) error {
	if err := seedPurityStandards(ctx, rep); err != nil {
		return err
	}
	for _, f := range bankFixtures {
		b, _, err := common.FindBankOrCreate(ctx, common.BankCreateInput{
			Name:      f.Name,
			BranchID:  st.branchIDs[0],
			Branch:    f.Branch,
			Ifsc:      f.Ifsc,
			AccountNo: f.AccountNo,
			Phone:     f.Phone,
		})
		if err != nil {
			return fmt.Errorf("create bank %q: %w", f.Name, err)
		}
		st.bankIDs = append(st.bankIDs, b.ID)
	}
	rep.created("banks", len(bankFixtures))
	for _, name := range ornamentTypeFixtures {
		if _, _, err := common.FindOrnamentTypeOrCreate(ctx, name); err != nil {
			return fmt.Errorf("create ornament type %q: %w", name, err)
		}
	}
	rep.created("ornament types", len(ornamentTypeFixtures))
	for i, f := range lockerFixtures {
		v, err := locker.SaveLocker(ctx, locker.CreateInput{
			Code:     f.Code,
			BranchID: st.branchIDs[i%len(st.branchIDs)],
			Capacity: f.Capacity,
		})
		if err != nil {
			return fmt.Errorf("create locker %q: %w", f.Code, err)
		}
		st.lockerIDs = append(st.lockerIDs, v.ID)
	}
	rep.created("lockers", len(lockerFixtures))
	return nil
}

func seedPurityStandards(ctx context.Context, rep *Report) error {
	n := 0
	for karat := 24; karat >= 10; karat-- {
		k := karat
		fineness := common.FinenessForKarat(k)
		if _, _, err := common.FindPurityStandardOrCreate(ctx, common.PurityStandardCreateInput{
			Karat:           &k,
			FinenessPercent: &fineness,
			Label:           fmt.Sprintf("%dK (%.1f%%)", k, fineness),
		}); err != nil {
			return fmt.Errorf("create purity standard %dK: %w", k, err)
		}
		n++
	}
	rep.created("purity standards", n)
	return nil
}

func seedGoldRates(ctx context.Context, st *state, rep *Report) error {
	last := len(goldRateFixtures) - 1
	for i, k24 := range goldRateFixtures {
		// 22K / 18K at the standard 91.6% / 75% fineness, saved the way the Set Gold Rate modal's Auto mode does.
		if _, err := common.SaveGoldRate(ctx, common.PublishInput{
			Date:        st.clk.daysAgo(last - i),
			Karat:       24,
			Rate:        k24,
			SetBy:       "Admin",
			Designation: "Branch Manager",
			Rates:       map[int]float64{24: k24, 22: math.Round(k24 * 0.916), 18: math.Round(k24 * 0.75)},
		}); err != nil {
			return fmt.Errorf("publish gold rate for %s: %w", st.clk.daysAgo(last-i).Format("2006-01-02"), err)
		}
	}
	rep.created("gold rates", len(goldRateFixtures))
	latest, err := common.LatestGoldRate(ctx)
	if err != nil {
		return fmt.Errorf("read back today's gold rate: %w", err)
	}
	if !sameDay(latest.Date, st.clk.today) {
		return fmt.Errorf("latest gold rate is dated %s, not today (%s) — loans cannot be created",
			latest.Date.Format("2006-01-02"), st.clk.today.Format("2006-01-02"))
	}
	return nil
}

func sameDay(a, b time.Time) bool {
	ay, am, ad := a.Date()
	by, bm, bd := b.Date()
	return ay == by && am == bm && ad == bd
}

func seedSchemes(ctx context.Context, st *state, rep *Report) error {
	for i, f := range schemeFixtures {
		in := common.SchemeCreateInput{
			Name:           f.Name,
			BranchID:       st.branchIDs[i%len(st.branchIDs)],
			InterestRate:   f.InterestRate,
			DurationMonths: f.DurationMonths,
			LTVPercent:     f.LTVPercent,
			InterestMethod: f.InterestMethod,
			PenalRate:      f.PenalRate,
			IsActive:       f.Active,
			AccrualBasis:   schemeAccrualBasis(i),
			Conditions:     "Interest is payable monthly. Pledged gold is returned on full settlement.",
		}
		if i == 7 {
			in.ServiceChargeType = commonModels.ServiceChargeTypeFlat
			in.ServiceChargeValue = 250
			in.ServiceChargeMode = commonModels.ServiceChargeModeAddedToPrincipal
		}
		s, err := common.SaveScheme(ctx, in)
		if err != nil {
			return fmt.Errorf("create scheme %q: %w", f.Name, err)
		}
		if f.Active {
			st.schemeIDs = append(st.schemeIDs, s.ID)
		}
	}
	rep.created("schemes", len(schemeFixtures))
	return nil
}

// schemeAccrualBasis charges the flat-monthly schemes by the calendar month, the rest by the day.
func schemeAccrualBasis(i int) string {
	if schemeFixtures[i].InterestMethod == "Flat monthly" {
		return commonModels.AccrualBasisMonthly
	}
	return commonModels.AccrualBasisDaily
}

func seedCashAndExpenses(ctx context.Context, st *state, rep *Report) error {
	balances := 0
	for _, day := range []time.Time{st.clk.daysAgo(1), st.clk.today} {
		for i, branchID := range st.branchIDs {
			amount := float64(75000 + i*15000)
			if _, err := cash.SaveOpeningBalance(ctx, branchID, day, cashModels.CashModeCash, nil, nil, amount); err != nil {
				return fmt.Errorf("set opening balance for branch %d on %s: %w",
					branchID, day.Format("2006-01-02"), err)
			}
			balances++
		}
	}
	rep.created("opening cash balances", balances)
	for _, branchID := range st.branchIDs {
		id := branchID
		if _, err := cash.SaveMovement(ctx, cash.RecordMovementInput{
			Type:       "in",
			Source:     "Capital",
			Mode:       cashModels.CashModeCash,
			Amount:     3000000,
			BranchID:   &id,
			OccurredOn: st.clk.daysAgo(500),
			Remarks:    "Opening capital introduced",
			Manual:     true,
		}, nil); err != nil {
			return fmt.Errorf("record opening capital for branch %d: %w", branchID, err)
		}
	}
	for i, f := range cashMovementFixtures {
		branchID := st.branchIDs[i%len(st.branchIDs)]
		if f.Bank != "" {
			branchID = st.branchIDs[0]
		}
		var loanSource *cash.LoanSourceInput
		if f.Source == "Loan" {
			rate, months := 9.5, 24
			loanSource = &cash.LoanSourceInput{
				LoanNumber:      fmt.Sprintf("BL-DEMO-%03d", i+1),
				PrincipalAmount: f.Amount * 2,
				InterestRate:    &rate,
				DurationMonths:  &months,
			}
		}
		var bankID *uint
		if f.Bank != "" {
			id, err := seededBankID(st, f.Bank)
			if err != nil {
				return err
			}
			bankID = &id
		}
		if _, err := cash.SaveMovement(ctx, cash.RecordMovementInput{
			Type:       f.Type,
			Source:     f.Source,
			Purpose:    f.Purpose,
			Mode:       f.Mode,
			Bank:       f.Bank,
			BankID:     bankID,
			Amount:     f.Amount,
			BranchID:   &branchID,
			OccurredOn: st.clk.daysAgo(f.DaysAgo),
			Remarks:    "Demo entry",
			Manual:     true,
		}, loanSource); err != nil {
			return fmt.Errorf("record cash movement %d: %w", i+1, err)
		}
	}
	rep.created("cash movements", len(cashMovementFixtures))
	expenseIDs := make([]uint, 0, len(expenseFixtures))
	pending := make([]bool, 0, len(expenseFixtures))
	payingBankID, err := seededBankID(st, "State Bank of India")
	if err != nil {
		return err
	}
	for i, f := range expenseFixtures {
		var receipt string
		if i < 4 && i < len(st.uploadKeys) {
			receipt = st.uploadKeys[i]
		}
		branchID := st.branchIDs[i%len(st.branchIDs)]
		var fromBankID *uint
		if f.Mode != "Cash" {
			branchID, fromBankID = st.branchIDs[0], &payingBankID
		}
		e, err := cash.SaveExpense(ctx, cash.RecordExpenseInput{
			OccurredOn:   st.clk.daysAgo(2 + i*2),
			Category:     f.Category,
			Amount:       f.Amount,
			Mode:         f.Mode,
			Payee:        f.Payee,
			BranchID:     branchID,
			FromBankID:   fromBankID,
			Remarks:      f.Remarks,
			ReceiptImage: receipt,
		})
		if err != nil {
			return fmt.Errorf("record expense %q: %w", f.Category, err)
		}
		expenseIDs = append(expenseIDs, e.ID)
		pending = append(pending, e.Status == "Pending")
	}
	rep.created("expenses", len(expenseIDs))
	for i, id := range expenseIDs {
		if !pending[i] {
			continue
		}
		switch {
		case i < 8:
			if _, err := cash.SaveExpenseApproval(ctx, id, "Admin", nil); err != nil {
				return fmt.Errorf("approve expense %d: %w", id, err)
			}
		case i < 10:
			if _, err := cash.SaveExpenseRejection(ctx, id, "Admin", "Not budgeted this quarter", nil); err != nil {
				return fmt.Errorf("reject expense %d: %w", id, err)
			}
		}
	}
	return nil
}

// seededBankID is the id of the bank seeded from the bankFixtures entry with this name.
func seededBankID(st *state, name string) (uint, error) {
	for i, f := range bankFixtures {
		if f.Name == name && i < len(st.bankIDs) {
			return st.bankIDs[i], nil
		}
	}
	return 0, fmt.Errorf("bank %q was not seeded", name)
}

func seedReminders(ctx context.Context, st *state, rep *Report) error {
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
		if i%2 == 0 && i < len(st.loanIDs) {
			id := st.loanIDs[i]
			in.LoanID = &id
		}
		r, err := reminder.SaveReminder(ctx, in)
		if err != nil {
			return fmt.Errorf("create reminder %d: %w", i+1, err)
		}
		ids = append(ids, r.ID)
	}
	rep.created("reminders", len(ids))
	for i, id := range ids {
		var status string
		switch {
		case i < 3:
			status = "Done"
		case i < 5:
			status = "Cancelled"
		default:
			continue
		}
		if err := config.BaseDB.WithContext(ctx).
			Model(&reminderModels.Reminder{}).
			Where("id = ?", id).
			Update("status", status).Error; err != nil {
			return fmt.Errorf("set reminder %d status: %w", id, err)
		}
	}
	return nil
}

func seedCommsAndAudit(ctx context.Context, st *state, rep *Report) error {
	if len(st.customerIDs) == 0 {
		return nil
	}
	for i, f := range notificationFixtures {
		n := commonModels.Notification{
			CustomerID: st.customerIDs[i%len(st.customerIDs)],
			Type:       f.Type,
			Title:      f.Title,
			Body:       f.Body,
			Delivered:  f.Delivered,
			Read:       f.Read,
			CreatedAt:  st.clk.daysAgo(f.DaysAgo),
		}
		if i < len(st.loanIDs) {
			n.RelatedEntityType = "loan"
			n.RelatedEntityID = st.loanIDs[i]
		}
		n.TenantID = st.tenantID
		if err := common.InsertNotification(ctx, &n); err != nil {
			return fmt.Errorf("create notification %d: %w", i+1, err)
		}
	}
	rep.created("notifications", len(notificationFixtures))
	for i, f := range commlogFixtures {
		cf := customerFixtures[i%len(customerFixtures)]
		rec := commonModels.CommunicationLog{
			RecipientName:  cf.Name,
			RecipientPhone: cf.Phone,
			ChatID:         common.NormalizeChatID(cf.Phone),
			Channel:        commonModels.ChannelWhatsApp,
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
		if err := common.InsertCommLog(ctx, &rec); err != nil {
			return fmt.Errorf("create communication log %d: %w", i+1, err)
		}
	}
	rep.created("message logs", len(commlogFixtures))
	branchAudits := []struct {
		action, name, detail string
	}{
		{commonModels.ActionBranchCreated, "Thrissur", "Branch opened"},
		{commonModels.ActionBranchCreated, "Kochi", "Branch opened"},
		{commonModels.ActionBranchCreated, "Kozhikode", "Branch opened"},
		{commonModels.ActionBranchUpdated, "Kannur", "Address updated"},
		{commonModels.ActionBranchUpdated, "Palakkad", "Phone number updated"},
		{"branch_deactivated", "Malappuram", "Branch closed for consolidation"},
		{"employee_updated", "Sreejith Varma", "Role changed to Cashier"},
		{"employee_updated", "Divya Pillai", "Branch reassigned"},
	}
	for i, a := range branchAudits {
		entityType, entityID := "branch", st.branchIDs[i%len(st.branchIDs)]
		if a.action == "employee_updated" {
			entityType = "employee"
			for k, f := range employeeFixtures {
				if f.Name == a.name && k < len(st.employeeIDs) {
					entityID = st.employeeIDs[k]
				}
			}
		}
		e := commonModels.Entry{
			ActorEmployeeID: st.keep.adminID,
			ActorName:       "Admin",
			Action:          a.action,
			EntityType:      entityType,
			EntityID:        entityID,
			EntityName:      a.name,
			Detail:          a.detail,
			CreatedAt:       st.clk.daysAgo(20 - i),
		}
		e.TenantID = st.tenantID
		if err := common.InsertAuditLog(ctx, &e); err != nil {
			return fmt.Errorf("create audit entry %d: %w", i+1, err)
		}
	}
	rep.created("audit log entries", len(branchAudits))
	return nil
}

func seedSnapshots(ctx context.Context, st *state, rep *Report) error {
	n := 0
	for i := 13; i >= 0; i-- {
		if i == 0 {
			break
		}
		d := st.clk.daysAgo(i)
		s := dashboardModels.Snapshot{
			Date:                 time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, d.Location()),
			ActiveCount:          18 + (13 - i),
			OverdueCount:         3 + (13-i)/3,
			PendingApprovalCount: 6 - (13-i)/5,
			OpenedTodayCount:     1 + (13-i)%3,
			DueTodayCount:        (13 - i) % 4,
		}
		if err := config.BaseDB.WithContext(ctx).Create(&s).Error; err != nil {
			return fmt.Errorf("create dashboard snapshot for %s: %w", s.Date.Format("2006-01-02"), err)
		}
		n++
	}
	if err := dashboard.CaptureDailySnapshot(ctx); err != nil {
		return fmt.Errorf("capture today's dashboard snapshot: %w", err)
	}
	rep.created("dashboard snapshots", n+1)
	return nil
}

func seedPacketsAndPledges(ctx context.Context, st *state, rep *Report) error {
	moves := 0
	for i, p := range packetMovePlans {
		n, err := walkPacket(ctx, st, p.loanIdx, firstHop(p.path), i)
		if err != nil {
			return err
		}
		moves += n
	}
	actor := st.keep.adminID
	pledges := 0
	for _, p := range pledgePlans {
		if p.loanIdx >= len(st.loanIDs) || p.bankIdx >= len(bankFixtures) {
			continue
		}
		f := bankFixtures[p.bankIdx]
		due := st.clk.daysAhead(120)
		var ornamentIDs []uint
		if orns, err := loan.FindByLoanID(ctx, st.loanIDs[p.loanIdx]); err == nil {
			for _, o := range orns {
				ornamentIDs = append(ornamentIDs, o.ID)
			}
		}
		bankID := st.bankIDs[p.bankIdx]
		if _, err := loan.SaveBankPledge(ctx, st.loanIDs[p.loanIdx], nil, loan.BankPledgeInput{
			BankID:            &bankID,
			OrnamentIDs:       ornamentIDs,
			BankName:          f.Name,
			PledgedAmount:     p.amount,
			PledgeDate:        st.clk.daysAgo(p.daysAgo),
			BankInterestRate:  9.5,
			ReferenceNumber:   fmt.Sprintf("BP-DEMO-%02d", p.loanIdx),
			BankPledgeDueDate: &due,
			CashTreatment:     p.treatment,
			ActorEmployeeID:   &actor,
			ActorRole:         "Administrator",
		}); err != nil {
			return fmt.Errorf("record bank pledge on loan index %d: %w", p.loanIdx, err)
		}
		pledges++
		if p.releaseAfter {
			var pledgeID uint
			if err := config.BaseDB.WithContext(ctx).Table("bank_pledge_records").
				Where("loan_id = ? AND tenant_id = ?", st.loanIDs[p.loanIdx], st.tenantID).
				Order("id DESC").Limit(1).Pluck("id", &pledgeID).Error; err != nil || pledgeID == 0 {
				return fmt.Errorf("find the bank pledge on loan index %d: %v", p.loanIdx, err)
			}
			if _, err := loan.ReleasePledge(ctx, st.loanIDs[p.loanIdx], pledgeID, loan.BankPledgeReleaseInput{}, &actor, "Administrator"); err != nil {
				return fmt.Errorf("release bank pledge on loan index %d: %w", p.loanIdx, err)
			}
		}
	}
	rep.created("bank pledges", pledges)
	for i, p := range packetMovePlans {
		n, err := walkPacket(ctx, st, p.loanIdx, remainingHops(p.path), i)
		if err != nil {
			return err
		}
		moves += n
	}
	rep.created("packet movements", moves)
	return nil
}

func firstHop(path []string) []string {
	if len(path) == 0 {
		return nil
	}
	return path[:1]
}

func remainingHops(path []string) []string {
	if len(path) < 2 {
		return nil
	}
	return path[1:]
}

func walkPacket(ctx context.Context, st *state, loanIdx int, hops []string, lockerSeed int) (int, error) {
	if len(hops) == 0 || loanIdx >= len(st.loanIDs) {
		return 0, nil
	}
	pk, err := packet.FindActiveByLoanID(ctx, st.loanIDs[loanIdx])
	if err != nil {
		return 0, nil
	}
	moved := 0
	for _, status := range hops {
		var lockerID *uint
		if status == packetModels.StatusLockerStored && len(st.lockerIDs) > 0 {
			id := st.lockerIDs[lockerSeed%len(st.lockerIDs)]
			lockerID = &id
		}
		if _, err := packet.SavePacketMovement(ctx, pk.ID, status, lockerID, st.keep.adminID, "Demo movement"); err != nil {
			return moved, fmt.Errorf("move packet for loan index %d to %q: %w", loanIdx, status, err)
		}
		moved++
	}
	return moved, nil
}

func seedPayments(ctx context.Context, st *state, rep *Report) error {
	n := 0
	for i, p := range paymentPlans {
		if p.loanIdx >= len(st.loanIDs) {
			continue
		}
		if isAuctionPool(p.loanIdx) {
			return fmt.Errorf(
				"payment plan targets auction-pool loan index %d: this would clear its arrears and make the auctions step fail with ErrLoanNotDefaulted",
				p.loanIdx)
		}
		ok, err := recordPayment(ctx, st, st.loanIDs[p.loanIdx], p, st.clk.daysAgo(p.daysAgo), i)
		if err != nil {
			return fmt.Errorf("record %s payment on loan index %d: %w", p.kind, p.loanIdx, err)
		}
		if ok {
			n++
		}
	}
	rep.created("loan payments", n)
	return nil
}

// recordPayment sizes a payment from what the loan owed on paidOn and records it through the real payment
// path, with the cash split the payment screen sends (and a discount when the plan gives one).
func recordPayment(ctx context.Context, st *state, loanID uint, p paymentPlan, paidOn time.Time, seq int) (bool, error) {
	fee, penal, interest, principal, err := loan.OwedAsOf(ctx, loanID, paidOn)
	if err != nil {
		return false, err
	}
	in := loan.PaymentInput{
		Type:                 p.kind,
		PaidOn:               paidOn,
		ReceivedByEmployeeID: &st.keep.adminID,
		Description:          p.description,
		CheckDateWindow:      true,
	}
	if p.discountKind != "" {
		var base float64
		switch p.discountKind {
		case loan.DiscountKindPenalInterest:
			base = penal
		case loan.DiscountKindInterest:
			base = interest
		default:
			base = penal + interest + principal
		}
		if d := math.Floor(base * p.discountFraction); d >= 1 {
			in.Discount, in.DiscountKind, in.DiscountReason, in.DiscountMode = d, p.discountKind, p.discountReason, "Cash"
			switch p.discountKind {
			case loan.DiscountKindPenalInterest:
				penal -= d
			case loan.DiscountKindInterest:
				interest -= d
			default:
				// a customer discount falls through penal interest, interest, then principal
				for _, b := range []*float64{&penal, &interest, &principal} {
					take := math.Min(d, *b)
					*b -= take
					d -= take
				}
			}
		}
	}
	var ceiling float64
	switch p.kind {
	case loanModels.PaymentTypeInterest:
		ceiling = fee + penal + interest
	case loanModels.PaymentTypePenalInterest:
		ceiling = fee + penal
	case loanModels.PaymentTypePrincipal:
		ceiling = fee + principal
	default:
		ceiling = fee + penal + interest + principal
	}
	amount := math.Floor(ceiling * p.fraction)
	if p.fraction >= 1 {
		// a Full Settlement has to cover the balance exactly, so it is never rounded down
		amount = math.Round(ceiling*100) / 100
	}
	if amount < 1 {
		return false, nil
	}
	in.Amount = amount
	switch p.mode {
	case "UPI", "Bank Transfer":
		if len(st.bankIDs) == 0 {
			return false, fmt.Errorf("no banks seeded for a %s payment", p.mode)
		}
		bankID := st.bankIDs[seq%len(st.bankIDs)]
		in.BankID = &bankID
		if p.mode == "UPI" {
			in.UpiAmount = amount
		} else {
			in.BankTransferAmount = amount
		}
	default:
		in.CashAmount = amount
	}
	if _, err := loan.SaveLoanPayment(ctx, loanID, in); err != nil {
		return false, fmt.Errorf("%.2f on %s: %w", amount, paidOn.Format("2006-01-02"), err)
	}
	return true, nil
}

// topUpPlans tops up two running loans; any interest owed is deducted from the top-up payout.
var topUpPlans = []struct {
	loanIdx int
	amount  float64
	daysAgo int
}{
	{16, 10000, 2},
	{18, 15000, 1},
}

func seedTopUps(ctx context.Context, st *state, rep *Report) error {
	n := 0
	for _, p := range topUpPlans {
		if p.loanIdx >= len(st.loanIDs) {
			continue
		}
		loanID := st.loanIDs[p.loanIdx]
		if _, err := loan.TopUp(ctx, loanID, loan.TopUpInput{
			Amount:               p.amount,
			CashAmount:           p.amount,
			OccurredOn:           st.clk.daysAgo(p.daysAgo),
			SettleInterest:       "deduct",
			ReceivedByEmployeeID: st.keep.adminID,
		}); err != nil {
			return fmt.Errorf("top up loan index %d: %w", p.loanIdx, err)
		}
		ups, err := loan.ListLoanTopUps(ctx, loanID)
		if err != nil {
			return fmt.Errorf("read top-ups of loan index %d: %w", p.loanIdx, err)
		}
		for _, u := range ups {
			cur := u.ApprovalStage
			for cur != "" {
				key, ok, err := requestStageKey(ctx, common.FlowLoanTopUp, cur, cur)
				if err != nil {
					return err
				}
				if !ok {
					break
				}
				next, err := loan.ApproveTopUpRequest(ctx, u.ID, loan.TopUpApprovalInput{
					Stage:           key,
					Action:          loanModels.ApprovalStageApproved,
					ActorEmployeeID: st.keep.adminID,
					ActorRole:       "Administrator",
					ActorRoleID:     st.adminRoleID,
					Remarks:         "Demo approval",
				})
				if err != nil {
					return fmt.Errorf("approve top-up on loan index %d: %w", p.loanIdx, err)
				}
				cur = next.ApprovalStage
			}
		}
		n++
	}
	rep.created("loan top-ups", n)
	return nil
}

func seedPersonalLoans(ctx context.Context, st *state, rep *Report) error {
	if len(st.customerIDs) == 0 {
		return fmt.Errorf("no customers to attach personal loans to")
	}
	created := 0
	ids := make([]uint, 0, len(personalLoanFixtures))
	for i, f := range personalLoanFixtures {
		l, err := personalLoan.SavePersonalLoan(ctx, personalLoan.CreateInput{
			BranchID:            st.branchIDs[i%len(st.branchIDs)],
			CustomerID:          st.customerIDs[i%len(st.customerIDs)],
			PrincipalAmount:     f.Principal,
			InterestType:        f.InterestType,
			InterestValue:       f.Value,
			Frequency:           f.Frequency,
			TenureCount:         f.Tenure,
			CreatedByEmployeeID: st.keep.adminID,
		})
		if err != nil {
			return fmt.Errorf("create personal loan %d: %w", i+1, err)
		}
		ids = append(ids, l.ID)
		created++
	}
	rep.created("personal loans", created)
	payments := 0
	for i := range ids {
		receipts := 1
		if i%2 == 0 {
			receipts = 2
		}
		amount := personalLoanFixtures[i].Principal / float64(personalLoanFixtures[i].Tenure)
		for r := 0; r < receipts; r++ {
			if _, err := personalLoan.SavePersonalLoanPayment(ctx, ids[i], nil, personalLoan.PaymentInput{
				Amount:               amount,
				ReceivedByEmployeeID: &st.keep.adminID,
				CashAmount:           amount,
				Description:          "Demo installment receipt",
			}); err != nil {
				return fmt.Errorf("record personal loan payment %d on loan %d: %w", r+1, i+1, err)
			}
			payments++
		}
	}
	// two loans are paid off in full, which closes them the way a real final receipt does
	for _, i := range []int{9, 10} {
		if i >= len(ids) {
			continue
		}
		var pl personalLoanModels.PersonalLoan
		if err := config.BaseDB.WithContext(ctx).First(&pl, ids[i]).Error; err != nil {
			return fmt.Errorf("read personal loan %d: %w", i+1, err)
		}
		if pl.OutstandingAmount < 1 {
			continue
		}
		if _, err := personalLoan.SavePersonalLoanPayment(ctx, ids[i], nil, personalLoan.PaymentInput{
			Amount:               pl.OutstandingAmount,
			ReceivedByEmployeeID: &st.keep.adminID,
			CashAmount:           pl.OutstandingAmount,
			Description:          "Final receipt — loan closed",
		}); err != nil {
			return fmt.Errorf("close personal loan %d: %w", i+1, err)
		}
		payments++
	}
	rep.created("personal loan payments", payments)
	return nil
}

func seedInvestments(ctx context.Context, st *state, rep *Report) error {
	for _, f := range investmentPlanFixtures {
		p, err := investment.SaveInvestmentPlan(ctx, investment.PlanInput{
			Name:                f.Name,
			InterestRateType:    f.RateType,
			InterestRatePercent: f.RatePercent,
			PayoutFrequency:     f.PayoutFrequency,
			TenureMonths:        f.TenureMonths,
			MinPrincipal:        f.MinPrincipal,
			IsActive:            f.Active,
		})
		if err != nil {
			return fmt.Errorf("create investment plan %q: %w", f.Name, err)
		}
		if f.Active {
			st.planIDs = append(st.planIDs, p.ID)
		} else if err := config.BaseDB.WithContext(ctx).Table("investment_plans").
			Where("id = ?", p.ID).Update("is_active", false).Error; err != nil {
			return fmt.Errorf("retire investment plan %q: %w", f.Name, err)
		}
	}
	rep.created("investment plans", len(investmentPlanFixtures))
	if len(st.planIDs) == 0 {
		return fmt.Errorf("no active investment plans to invest into")
	}
	var investors []uint
	for i, f := range customerFixtures {
		if f.Investor && i < len(st.customerIDs) {
			investors = append(investors, st.customerIDs[i])
		}
	}
	if len(investors) == 0 {
		investors = st.customerIDs
	}
	ids := make([]uint, 0, 12)
	for i := 0; i < 12; i++ {
		principal := float64(500000 + i*100000)
		inv, err := investment.SaveInvestment(ctx, investment.CreateInput{
			BranchID:            st.branchIDs[i%len(st.branchIDs)],
			CustomerID:          investors[i%len(investors)],
			PlanID:              st.planIDs[i%len(st.planIDs)],
			PrincipalAmount:     principal,
			StartDate:           st.clk.monthsAgo(i % 10),
			CreatedByEmployeeID: st.keep.adminID,
		})
		if err != nil {
			return fmt.Errorf("create investment %d: %w", i+1, err)
		}
		ids = append(ids, inv.ID)
	}
	rep.created("investments", len(ids))
	paid := 0
	for i := 0; i < 4 && i < len(ids); i++ {
		payouts, _, err := investment.FindPayoutSchedule(ctx, ids[i], nil, 12, 0)
		if err != nil {
			continue
		}
		for j, po := range payouts {
			if j >= 4 || po.DueDate.After(st.clk.today) {
				break
			}
			if _, err := investment.SavePayoutPayment(ctx, ids[i], po.ID, nil, st.keep.adminID, investment.MarkPayoutPaidInput{CashAmount: po.Amount}); err != nil {
				continue
			}
			paid++
		}
	}
	rep.created("investment payouts paid", paid)
	return nil
}
