// Package workflow holds the per-tenant approval-workflow configuration:
// for each approval flow (loan sanction, extension, release, expense,
// auction decisions, top-up, personal loan) the ordered chain of
// roles that must approve it (ApprovalChain). Flows are grouped into
// categories, and a category can share one chain across all of its flows
// (ApprovalCategoryMode). Who may act at a stage is the stage's role, or
// Administrator — the chain alone decides.
//
// The fixed stage lists in Catalogue are legacy seed data only: they give a
// tenant that has never saved a chain its default (the behaviour it had
// before chains existed), and let items still parked on an old pending
// value find their stage.
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
	FlowPersonalLoan            = "personal_loan"
)

// Category keys — how the admin screen groups flows.
const (
	CategoryGoldLoan     = "gold_loan"
	CategoryPersonalLoan = "personal_loan"
	CategoryAuction      = "auction"
	CategoryExpense      = "expense"
)

// CategoryDef is one group of flows on the admin screen.
type CategoryDef struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

// Categories in the order the admin screen shows them.
var Categories = []CategoryDef{
	{CategoryGoldLoan, "Gold Loan", "Sanction, extension, release and top-up of gold loans."},
	{CategoryPersonalLoan, "Personal Loan", "Sanction of personal loans."},
	{CategoryAuction, "Auction", "Decisions taken while a loan is in auction."},
	{CategoryExpense, "Expense", "Approval of recorded expenses before they post to the ledger."},
}

// FindCategory returns the category with key.
func FindCategory(key string) (CategoryDef, bool) {
	for _, c := range Categories {
		if c.Key == key {
			return c, true
		}
	}
	return CategoryDef{}, false
}

// FlowsOf returns the flows of one category, in catalogue order.
func FlowsOf(category string) []FlowDef {
	var out []FlowDef
	for _, f := range Catalogue {
		if f.Category == category {
			out = append(out, f)
		}
	}
	return out
}

// StageDef is one stage of a flow. Key is what clients send when acting on
// it; Pending is the value stored on the item's ApprovalStage/status column
// while it waits at this stage. A role-chain stage has Key = Pending =
// "R<roleID>" and Label = Role = the role's name. The Catalogue's legacy
// stages keep their historical values so items stored with them still match.
type StageDef struct {
	Key            string `json:"key"`
	Pending        string `json:"pending"`
	Label          string `json:"label"`
	Role           string `json:"role"`
	Permission     string `json:"permission"`
	Module         string `json:"module"`
	DefaultEnabled bool   `json:"defaultEnabled"`
	RoleID         uint   `json:"roleId"`
}

// FlowDef is one flow. MinEnabled > 0 means the chain can never be empty
// (loan sanction: its last step is where the loan is disbursed); MaxSteps
// > 0 caps the chain length (auction decisions have one decider).
// FinalAction names what the last step does ("disburses"), and OffBehavior
// says what happens when the chain is empty — both shown on the admin
// screen and trackers. ActionLabel is the short name used inside its
// category ("Sanction"). Stages is the legacy seed chain (see package doc).
type FlowDef struct {
	Key         string     `json:"key"`
	Label       string     `json:"label"`
	ActionLabel string     `json:"actionLabel"`
	Category    string     `json:"category"`
	FinalAction string     `json:"finalAction"`
	OffBehavior string     `json:"offBehavior"`
	MinEnabled  int        `json:"minEnabled"`
	MaxSteps    int        `json:"maxSteps"`
	Stages      []StageDef `json:"stages"`
}

const (
	pendingBranchManager = "PendingBranchManager"
	pendingManagement    = "PendingManagement"
)

// legacy builds one legacy seed stage.
func legacy(key, pending, label, role, permission, module string, on bool) StageDef {
	return StageDef{Key: key, Pending: pending, Label: label, Role: role, Permission: permission, Module: module, DefaultEnabled: on}
}

