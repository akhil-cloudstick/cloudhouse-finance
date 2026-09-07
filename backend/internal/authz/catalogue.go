package authz

// PermissionDef is one row of the permission catalogue seeded by
// internal/migrate. Kept here (not in internal/migrate) so this package's
// own admin routes/bootstrap derivation and internal/migrate's seeding both
// read the exact same list — there is no second copy anywhere to drift out
// of sync.
type PermissionDef struct {
	Name        string
	Description string
	ModuleName  string
}

// Catalogue is every permission in the system.
//
// Deliberate, explicit deviation from the house role-permission standard's
// §2.1 default (one view/change pair per module): every module except
// "reports" (read-only) is split into four granular permissions — view,
// create, update, delete — per an explicit request, rather than the
// standard's default view/change pair. The blanket "can change <noun>"
// permission no longer exists at all — it is gone from this catalogue and
// purged from the permissions/role_permissions tables on boot, after its
// grants have been copied forward onto the create/update/delete trio (see
// internal/migrate's seed step and Repository.PurgeLegacyChangePermissions).
// Role grant editing, previously its own "can change role permission",
// now rides on "can update role".
var Catalogue = []PermissionDef{
	{"can view branch", "View branches", "Branch Management"},
	{"can create branch", "Create branches", "Branch Management"},
	{"can update branch", "Update branches", "Branch Management"},
	{"can delete branch", "Delete branches", "Branch Management"},

	{"can view scheme", "View loan schemes", "Scheme Management"},
	{"can create scheme", "Create loan schemes", "Scheme Management"},
	{"can update scheme", "Update loan schemes", "Scheme Management"},
	{"can delete scheme", "Delete loan schemes", "Scheme Management"},

	{"can view gold rate", "View gold rate history", "Gold Rate Management"},
	{"can create gold rate", "Record a new gold rate", "Gold Rate Management"},
	{"can update gold rate", "Update a gold rate record", "Gold Rate Management"},
	{"can delete gold rate", "Delete a gold rate record", "Gold Rate Management"},

	{"can view purity standard", "View gold purity standards", "Purity Standard Management"},
	{"can create purity standard", "Create purity standards", "Purity Standard Management"},
	{"can update purity standard", "Update purity standards", "Purity Standard Management"},
	{"can delete purity standard", "Delete purity standards", "Purity Standard Management"},

	{"can view employee", "View employees", "Employee Management"},
	{"can create employee", "Create employees", "Employee Management"},
	{"can update employee", "Update employees", "Employee Management"},
	{"can delete employee", "Delete employees", "Employee Management"},

	{"can view cash", "View cash movements, expenses and opening balance", "Cash Management"},
	{"can create cash", "Record cash movements and expenses", "Cash Management"},
	{"can update cash", "Update cash movements and expenses", "Cash Management"},
	{"can delete cash", "Delete cash movements and expenses", "Cash Management"},

	{"can view setting", "View integration API key settings", "Settings Management"},
	{"can create setting", "Create integration API key settings", "Settings Management"},
	{"can update setting", "Update integration API key settings", "Settings Management"},
	{"can delete setting", "Delete integration API key settings", "Settings Management"},

	{"can view customer", "View customers and KYC", "Customer Management"},
	{"can create customer", "Create customers", "Customer Management"},
	{"can update customer", "Update customers", "Customer Management"},
	{"can delete customer", "Delete customers", "Customer Management"},

	{"can view loan", "View loans, ornaments, approvals, payments, requests and auctions", "Loan Management"},
	{"can create loan", "Create loans, ornaments, drafts, requests and payments", "Loan Management"},
	{"can update loan", "Update and act on loans, ornaments, approvals, payments, requests and auctions", "Loan Management"},
	{"can delete loan", "Delete loans, ornaments, drafts, requests and payments", "Loan Management"},

	{"can view personal loan", "View personal loans, schedules and payments", "Personal Loan Management"},
	{"can create personal loan", "Create personal loans", "Personal Loan Management"},
	{"can update personal loan", "Record payments, renew and manage personal loans", "Personal Loan Management"},
	{"can delete personal loan", "Delete personal loans", "Personal Loan Management"},

	{"can view investment", "View investment plans, investments, schedules and payouts", "Investment Management"},
	{"can create investment", "Create investment plans and investments", "Investment Management"},
	{"can update investment", "Update investment plans, mark payouts paid and apply maturity decisions", "Investment Management"},
	{"can delete investment", "Delete investments", "Investment Management"},

	{"can view bank pledge", "View bank pledge records", "Bank Pledge Management"},
	{"can create bank pledge", "Create bank pledges", "Bank Pledge Management"},
	{"can update bank pledge", "Update, release and void bank pledges", "Bank Pledge Management"},
	{"can delete bank pledge", "Delete bank pledges", "Bank Pledge Management"},

	{"can view upload", "View uploaded files", "Upload Management"},
	{"can create upload", "Upload files", "Upload Management"},
	{"can update upload", "Update uploaded files", "Upload Management"},
	{"can delete upload", "Delete uploaded files", "Upload Management"},

	{"can view ornament type", "View ornament types", "Ornament Type Management"},
	{"can create ornament type", "Create ornament types", "Ornament Type Management"},
	{"can update ornament type", "Update ornament types", "Ornament Type Management"},
	{"can delete ornament type", "Delete ornament types", "Ornament Type Management"},

	{"can view bank", "View banks (gold re-pledging counterparties)", "Bank Management"},
	{"can create bank", "Create banks", "Bank Management"},
	{"can update bank", "Update banks", "Bank Management"},
	{"can delete bank", "Delete banks", "Bank Management"},

	{"can view locker", "View lockers", "Locker Management"},
	{"can create locker", "Create lockers", "Locker Management"},
	{"can update locker", "Update lockers", "Locker Management"},
	{"can delete locker", "Delete lockers", "Locker Management"},

	{"can view packet", "View gold packets", "Packet Management"},
	{"can create packet", "Create gold packets", "Packet Management"},
	{"can update packet", "Update gold packets", "Packet Management"},
	{"can delete packet", "Delete gold packets", "Packet Management"},

	{"can view reminder", "View reminders", "Reminder Management"},
	{"can create reminder", "Create reminders", "Reminder Management"},
	{"can update reminder", "Update reminders", "Reminder Management"},
	{"can delete reminder", "Delete reminders", "Reminder Management"},

	{"can view report", "View and export management reports", "Report Management"},

	// Multi-tenancy plan, Step 11 — this business's own record of its
	// staff's privileged actions (internal/auditlog), distinct from the
	// superadmin console's cross-business one.
	{"can view audit log", "View the record of employee and branch changes", "Audit Log"},

	// Multi-tenancy plan, Step 10 — subscribing/renewing this business's own
	// plan via Razorpay. Administrator-only (see Restrictions below): the
	// payment method and subscription are the business's money, not
	// something every role should be able to touch.
	{"can manage billing", "Subscribe to or renew this business's plan, and view billing status", "Billing"},

	{"can view role and permission", "View roles and their permission grants", "Role Management"},
	{"can create role", "Create new roles", "Role Management"},
	{"can update role", "Rename roles and edit their descriptions", "Role Management"},
	{"can delete role", "Delete roles", "Role Management"},

	// Approval-stage permissions: a deliberate exception to this catalogue's
	// usual view/create/update/delete-per-module shape (see the doc comment
	// above) — these gate individual STAGES of the loan sanction, loan
	// extension, and release request approval chains, plus individual
	// STEPS of the auction pipeline, none of which are CRUD operations on
	// a single noun. Previously each stage/step was gated by comparing the
	// acting employee's raw Role string against a hardcoded literal in
	// internal/loan/service.go (sanctionChain, extensionChain,
	// shortfallAuthorityRoles, partialRepaymentAuthorityRoles) or, for the
	// release chain and the five auction process steps below, not gated by
	// role at all — just the blanket "can update loan". Moving these into
	// the catalogue lets an admin grant "who may approve at this stage" to
	// any role, not just an employee whose Role string happens to
	// literally match one of the 9 fixed ValidRoles names.
	//
	// Split into four separate modules (one per approval chain/workflow)
	// rather than one combined "Approval Workflow" bucket, so each shows as
	// its own section on the Roles & Permissions screen.
	{"can verify loan", "Verify a loan at the Loan Operator sanction stage", "Loan Sanction"},
	{"can approve branch manager stage", "Approve a loan at the Branch Manager sanction stage", "Loan Sanction"},
	{"can sanction loan", "Give final sanction to a loan (Management stage)", "Loan Sanction"},

	{"can verify the loan extension", "Verify a loan extension request at the Loan Officer stage", "Loan Extension Approval"},
	{"can approve extension branch manager stage", "Approve a loan extension request at the Branch Manager stage", "Loan Extension Approval"},
	{"can approve extension management stage", "Approve a loan extension request at the Management stage", "Loan Extension Approval"},

	{"can verify release checklist", "Verify a gold release request's checklist (payment, packet, bank pledge, customer confirmation) before it goes to the Manager/Management approval stages", "Release Approval"},
	{"can approve release manager stage", "Approve a gold release request at the Manager stage", "Release Approval"},
	{"can approve release management stage", "Approve a gold release request at the Management stage", "Release Approval"},

	{"can decide auction partial repayment", "Decide whether a loan stays in or is removed from auction after a partial repayment", "Auction Workflow"},
	{"can decide auction shortfall", "Decide whether an auction shortfall is pursued or written off", "Auction Workflow"},
	{"can mark loan auction eligible", "Mark a defaulted loan eligible for auction", "Auction Workflow"},
	{"can issue auction notice", "Issue an auction notice to the customer", "Auction Workflow"},
	{"can schedule auction", "Schedule an auction date for a loan", "Auction Workflow"},
	{"can record auction sale", "Record the sale amount and expenses of a conducted auction", "Auction Workflow"},
	{"can settle auction", "Settle an auction's surplus disposition", "Auction Workflow"},
}

