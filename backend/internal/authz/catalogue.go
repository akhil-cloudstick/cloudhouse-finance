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
//
// Every module's view permission is named "can view <noun> module" and is the
// PARENT of that module's other permissions (see dependencies.go): while a
// role lacks it, the module's create/update/delete grants cannot be switched
// on. Permissions nothing enforced were dropped (see RemovedPermissions).
var Catalogue = []PermissionDef{
	{"can view branch module", "View branches", "Branch Management"},
	{"can create branch", "Create branches", "Branch Management"},
	{"can update branch", "Update branches", "Branch Management"},
	{"can delete branch", "Delete branches", "Branch Management"},
	{"can view branch ledger", "View and download a branch's ledger", "Branch Management"},

	{"can view scheme module", "View loan schemes", "Scheme Management"},
	{"can create scheme", "Create loan schemes", "Scheme Management"},
	{"can update scheme", "Update loan schemes", "Scheme Management"},
	{"can delete scheme", "Delete loan schemes", "Scheme Management"},

	{"can view gold rate module", "View gold rate history", "Gold Rate Management"},
	{"can create gold rate", "Record a new gold rate", "Gold Rate Management"},

	{"can view purity standard module", "View gold purity standards", "Purity Standard Management"},
	{"can create purity standard", "Create purity standards", "Purity Standard Management"},

	{"can view employee module", "View employees", "Employee Management"},
	{"can create employee", "Create employees", "Employee Management"},
	{"can update employee", "Update employees", "Employee Management"},
	{"can delete employee", "Delete employees", "Employee Management"},

	{"can view cash module", "View cash movements, expenses and opening balance", "Cash Management"},
	{"can create cash", "Record cash movements and expenses", "Cash Management"},
	{"can update cash", "Update cash movements and approve or reject expenses", "Cash Management"},

	// Every ledger / statement download (cash, party, mode, loan and
	// investment statements). Each download also needs its own module's view
	// permission — this only decides whether the file may leave the screen.
	{"can export ledger", "Download ledgers and statements as PDF or Excel", "Ledger Export"},

	{"can view setting module", "View integration API key settings", "Settings Management"},
	{"can update setting", "Update integration API key settings", "Settings Management"},
	{"can delete setting", "Delete integration API key settings", "Settings Management"},

	{"can view customer module", "View customers and KYC", "Customer Management"},
	{"can create customer", "Create customers", "Customer Management"},
	{"can update customer", "Update customers", "Customer Management"},
	// Hard-deleting a customer permanently removes them and every one of their
	// loans (plus every record tied to each of those loans), their login/device
	// credentials and their notifications, with no soft-delete/undo. It is the
	// only customer delete there is.
	{"can hard delete customer", "Permanently and irreversibly delete a customer and every record tied to them", "Customer Management"},

	{"can view loan module", "View loans, ornaments, approvals, payments, requests and auctions", "Loan Management"},
	{"can create loan", "Create loans, ornaments, drafts, requests and payments", "Loan Management"},
	{"can update loan", "Update and act on loans, ornaments, approvals, payments, requests and auctions", "Loan Management"},
	{"can delete loan", "Delete loan drafts", "Loan Management"},
	// Disbursing more against a loan's pledged gold — its own grant rather
	// than riding on "can update loan", and independent of it: only "can view
	// loan module" is its parent (see dependencies.go).
	// Who may APPROVE a top-up is the Top-Up Approval stage, not this.
	{"can top up loan", "Top up a loan — disburse more against its pledged gold", "Loan Management"},
	// Deliberately separate from "can delete loan" above — hard-deleting a
	// loan permanently removes it and every record tied to it (ornaments,
	// payments, approvals, requests, auctions, bank pledges, packets,
	// reminders) from every table, with no soft-delete/undo. Locking this
	// down independently of ordinary delete rights is the whole point.
	{"can hard delete loan", "Permanently and irreversibly delete a loan and every record tied to it", "Loan Management"},

	{"can view personal loan module", "View personal loans, schedules and payments", "Personal Loan Management"},
	{"can create personal loan", "Create personal loans", "Personal Loan Management"},
	{"can update personal loan", "Record payments, renew and manage personal loans", "Personal Loan Management"},

	{"can view investment module", "View investment plans, investments, schedules and payouts", "Investment Management"},
	{"can create investment", "Create investment plans and investments", "Investment Management"},
	{"can update investment", "Update investment plans, mark payouts paid and apply maturity decisions", "Investment Management"},

	{"can view bank pledge module", "View bank pledge records", "Bank Pledge Management"},
	{"can create bank pledge", "Re-pledge a loan's gold to a bank", "Bank Pledge Management"},
	{"can update bank pledge", "Release and void bank pledges", "Bank Pledge Management"},

	{"can create upload", "Upload files (KYC documents, ornament photos, receipts)", "Upload Management"},

	{"can view ornament type module", "View ornament types", "Ornament Type Management"},
	{"can create ornament type", "Create ornament types", "Ornament Type Management"},

	{"can view bank module", "View banks (gold re-pledging counterparties)", "Bank Management"},
	{"can create bank", "Create banks", "Bank Management"},
	{"can update bank", "Update banks", "Bank Management"},
	{"can delete bank", "Delete banks", "Bank Management"},

	{"can view locker module", "View lockers", "Locker Management"},
	{"can create locker", "Create lockers", "Locker Management"},
	{"can update locker", "Update lockers", "Locker Management"},
	{"can delete locker", "Delete lockers", "Locker Management"},

	{"can view packet module", "View gold packets", "Packet Management"},
	{"can update packet", "Move gold packets", "Packet Management"},

	{"can view reminder module", "View reminders", "Reminder Management"},
	{"can create reminder", "Create reminders", "Reminder Management"},
	{"can update reminder", "Update reminders", "Reminder Management"},
	{"can delete reminder", "Delete reminders", "Reminder Management"},

	{"can view report module", "View and export management reports", "Report Management"},

	// Multi-tenancy plan, Step 11 — this business's own record of its
	// staff's privileged actions (internal/auditlog), distinct from the
	// superadmin console's cross-business one.
	{"can view audit log module", "View the record of employee and branch changes", "Audit Log"},

	// Multi-tenancy plan, Step 10 — subscribing/renewing this business's own
	// plan via Razorpay. Administrator-only (see Restrictions below): the
	// payment method and subscription are the business's money, not
	// something every role should be able to touch.
	{"can manage billing", "Subscribe to or renew this business's plan, and view billing status", "Billing"},

	{"can view role and permission module", "View roles and their permission grants", "Role Management"},
	{"can create role", "Create new roles", "Role Management"},
	{"can update role", "Rename roles, edit their grants and the approval workflow", "Role Management"},
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
	// literally match one of the 9 seeded role names.
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

	// Seeing auctions at all — the Auctions page, the auction section of a
	// loan and a customer's auction history. Parent of every other Auction
	// Workflow permission (dependencies.go).
	{"can view auction module", "View auction cases, notices, sales and auction history", "Auction Workflow"},
	{"can decide auction partial repayment", "Decide whether a loan stays in or is removed from auction after a partial repayment", "Auction Workflow"},
	{"can decide auction shortfall", "Decide whether an auction shortfall is pursued or written off", "Auction Workflow"},
	{"can mark loan auction eligible", "Mark a defaulted loan eligible for auction", "Auction Workflow"},
	{"can issue auction notice", "Issue an auction notice to the customer", "Auction Workflow"},
	{"can schedule auction", "Schedule an auction date for a loan", "Auction Workflow"},
	{"can record auction sale", "Record the sale amount and expenses of a conducted auction", "Auction Workflow"},
	{"can settle auction", "Settle an auction's surplus disposition", "Auction Workflow"},

	// Stage permissions for the approval flows an admin can switch on per
	// tenant (see internal/workflow.Catalogue) — they only matter while the
	// matching stage is enabled on the Approval Workflow screen.
	{"can approve expense", "Approve or reject a recorded expense before it is posted", "Expense Approval"},

	{"can approve top-up branch manager stage", "Approve a loan top-up at the Branch Manager stage", "Top-Up Approval"},
	{"can approve top-up management stage", "Approve a loan top-up at the Management stage", "Top-Up Approval"},

	{"can approve personal loan branch manager stage", "Approve a personal loan at the Branch Manager stage", "Personal Loan Approval"},
	{"can approve personal loan management stage", "Approve a personal loan at the Management stage", "Personal Loan Approval"},
}

