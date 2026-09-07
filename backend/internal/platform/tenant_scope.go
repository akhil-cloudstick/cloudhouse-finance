package platform

// TenantScoped is embedded in every model that holds one business's data.
// It is the marker for "this row belongs to exactly one tenant", and it is
// what the automatic query filter (plan Step 2) keys on.
//
// Embedded ANONYMOUSLY, so both GORM and encoding/json inline the field: the
// column is `tenant_id` and the JSON key is `tenantId`, exactly as if it were
// declared on each struct. Declaring it once means a new model cannot be
// added without a deliberate decision about which side of the boundary it
// falls on — `grep -L TenantScoped` over the model files is the audit.
//
// # Why every table, not just the branch-owning ones
//
// It is tempting to give tenant_id only to branches/customers/loans and let
// ornaments, payments, packets and the rest inherit it through their parent.
// That is wrong, and the reason is sharp: the automatic filter can only add a
// condition to a table it can SEE in the query. A direct lookup —
// "fetch payment 4471" — has no loan in it to reach through, so the row comes
// back regardless of who owns it. Inheritance silently reintroduces exactly
// the human error the filter exists to remove.
//
// # Why it is not `not null` here
//
// AutoMigrate would try to add a NOT NULL column to tables that already have
// rows, which fails. The constraint is applied by internal/migrate AFTER the
// backfill, following the add-nullable → backfill → constrain order that
// scheme.BackfillBranchID already established in this codebase.
//
// Deliberately NOT tenant-scoped, and the only two exceptions:
//   - authz.Permission — the permission catalogue, seeded from hardcoded Go
//     (authz.Catalogue) and identical for everyone. Only the GRANTS
//     (RolePermission) and the role rows are per-business.
//   - settings.ApiKeySetting — KYC/PAN/WhatsApp/SMS credentials, shared by
//     explicit instruction from the product owner. Per-business usage caps
//     and suspension cut-off contain the blast radius; see
//     documents/multitenancy_step0.md.
type TenantScoped struct {
	TenantID uint `json:"tenantId" gorm:"index"`
}
