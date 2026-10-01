// Package workflow holds the per-tenant approval-workflow configuration:
// which stages of each approval flow (loan sanction, extension, release,
// expense, auction decisions, top-up, waiver, personal loan) are switched
// on for a business. The stage list itself is fixed in code (Catalogue);
// only the on/off per stage is stored (ApprovalStageSetting). Who may act
// at a stage stays with the role-permission grants (internal/authz).
//
// It imports nothing from internal/loan, internal/cash or
// internal/personalloan, so all of them can depend on it without a cycle.
package workflow

// Flow keys — one per configurable approval flow.
const (
	FlowLoanSanction            = "loan_sanction"
	FlowLoanExtension           = "loan_extension"
	FlowLoanRelease             = "loan_release"
	FlowAuctionPartialRepayment = "auction_partial_repayment"
	FlowAuctionShortfall        = "auction_shortfall"
	FlowExpense                 = "expense"
	FlowLoanTopUp               = "loan_topup"
	FlowLoanWaiver              = "loan_waiver"
	FlowPersonalLoan            = "personal_loan"
)

// StageDef is one fixed stage of a flow. Key is what clients send when
// acting on it; Pending is the value stored on the item's ApprovalStage/
// status column while it waits at this stage (kept identical to the values
// already in the database, so items in flight keep working).
type StageDef struct {
	Key            string `json:"key"`
	Pending        string `json:"pending"`
	Label          string `json:"label"`
	Role           string `json:"role"`
	Permission     string `json:"permission"`
	Module         string `json:"module"`
	DefaultEnabled bool   `json:"defaultEnabled"`
}

// FlowDef is one flow and its stages in canonical order. MinEnabled > 0
// means the flow can never be switched fully off (loan sanction: its last
// enabled stage is where the loan is disbursed). FinalAction names what the
// last enabled stage does ("disburses"), and OffBehavior says what happens
// when every stage is off — both shown on the admin screen and trackers.
type FlowDef struct {
	Key         string     `json:"key"`
	Label       string     `json:"label"`
	FinalAction string     `json:"finalAction"`
	OffBehavior string     `json:"offBehavior"`
	MinEnabled  int        `json:"minEnabled"`
	Stages      []StageDef `json:"stages"`
}

const (
	pendingBranchManager = "PendingBranchManager"
	pendingManagement    = "PendingManagement"
)

// Catalogue is every configurable flow, in the order the admin screen shows
// them. Permission names must exist in authz.Catalogue.
var Catalogue = []FlowDef{
	{
		Key: FlowLoanSanction, Label: "Gold loan sanction", FinalAction: "disburses",
		OffBehavior: "At least one stage must stay on — the last enabled stage disburses the loan.",
		MinEnabled:  1,
		Stages: []StageDef{
			{"LoanOperator", "LoanOperator", "Loan Operator", "Loan Operator", "can verify loan", "Loan Sanction", true},
			{"BranchManager", "BranchManager", "Branch Manager", "Branch Manager", "can approve branch manager stage", "Loan Sanction", true},
			{"FinalSanction", "FinalSanction", "Final Sanction", "Management", "can sanction loan", "Loan Sanction", true},
		},
	},
	{
		Key: FlowLoanExtension, Label: "Loan extension", FinalAction: "extends",
		OffBehavior: "The extension is applied as soon as the request is raised.",
		Stages: []StageDef{
			{"LoanOfficer", "PendingLoanOfficer", "Loan Officer", "Loan Operator", "can verify the loan extension", "Loan Extension Approval", true},
			{"BranchManager", pendingBranchManager, "Branch Manager", "Branch Manager", "can approve extension branch manager stage", "Loan Extension Approval", true},
			{"Management", pendingManagement, "Management", "Management", "can approve extension management stage", "Loan Extension Approval", true},
		},
	},
	{
		Key: FlowLoanRelease, Label: "Gold release", FinalAction: "releases",
		OffBehavior: "The release completes as soon as the checklist is done and the payment is recorded.",
		Stages: []StageDef{
			{"Manager", "PendingManager", "Manager", "Branch Manager", "can approve release manager stage", "Release Approval", true},
			{"Management", pendingManagement, "Management", "Management", "can approve release management stage", "Release Approval", true},
		},
	},
	{
		Key: FlowAuctionPartialRepayment, Label: "Auction — partial repayment decision", FinalAction: "decides",
		OffBehavior: "The loan automatically stays in auction (Keep in Auction); no decision request is raised.",
		Stages: []StageDef{
			{"Decision", "Pending", "Decision", "Branch Manager", "can decide auction partial repayment", "Auction Workflow", true},
		},
	},
	{
		Key: FlowAuctionShortfall, Label: "Auction — shortfall decision", FinalAction: "decides",
		OffBehavior: "The balance is automatically pursued (loan moves to Overdue); a write-off is not possible.",
		Stages: []StageDef{
			{"Decision", "Pending", "Decision", "Management", "can decide auction shortfall", "Auction Workflow", true},
		},
	},
	{
		Key: FlowExpense, Label: "Expense", FinalAction: "posts",
		OffBehavior: "Expenses are recorded and posted to the ledger immediately.",
		Stages: []StageDef{
			{"Approver", "Pending", "Approver", "Branch Manager", "can approve expense", "Expense Approval", false},
		},
	},
	{
		Key: FlowLoanTopUp, Label: "Loan top-up", FinalAction: "disburses",
		OffBehavior: "Top-ups are paid out immediately.",
		Stages: []StageDef{
			{"BranchManager", pendingBranchManager, "Branch Manager", "Branch Manager", "can approve top-up branch manager stage", "Top-Up Approval", false},
			{"Management", pendingManagement, "Management", "Management", "can approve top-up management stage", "Top-Up Approval", false},
		},
	},
	{
		Key: FlowLoanWaiver, Label: "Waiver / adjustment", FinalAction: "posts",
		OffBehavior: "Waivers and adjustments are posted to the loan immediately.",
		Stages: []StageDef{
			{"BranchManager", pendingBranchManager, "Branch Manager", "Branch Manager", "can approve waiver branch manager stage", "Waiver Approval", true},
			{"Management", pendingManagement, "Management", "Management", "can approve waiver management stage", "Waiver Approval", true},
		},
	},
	{
		Key: FlowPersonalLoan, Label: "Personal loan", FinalAction: "disburses",
		OffBehavior: "Personal loans are created active and disbursed immediately.",
		Stages: []StageDef{
			{"BranchManager", pendingBranchManager, "Branch Manager", "Branch Manager", "can approve personal loan branch manager stage", "Personal Loan Approval", false},
			{"Management", pendingManagement, "Management", "Management", "can approve personal loan management stage", "Personal Loan Approval", false},
		},
	},
}

// FindFlow returns the catalogue entry for key.
func FindFlow(key string) (FlowDef, bool) {
	for _, f := range Catalogue {
		if f.Key == key {
			return f, true
		}
	}
	return FlowDef{}, false
}