// ApprovalModuleNames are the four approval-stage modules split out of what
// was originally one lumped "Approval Workflow" module in the same change
// that introduced them — see internal/migrate's call to
// authz.Repository.RegroupModules, which forces an already-seeded install's
// permissions rows back onto these exact groupings (SeedCatalogue's normal
// "never touch an existing row" rule would otherwise leave them stuck under
// the old single-module grouping forever, since the permission NAMES
// themselves didn't change — only which module they're filed under).
var ApprovalModuleNames = []string{
	"Loan Sanction", "Loan Extension Approval", "Release Approval", "Auction Workflow",
	"Expense Approval", "Top-Up Approval", "Personal Loan Approval",
}

// StaffRoles is the canonical role list, seeded into the roles table by
// internal/migrate. Employees may also hold custom roles created on the
// Roles & Permissions screen.
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
	{"can view report module", []string{"Administrator", "Management", "Branch Manager", "Auditor"}},

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
	{"can view audit log module", []string{"Administrator", "Management", "Auditor"}},
	{"can manage billing", []string{"Administrator"}},

	// Configurable approval flows (internal/workflow) — each stage defaults
	// to the role its label names, like the sanction/extension chains above.
	{"can approve expense", []string{"Administrator", "Branch Manager", "Management"}},
	{"can approve top-up branch manager stage", []string{"Administrator", "Branch Manager"}},
	{"can approve top-up management stage", []string{"Administrator", "Management"}},
	{"can approve personal loan branch manager stage", []string{"Administrator", "Branch Manager"}},
	{"can approve personal loan management stage", []string{"Administrator", "Management"}},
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

