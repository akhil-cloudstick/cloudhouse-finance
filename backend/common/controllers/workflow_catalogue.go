package controllers

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

const (
	CategoryGoldLoan = "gold_loan"
	CategoryAuction  = "auction"
)

var Categories = []CategoryDef{
	{CategoryGoldLoan, "Gold Loan", "Sanction, extension, release and top-up of gold loans."},
	{"personal_loan", "Personal Loan", "Sanction of personal loans."},
	{CategoryAuction, "Auction", "Decisions taken while a loan is in auction."},
	{"expense", "Expense", "Approval of recorded expenses before they post to the ledger."},
}

const (
	pendingManagement = "PendingManagement"
)

var WorkflowCatalogue = []FlowDef{
	{
		Key: FlowLoanSanction, Label: "Gold loan sanction", ActionLabel: "Sanction", Category: CategoryGoldLoan,
		FinalAction: "disburses",
		OffBehavior: "At least one approver is required — the last approver disburses the loan.",
		MinEnabled:  1,
		Stages: []StageDef{
			legacy("LoanOperator", "LoanOperator", "Loan Operator", "Loan Operator", "Loan Sanction", true),
			legacy("BranchManager", "BranchManager", "Branch Manager", "Branch Manager", "Loan Sanction", true),
			legacy("FinalSanction", "FinalSanction", "Final Sanction", "Management", "Loan Sanction", true),
		},
	},
	{
		Key: FlowLoanExtension, Label: "Loan extension", ActionLabel: "Extension", Category: CategoryGoldLoan,
		FinalAction: "extends",
		OffBehavior: "The extension is applied as soon as the request is raised.",
		Stages: []StageDef{
			legacy("LoanOfficer", "PendingLoanOfficer", "Loan Officer", "Loan Operator", "Loan Extension Approval", true),
			legacy("BranchManager", "PendingBranchManager", "Branch Manager", "Branch Manager", "Loan Extension Approval", true),
			legacy("Management", pendingManagement, "Management", "Management", "Loan Extension Approval", true),
		},
	},
	{
		Key: FlowLoanRelease, Label: "Gold release", ActionLabel: "Release", Category: CategoryGoldLoan,
		FinalAction: "releases",
		OffBehavior: "The release completes as soon as the checklist is done and the payment is recorded.",
		Stages: []StageDef{
			legacy("Manager", "PendingManager", "Manager", "Branch Manager", "Release Approval", true),
			legacy("Management", pendingManagement, "Management", "Management", "Release Approval", true),
		},
	},
	{
		Key: FlowLoanTopUp, Label: "Loan top-up", ActionLabel: "Top-up", Category: CategoryGoldLoan,
		FinalAction: "disburses",
		OffBehavior: "Top-ups are paid out immediately.",
		Stages: []StageDef{
			legacy("BranchManager", "PendingBranchManager", "Branch Manager", "Branch Manager", "Top-Up Approval", false),
			legacy("Management", pendingManagement, "Management", "Management", "Top-Up Approval", false),
		},
	},
	{
		Key: FlowPersonalLoan, Label: "Personal loan", ActionLabel: "Sanction", Category: "personal_loan",
		FinalAction: "disburses",
		OffBehavior: "Personal loans are created active and disbursed immediately.",
		Stages: []StageDef{
			legacy("BranchManager", "PendingBranchManager", "Branch Manager", "Branch Manager", "Personal Loan Approval", false),
			legacy("Management", pendingManagement, "Management", "Management", "Personal Loan Approval", false),
		},
	},
	{
		Key: FlowAuctionPartialRepayment, Label: "Auction — partial repayment decision", ActionLabel: "Partial repayment", Category: CategoryAuction,
		FinalAction: "decides", MaxSteps: 1,
		OffBehavior: "The loan automatically stays in auction (Keep in Auction); no decision request is raised.",
		Stages: []StageDef{
			legacy("Decision", "Pending", "Decision", "Branch Manager", "Auction Workflow", true),
		},
	},
	{
		Key: FlowAuctionShortfall, Label: "Auction — shortfall decision", ActionLabel: "Shortfall", Category: CategoryAuction,
		FinalAction: "decides", MaxSteps: 1,
		OffBehavior: "The balance is automatically pursued (loan moves to Overdue); a write-off is not possible.",
		Stages: []StageDef{
			legacy("Decision", "Pending", "Decision", "Management", "Auction Workflow", true),
		},
	},
	{
		Key: FlowExpense, Label: "Expense", ActionLabel: "Approval", Category: "expense",
		FinalAction: "posts",
		OffBehavior: "Expenses are recorded and posted to the ledger immediately.",
		Stages: []StageDef{
			legacy("Approver", "Pending", "Approver", "Branch Manager", "Expense Approval", false),
		},
	},
}

type CategoryDef struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Description string `json:"description"`
}

type StageDef struct {
	Key            string `json:"key"`
	Pending        string `json:"pending"`
	Label          string `json:"label"`
	Role           string `json:"role"`
	Module         string `json:"module"`
	DefaultEnabled bool   `json:"default_enabled"`
	RoleID         uint   `json:"role_id"`
}

type FlowDef struct {
	Key         string     `json:"key"`
	Label       string     `json:"label"`
	ActionLabel string     `json:"action_label"`
	Category    string     `json:"category"`
	FinalAction string     `json:"final_action"`
	OffBehavior string     `json:"off_behavior"`
	MinEnabled  int        `json:"min_enabled"`
	MaxSteps    int        `json:"max_steps"`
	Stages      []StageDef `json:"stages"`
}

func FindCategory(key string) (CategoryDef, bool) {
	for _, c := range Categories {
		if c.Key == key {
			return c, true
		}
	}
	return CategoryDef{}, false
}

func FlowsOf(category string) []FlowDef {
	var out []FlowDef
	for _, f := range WorkflowCatalogue {
		if f.Category == category {
			out = append(out, f)
		}
	}
	return out
}

func legacy(key, pending, label, role, module string, on bool) StageDef {
	return StageDef{Key: key, Pending: pending, Label: label, Role: role, Module: module, DefaultEnabled: on}
}

func FindFlow(key string) (FlowDef, bool) {
	for _, f := range WorkflowCatalogue {
		if f.Key == key {
			return f, true
		}
	}
	return FlowDef{}, false
}
