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

	{"can view role and permission", "View roles and their permission grants", "Role Management"},
	{"can create role", "Create new roles", "Role Management"},
	{"can update role", "Rename roles and edit their descriptions", "Role Management"},
	{"can delete role", "Delete roles", "Role Management"},
}

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
