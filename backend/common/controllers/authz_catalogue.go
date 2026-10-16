package controllers

import "cloudhouse/backend/auth"

var AuthzCatalogue = []PermissionDef{
	{"can view branch module", "View branches", "Branch Management"},
	{"can create branch", "Create branches", "Branch Management"},
	{"can update branch", "Update branches", "Branch Management"},
	{"can delete branch", "Delete branches", "Branch Management"},
	{"can view branch ledger", "View and download a branch's ledger", "Branch Management"},
	{auth.CrossBranchPermission, "See and switch between all branches", "Branch Management"},
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
	{"can export ledger", "Download ledgers and statements as PDF or Excel", "Ledger Export"},
	{"can view setting module", "View integration API key settings", "Settings Management"},
	{"can update setting", "Update integration API key settings", "Settings Management"},
	{"can delete setting", "Delete integration API key settings", "Settings Management"},
	{"can view customer module", "View customers and KYC", "Customer Management"},
	{"can create customer", "Create customers", "Customer Management"},
	{"can update customer", "Update customers", "Customer Management"},
	{"can hard delete customer", "Permanently and irreversibly delete a customer and every record tied to them", "Customer Management"},
	{"can view loan module", "View loans, ornaments, approvals, payments, requests and auctions", "Loan Management"},
	{"can create loan", "Create loans, ornaments, drafts, requests and payments", "Loan Management"},
	{"can update loan", "Update and act on loans, ornaments, approvals, payments, requests and auctions", "Loan Management"},
	{"can delete loan", "Delete loan drafts", "Loan Management"},
	{"can top up loan", "Top up a loan — disburse more against its pledged gold", "Loan Management"},
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
	{"can view audit log module", "View the record of employee and branch changes", "Audit Log"},
	{"can manage billing", "Subscribe to or renew this business's plan, and view billing status", "Billing"},
	{"can view business profile module", "View the business profile (registration no., phone, address, lender particulars)", "Business Profile"},
	{"can update business profile", "Edit the business profile printed on slips, statements and pledge agreements", "Business Profile"},
	{"can view role and permission module", "View roles and their permission grants", "Role Management"},
	{"can create role", "Create new roles", "Role Management"},
	{"can update role", "Rename roles, edit their grants and the approval workflow", "Role Management"},
	{"can delete role", "Delete roles", "Role Management"},
	{"can verify release checklist", "Verify a gold release request's checklist (payment, packet, bank pledge, customer confirmation) before it goes to the Manager/Management approval stages", "Release Approval"},
	{"can view auction module", "View auction cases, notices, sales and auction history", "Auction Workflow"},
	{"can mark loan auction eligible", "Mark a defaulted loan eligible for auction", "Auction Workflow"},
	{"can issue auction notice", "Issue an auction notice to the customer", "Auction Workflow"},
	{"can schedule auction", "Schedule an auction date for a loan", "Auction Workflow"},
	{"can record auction sale", "Record the sale amount and expenses of a conducted auction", "Auction Workflow"},
	{"can settle auction", "Settle an auction's surplus disposition", "Auction Workflow"},
}

var ApprovalModuleNames = []string{"Release Approval", "Auction Workflow"}

var StaffRoles = []string{
	"Administrator", "Management", "Branch Manager", "Loan Operator", "Cashier",
	"Accountant", "Collection Staff", "Auction Administrator", "Auditor",
}

var CrossBranchRestriction = RoleRestriction{auth.CrossBranchPermission, []string{"Administrator", "Management"}}

var Restrictions = []RoleRestriction{
	CrossBranchRestriction,
	{"can create branch", []string{"Administrator"}},
	{"can update branch", []string{"Administrator"}},
	{"can delete branch", []string{"Administrator"}},
	{"can view report module", []string{"Administrator", "Management", "Branch Manager", "Auditor"}},
	{"can verify release checklist", []string{"Administrator", "Loan Operator", "Branch Manager"}},
	{"can mark loan auction eligible", []string{"Administrator", "Auction Administrator", "Branch Manager", "Management"}},
	{"can issue auction notice", []string{"Administrator", "Auction Administrator", "Branch Manager", "Management"}},
	{"can schedule auction", []string{"Administrator", "Auction Administrator", "Branch Manager", "Management"}},
	{"can record auction sale", []string{"Administrator", "Auction Administrator", "Branch Manager", "Management"}},
	{"can settle auction", []string{"Administrator", "Auction Administrator", "Branch Manager", "Management"}},
	{"can view audit log module", []string{"Administrator", "Management", "Auditor"}},
	{"can manage billing", []string{"Administrator"}},
}

// Granted to every staff role of a newly created business, which otherwise
// starts its non-Administrator roles with nothing; the administrator revokes
// per role on the Roles screen.
var GrantAllOnCreate = []RoleRestriction{
	{"can view business profile module", StaffRoles},
	{"can update business profile", StaffRoles},
}

type PermissionDef struct {
	Name        string
	Description string
	ModuleName  string
}

type RoleRestriction struct {
	PermissionName string
	AllowedRoles   []string
}