// Catalogue is every configurable flow, in the order the admin screen shows
// them within their category. Legacy stage Role values are the role names
// seeded by authz.StaffRoles.
var Catalogue = []FlowDef{
	{
		Key: FlowLoanSanction, Label: "Gold loan sanction", ActionLabel: "Sanction", Category: CategoryGoldLoan,
		FinalAction: "disburses",
		OffBehavior: "At least one approver is required — the last approver disburses the loan.",
		MinEnabled:  1,
		Stages: []StageDef{
			legacy("LoanOperator", "LoanOperator", "Loan Operator", "Loan Operator", "can verify loan", "Loan Sanction", true),
			legacy("BranchManager", "BranchManager", "Branch Manager", "Branch Manager", "can approve branch manager stage", "Loan Sanction", true),
			legacy("FinalSanction", "FinalSanction", "Final Sanction", "Management", "can sanction loan", "Loan Sanction", true),
		},
	},
	{
		Key: FlowLoanExtension, Label: "Loan extension", ActionLabel: "Extension", Category: CategoryGoldLoan,
		FinalAction: "extends",
		OffBehavior: "The extension is applied as soon as the request is raised.",
		Stages: []StageDef{
			legacy("LoanOfficer", "PendingLoanOfficer", "Loan Officer", "Loan Operator", "can verify the loan extension", "Loan Extension Approval", true),
			legacy("BranchManager", pendingBranchManager, "Branch Manager", "Branch Manager", "can approve extension branch manager stage", "Loan Extension Approval", true),
			legacy("Management", pendingManagement, "Management", "Management", "can approve extension management stage", "Loan Extension Approval", true),
		},
	},
	{
		Key: FlowLoanRelease, Label: "Gold release", ActionLabel: "Release", Category: CategoryGoldLoan,
		FinalAction: "releases",
		OffBehavior: "The release completes as soon as the checklist is done and the payment is recorded.",
		Stages: []StageDef{
			legacy("Manager", "PendingManager", "Manager", "Branch Manager", "can approve release manager stage", "Release Approval", true),
			legacy("Management", pendingManagement, "Management", "Management", "can approve release management stage", "Release Approval", true),
		},
	},
	{
		Key: FlowLoanTopUp, Label: "Loan top-up", ActionLabel: "Top-up", Category: CategoryGoldLoan,
		FinalAction: "disburses",
		OffBehavior: "Top-ups are paid out immediately.",
		Stages: []StageDef{
			legacy("BranchManager", pendingBranchManager, "Branch Manager", "Branch Manager", "can approve top-up branch manager stage", "Top-Up Approval", false),
			legacy("Management", pendingManagement, "Management", "Management", "can approve top-up management stage", "Top-Up Approval", false),
		},
	},
	{
		Key: FlowPersonalLoan, Label: "Personal loan", ActionLabel: "Sanction", Category: CategoryPersonalLoan,
		FinalAction: "disburses",
		OffBehavior: "Personal loans are created active and disbursed immediately.",
		Stages: []StageDef{
			legacy("BranchManager", pendingBranchManager, "Branch Manager", "Branch Manager", "can approve personal loan branch manager stage", "Personal Loan Approval", false),
			legacy("Management", pendingManagement, "Management", "Management", "can approve personal loan management stage", "Personal Loan Approval", false),
		},
	},
	{
		Key: FlowAuctionPartialRepayment, Label: "Auction — partial repayment decision", ActionLabel: "Partial repayment", Category: CategoryAuction,
		FinalAction: "decides", MaxSteps: 1,
		OffBehavior: "The loan automatically stays in auction (Keep in Auction); no decision request is raised.",
		Stages: []StageDef{
			legacy("Decision", "Pending", "Decision", "Branch Manager", "can decide auction partial repayment", "Auction Workflow", true),
		},
	},
	{
		Key: FlowAuctionShortfall, Label: "Auction — shortfall decision", ActionLabel: "Shortfall", Category: CategoryAuction,
		FinalAction: "decides", MaxSteps: 1,
		OffBehavior: "The balance is automatically pursued (loan moves to Overdue); a write-off is not possible.",
		Stages: []StageDef{
			legacy("Decision", "Pending", "Decision", "Management", "can decide auction shortfall", "Auction Workflow", true),
		},
	},
	{
		Key: FlowExpense, Label: "Expense", ActionLabel: "Approval", Category: CategoryExpense,
		FinalAction: "posts",
		OffBehavior: "Expenses are recorded and posted to the ledger immediately.",
		Stages: []StageDef{
			legacy("Approver", "Pending", "Approver", "Branch Manager", "can approve expense", "Expense Approval", false),
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