// ApprovalModuleNames are the four approval-stage modules split out of what
// was originally one lumped "Approval Workflow" module in the same change
// that introduced them — see internal/migrate's call to
// authz.Repository.RegroupModules, which forces an already-seeded install's
// permissions rows back onto these exact groupings (SeedCatalogue's normal
// "never touch an existing row" rule would otherwise leave them stuck under
// the old single-module grouping forever, since the permission NAMES
// themselves didn't change — only which module they're filed under).
var ApprovalModuleNames = []string{"Loan Sanction", "Loan Extension Approval", "Release Approval", "Auction Workflow"}

// StaffRoles is the canonical role list, seeded into the roles table by
// internal/migrate. Kept IDENTICAL to employee.ValidRoles — see that var's
// doc comment for the full list of places this must stay mirrored.
var StaffRoles = []string{
	"Administrator", "Management", "Branch Manager", "Loan Operator", "Cashier",
	"Accountant", "Collection Staff", "Auction Administrator", "Auditor",
}

// SystemRoleName is the one role seeded with IsSystem=true — see Role's doc
// comment for what that protects.
const SystemRoleName = "Administrator"

// RoleRestriction narrows one permission to a subset of roles, applied after
// the default allow-all back-fill so a from-scratch cutover reproduces
// today's actual access exactly (see internal/migrate).
type RoleRestriction struct {
	PermissionName string
	AllowedRoles   []string
}