// PermissionRenames maps a permission's old name to its current one. Applied
// in place (the row keeps its id, so every role's grant survives) by
// Repository.RenamePermissions, which internal/migrate runs BEFORE
// SeedCatalogue — otherwise the seed would insert the new name as a fresh,
// default-granted row next to the old one. Old names are never reused.
var PermissionRenames = map[string]string{
	"can view branch":              "can view branch module",
	"can view scheme":              "can view scheme module",
	"can view gold rate":           "can view gold rate module",
	"can view purity standard":     "can view purity standard module",
	"can view employee":            "can view employee module",
	"can view cash":                "can view cash module",
	"can view setting":             "can view setting module",
	"can view customer":            "can view customer module",
	"can view loan":                "can view loan module",
	"can view personal loan":       "can view personal loan module",
	"can view investment":          "can view investment module",
	"can view bank pledge":         "can view bank pledge module",
	"can view ornament type":       "can view ornament type module",
	"can view bank":                "can view bank module",
	"can view locker":              "can view locker module",
	"can view packet":              "can view packet module",
	"can view reminder":            "can view reminder module",
	"can view report":              "can view report module",
	"can view audit log":           "can view audit log module",
	"can view role and permission": "can view role and permission module",
}

// RemovedPermissions were in the catalogue but nothing checked them — no
// route, no service call — so ticking them on the Roles screen did nothing.
// Repository.PurgePermissions deletes them and their grants on boot.
// "can delete customer" did have a route (a soft delete), but no screen used
// it; the route went with it and "can hard delete customer" is the only
// customer delete.
var RemovedPermissions = []string{
	"can update gold rate", "can delete gold rate",
	"can update purity standard", "can delete purity standard",
	"can update ornament type", "can delete ornament type",
	"can delete customer",
	"can delete cash",
	"can create setting",
	"can delete personal loan",
	"can delete investment",
	"can delete bank pledge",
	"can view upload", "can update upload", "can delete upload",
	"can create packet", "can delete packet",
	// The waiver/adjustment approval flow was retired; its two stage
	// permissions ("Waiver Approval") left the catalogue with it.
	"can approve waiver branch manager stage", "can approve waiver management stage",
}

// GrantCopy seeds a NEW permission's grants from an existing one, per role,
// so the boot that introduces it changes nobody's access: whoever could do
// the thing before (under the old permission) still can.
type GrantCopy struct {
	To   string
	From string
}

// NewPermissionGrantCopies — the first two were previously covered by the
// cash view permission (the branch ledger and every ledger download read
// cash data); auction viewing was covered by the loan view permission, and
// topping up by the loan update permission.
var NewPermissionGrantCopies = []GrantCopy{
	{To: "can view branch ledger", From: "can view cash module"},
	{To: "can export ledger", From: "can view cash module"},
	{To: "can view auction module", From: "can view loan module"},
	{To: "can top up loan", From: "can update loan"},
}

// ResyncedDescriptions are permissions whose description changed alongside
// the rename/removal above. SeedCatalogue never touches an existing row, so
// internal/migrate pushes these through RegroupModules once.
var ResyncedDescriptions = []string{
	"can update cash", "can delete loan", "can create bank pledge", "can update bank pledge",
	"can create upload", "can update packet", "can update role",
}