// Restrictions mirrors the hardcoded overrides internal/migrate used to
// apply directly against the old (role, resource, action) table.
var Restrictions = []RoleRestriction{
	// Was one {"can change branch"} row before the change permission was
	// dropped — the same Administrator-only rule, now spelled out per verb.
	{"can create branch", []string{"Administrator"}},
	{"can update branch", []string{"Administrator"}},
	{"can delete branch", []string{"Administrator"}},
	{"can view report", []string{"Administrator", "Management", "Branch Manager", "Auditor"}},

	// Approval-stage defaults (Loan Sanction / Loan Extension Approval /
	// Release Approval / Auction Workflow modules) — without these,
	// BackfillGrants' allow-all default would let every role approve every
	// stage, defeating the separation-of-duties these chains exist for.
	// Each reproduces exactly the access the hardcoded check it replaces
	// already granted (see the catalogue entries' own doc comment) — an
	// admin can then rebalance who approves what per-role from here,
	// without a code change.
	{"can verify loan", []string{"Administrator", "Loan Operator"}},
	{"can approve branch manager stage", []string{"Administrator", "Branch Manager"}},
	{"can sanction loan", []string{"Administrator", "Management"}},

	{"can verify the loan extension", []string{"Administrator", "Loan Operator"}},
	{"can approve extension branch manager stage", []string{"Administrator", "Branch Manager"}},
	{"can approve extension management stage", []string{"Administrator", "Management"}},

	// The release chain has no prior hardcoded check to mirror — these are
	// new gates. The checklist step happens before either approval stage
	// (see VerifyReleaseChecklist, which sets ApprovalStage to
	// PendingManager on completion) and is branch-level prep work, so it's
	// defaulted a bit wider than the two approval stages themselves, which
	// mirror the sanction/extension chains' own Manager/Management stages.
	{"can verify release checklist", []string{"Administrator", "Loan Operator", "Branch Manager"}},
	{"can approve release manager stage", []string{"Administrator", "Branch Manager"}},
	{"can approve release management stage", []string{"Administrator", "Management"}},

	{"can decide auction partial repayment", []string{"Administrator", "Auction Administrator", "Branch Manager", "Management"}},
	{"can decide auction shortfall", []string{"Administrator", "Branch Manager", "Management"}},

	// The five auction process steps also have no prior hardcoded check —
	// previously gated only by the blanket "can update loan". Defaulted to
	// the same auction-authority roles as the two decisions above.
	{"can mark loan auction eligible", []string{"Administrator", "Auction Administrator", "Branch Manager", "Management"}},
	{"can issue auction notice", []string{"Administrator", "Auction Administrator", "Branch Manager", "Management"}},
	{"can schedule auction", []string{"Administrator", "Auction Administrator", "Branch Manager", "Management"}},
	{"can record auction sale", []string{"Administrator", "Auction Administrator", "Branch Manager", "Management"}},
	{"can settle auction", []string{"Administrator", "Auction Administrator", "Branch Manager", "Management"}},
	{"can view audit log", []string{"Administrator", "Management", "Auditor"}},
	{"can manage billing", []string{"Administrator"}},

	// Approval-stage defaults (Loan Sanction / Loan Extension Approval /
	// Release Approval / Auction Workflow modules) — without these,
	// BackfillGrants' allow-all default would let every role approve every
	// stage, defeating the separation-of-duties these chains exist for.
	// Each reproduces exactly the access the hardcoded check it replaces
	// already granted (see the catalogue entries' own doc comment) — an
	// admin can then rebalance who approves what per-role from here,
	// without a code change.
	{"can verify loan", []string{"Administrator", "Loan Operator"}},
	{"can approve branch manager stage", []string{"Administrator", "Branch Manager"}},
	{"can sanction loan", []string{"Administrator", "Management"}},

	{"can verify the loan extension", []string{"Administrator", "Loan Operator"}},
	{"can approve extension branch manager stage", []string{"Administrator", "Branch Manager"}},
	{"can approve extension management stage", []string{"Administrator", "Management"}},

	// The release chain has no prior hardcoded check to mirror — these are
	// new gates. The checklist step happens before either approval stage
	// (see VerifyReleaseChecklist, which sets ApprovalStage to
	// PendingManager on completion) and is branch-level prep work, so it's
	// defaulted a bit wider than the two approval stages themselves, which
	// mirror the sanction/extension chains' own Manager/Management stages.
	{"can verify release checklist", []string{"Administrator", "Loan Operator", "Branch Manager"}},
	{"can approve release manager stage", []string{"Administrator", "Branch Manager"}},
	{"can approve release management stage", []string{"Administrator", "Management"}},

	{"can decide auction partial repayment", []string{"Administrator", "Auction Administrator", "Branch Manager", "Management"}},
	{"can decide auction shortfall", []string{"Administrator", "Branch Manager", "Management"}},

	// The five auction process steps also have no prior hardcoded check —
	// previously gated only by the blanket "can update loan". Defaulted to
	// the same auction-authority roles as the two decisions above.
	{"can mark loan auction eligible", []string{"Administrator", "Auction Administrator", "Branch Manager", "Management"}},
	{"can issue auction notice", []string{"Administrator", "Auction Administrator", "Branch Manager", "Management"}},
	{"can schedule auction", []string{"Administrator", "Auction Administrator", "Branch Manager", "Management"}},
	{"can record auction sale", []string{"Administrator", "Auction Administrator", "Branch Manager", "Management"}},
	{"can settle auction", []string{"Administrator", "Auction Administrator", "Branch Manager", "Management"}},
}

// CRUDSplitNouns lists every noun whose "can change <noun>" permission was
// split into "can create/update/delete <noun>" (see Catalogue's doc
// comment) — every module except "report" (read-only, no change permission
// to split). internal/migrate uses this to back-fill each new permission's
// role_permissions rows from the existing "can change <noun>" grant per
// role (see authz.Repository.BackfillCRUDSplitGrants). Still needed now
// that "can change <noun>" is out of the catalogue: an existing database
// keeps those rows until PurgeLegacyChangePermissions deletes them, and the
// copy-forward has to run first.
var CRUDSplitNouns = []string{
	"branch", "scheme", "gold rate", "purity standard", "employee", "cash",
	"setting", "customer", "loan", "bank pledge", "upload", "ornament type",
	"bank", "locker", "packet", "reminder",
}
