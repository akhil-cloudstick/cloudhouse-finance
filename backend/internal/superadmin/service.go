package superadmin

import (
	"context"
	"fmt"
	"regexp"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"

	"ambikagold/backend/internal/authz"
	"ambikagold/backend/internal/branch"
	"ambikagold/backend/internal/employee"
	"ambikagold/backend/internal/platform"
	"ambikagold/backend/internal/platform/httpx"
	"ambikagold/backend/internal/tenant"
)

var (
	ErrInvalidCredentials = httpx.NewUnauthorized("invalid username or password")

	ErrNameRequired      = httpx.NewBadRequest("business name is required")
	ErrCodeRequired      = httpx.NewBadRequest("business code is required")
	ErrInvalidCode       = httpx.NewBadRequest("business code must be lowercase letters, numbers and dashes only")
	ErrDuplicateCode     = httpx.NewConflict("a business with this code already exists")
	ErrTierNotFound      = httpx.NewBadRequest("tier not found")
	ErrAdminUsernameReq  = httpx.NewBadRequest("an initial administrator username is required")
	ErrAdminPasswordWeak = httpx.NewBadRequest("the initial administrator password must be at least 8 characters")
	ErrReasonRequired    = httpx.NewBadRequest("a reason is required for this action")
	ErrBusinessNotFound  = httpx.NewNotFound("business not found")
)

// businessCodePattern mirrors the frontend's slug rule
// (frontend/common/services/tenantSession.ts's SLUG_PATTERN) — lowercase
// alphanumerics and dashes, so a code accepted here is guaranteed to work as
// a /login/<code> link with no separate translation step.
var businessCodePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]*$`)

// Service implements the superadmin console's business rules.
//
// It holds a direct handle on the shared database (db) as well as the
// narrower repositories, because CreateBusiness is the one operation in this
// codebase that legitimately writes across four domains — tenant, authz,
// branch, employee — in a single business's creation, and that has to be one
// transaction: a partially created business (a tenant row with no
// Administrator able to log into it) is worse than no business at all. See
// CreateBusiness's doc comment for why it builds its OWN repositories bound
// to the transaction handle rather than using the ones held here.
type Service struct {
	db   *gorm.DB
	repo *Repository

	tenantRepo *tenant.Repository

	jwtSecret string
	jwtExpiry time.Duration
}

func NewService(db *gorm.DB, repo *Repository, tenantRepo *tenant.Repository, jwtSecret string, jwtExpiry time.Duration) *Service {
	return &Service{db: db, repo: repo, tenantRepo: tenantRepo, jwtSecret: jwtSecret, jwtExpiry: jwtExpiry}
}

// --- Authentication ---------------------------------------------------------

// Login mirrors auth.Service.Login's shape, but there is no business code to
// resolve first — a superadmin user belongs to no tenant, which is the entire
// point of the role.
func (s *Service) Login(ctx context.Context, username, password string) (string, *SuperAdminUser, error) {
	u, err := s.repo.FindSuperAdminUserByUsername(ctx, username)
	if err != nil {
		// Same response whether the username doesn't exist or the password
		// is wrong — a login form must not confirm which usernames exist.
		return "", nil, ErrInvalidCredentials
	}
	if !u.IsActive {
		return "", nil, ErrInvalidCredentials
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(password)); err != nil {
		return "", nil, ErrInvalidCredentials
	}
	token, err := platform.IssueSuperAdminToken(u.ID, u.Name, s.jwtSecret, s.jwtExpiry)
	if err != nil {
		return "", nil, err
	}
	return token, u, nil
}

// --- Businesses --------------------------------------------------------------

type CreateBusinessInput struct {
	Name   string
	Code   string
	TierID uint

	// The initial Administrator login the business's own owner will use —
	// see the plan's Step 7: this is the automated replacement for the
	// hand-written INSERT recipe the handoff previously documented.
	AdminUsername string
	AdminPassword string
	AdminName     string
	AdminPhone    string
}

// CreateBusiness is the single transaction that replaces the five
// hand-written SQL statements the handoff previously walked through by
// hand: a tenant, its role catalogue, a full grant for its Administrator, a
// first branch, and the employee who can actually sign in to it.
//
// Every write after the tenant row is created runs through repositories
// built FRESH against tx (not the ones held on Service, which are bound to
// the top-level db) and under a context carrying
// platform.WithTenant(ctx, newTenant.ID) — NOT AllowCrossTenant — so the
// ordinary tenant-scope filter stamps tenant_id on every insert exactly as
// it would for a real authenticated session of that business. Both choices
// matter for the same reason: the surest way to know a new business is
// created atomically AND isolated like every other one is to route it
// through the same transaction and the same stamping path every other
// business's data goes through, rather than parallel machinery that has to
// be trusted to agree.
func (s *Service) CreateBusiness(ctx context.Context, actor *SuperAdminUser, in CreateBusinessInput, reason string) (*tenant.Tenant, error) {
	if err := validateReason(reason); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return nil, ErrNameRequired
	}
	code := strings.ToLower(strings.TrimSpace(in.Code))
	if code == "" {
		return nil, ErrCodeRequired
	}
	if !businessCodePattern.MatchString(code) || len(code) > 32 {
		return nil, ErrInvalidCode
	}
	if _, err := s.tenantRepo.FindByCode(ctx, code); err == nil {
		return nil, ErrDuplicateCode
	}
	adminUsername := strings.TrimSpace(in.AdminUsername)
	if adminUsername == "" {
		return nil, ErrAdminUsernameReq
	}
	if len(in.AdminPassword) < 8 {
		return nil, ErrAdminPasswordWeak
	}

	var created tenant.Tenant
	var adminRoleName string
	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Bound to tx, not s.db — every insert below must land in the SAME
		// transaction as the tenant row, or a failure partway through
		// leaves an orphaned tenant with no way to sign in.
		txAuthzRepo := authz.NewRepository(tx)
		txBranchRepo := branch.NewRepository(tx)
		txEmployeeRepo := employee.NewRepository(tx)

		t := tenant.Tenant{Name: name, Code: code, TierID: in.TierID, Status: tenant.StatusActive}
		if err := tx.Create(&t).Error; err != nil {
			if isUniqueViolation(err) {
				return ErrDuplicateCode
			}
			return err
		}
		var tier tenant.Tier
		if err := tx.First(&tier, in.TierID).Error; err != nil {
			return ErrTierNotFound
		}

		// From here, every write is stamped tenant_id = t.ID by the
		// ordinary tenant-scope filter — see the function doc comment.
		newCtx := platform.WithTenant(ctx, t.ID)

		if err := txAuthzRepo.SeedRoles(newCtx, authz.StaffRoles); err != nil {
			return fmt.Errorf("seeding roles: %w", err)
		}
		adminRoleName = employee.AdminRole
		adminRoleID, err := txAuthzRepo.RoleIDByName(newCtx, adminRoleName)
		if err != nil {
			return fmt.Errorf("looking up the new Administrator role: %w", err)
		}
		// Full access for Administrator only. The other 8 roles start with
		// NO grants at all — a brand new business is locked down except
		// for its own admin, who configures the rest through the existing
		// role-permission admin screen, exactly as an on-prem customer
		// would. See authz.Repository.GrantAllToRole's doc comment for why
		// this is a loop of single-row upserts rather than a batch insert.
		if _, err := txAuthzRepo.GrantAllToRole(newCtx, adminRoleID); err != nil {
			return fmt.Errorf("granting the new Administrator role full access: %w", err)
		}

		// Not wrapped in tenant.Repository.ReserveBranchSlot: this is the
		// business's very first branch, every tier's minimum quota is at
		// least 1, and there is no concurrent request that could be racing
		// to create a branch for a tenant that does not exist outside this
		// transaction yet. The quota check that matters is enforced where a
		// real race is possible — branch.Service, for every LATER branch a
		// signed-in Administrator creates.
		b, err := txBranchRepo.FirstOrCreateByName(newCtx, "Head Office")
		if err != nil {
			return fmt.Errorf("creating the first branch: %w", err)
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(in.AdminPassword), bcrypt.DefaultCost+2)
		if err != nil {
			return err
		}
		adminName := strings.TrimSpace(in.AdminName)
		if adminName == "" {
			adminName = "Administrator"
		}
		emp := &employee.Employee{
			Code:         "EMP-ADMIN",
			Name:         adminName,
			Role:         adminRoleName,
			RoleID:       adminRoleID,
			BranchID:     b.ID,
			Username:     adminUsername,
			Phone:        strings.TrimSpace(in.AdminPhone),
			PasswordHash: string(hash),
		}
		if err := txEmployeeRepo.Create(newCtx, emp); err != nil {
			if isUniqueViolation(err) {
				return httpx.NewConflict("that administrator username is already taken")
			}
			return fmt.Errorf("creating the administrator login: %w", err)
		}

		created = t
		created.Tier = tier
		return nil
	})
	if err != nil {
		return nil, err
	}

	s.audit(ctx, actor, ActionCreateBusiness, &created.ID, created.Name,
		fmt.Sprintf("code=%s tier=%s admin=%s", created.Code, created.Tier.Name, adminUsername), reason)
	return &created, nil
}

func (s *Service) ListBusinesses(ctx context.Context) ([]tenant.Tenant, error) {
	return s.tenantRepo.FindAll(ctx)
}

func (s *Service) GetBusiness(ctx context.Context, id uint) (*tenant.Tenant, error) {
	t, err := s.tenantRepo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrBusinessNotFound
	}
	return t, nil
}

// SuspendBusiness and ReactivateBusiness are commercial levers, never a
// property lock. Tenant.CanWrite governs new lending/administration only —
// repayment and gold release are never gated by tenant status anywhere in
// this codebase, and this method changes nothing about that; it only flips
// the field those OTHER checks read.
func (s *Service) SuspendBusiness(ctx context.Context, actor *SuperAdminUser, id uint, reason string) (*tenant.Tenant, error) {
	if err := validateReason(reason); err != nil {
		return nil, err
	}
	t, err := s.tenantRepo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrBusinessNotFound
	}
	before := t.Status
	t.Status = tenant.StatusSuspended
	if err := s.tenantRepo.Update(ctx, t); err != nil {
		return nil, err
	}
	s.audit(ctx, actor, ActionSuspendBusiness, &t.ID, t.Name, fmt.Sprintf("status: %s -> %s", before, t.Status), reason)
	return t, nil
}

func (s *Service) ReactivateBusiness(ctx context.Context, actor *SuperAdminUser, id uint, reason string) (*tenant.Tenant, error) {
	if err := validateReason(reason); err != nil {
		return nil, err
	}
	t, err := s.tenantRepo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrBusinessNotFound
	}
	before := t.Status
	t.Status = tenant.StatusActive
	if err := s.tenantRepo.Update(ctx, t); err != nil {
		return nil, err
	}
	s.audit(ctx, actor, ActionReactivateBusiness, &t.ID, t.Name, fmt.Sprintf("status: %s -> %s", before, t.Status), reason)
	return t, nil
}

// ChangeTier does NOT re-check the business's current branch count against
// the new tier's quota, and that is deliberate, not an oversight: lowering a
// tier below a business's current usage must not fail their next login or
// block lending — see tenant.Tenant's StatusOverQuota, which exists
// specifically so this is a billing conversation the superadmin has with the
// business, not an outage the business discovers on their own. Enforcement
// happens where it actually bites: branch.Service refuses to CREATE or
// REACTIVATE a branch once the (possibly now-lower) quota is exceeded.
func (s *Service) ChangeTier(ctx context.Context, actor *SuperAdminUser, id, newTierID uint, reason string) (*tenant.Tenant, error) {
	if err := validateReason(reason); err != nil {
		return nil, err
	}
	t, err := s.tenantRepo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrBusinessNotFound
	}
	beforeTier := t.Tier.Name
	t.TierID = newTierID
	if err := s.tenantRepo.Update(ctx, t); err != nil {
		return nil, err
	}
	updated, err := s.tenantRepo.FindByID(ctx, id) // reload with the new Tier preloaded
	if err != nil {
		return nil, err
	}
	s.audit(ctx, actor, ActionChangeTier, &t.ID, t.Name, fmt.Sprintf("tier: %s -> %s", beforeTier, updated.Tier.Name), reason)
	return updated, nil
}

func (s *Service) AdjustExpiry(ctx context.Context, actor *SuperAdminUser, id uint, expiresAt *time.Time, reason string) (*tenant.Tenant, error) {
	if err := validateReason(reason); err != nil {
		return nil, err
	}
	t, err := s.tenantRepo.FindByID(ctx, id)
	if err != nil {
		return nil, ErrBusinessNotFound
	}
	before := "none"
	if t.SubscriptionExpiresAt != nil {
		before = t.SubscriptionExpiresAt.Format(time.RFC3339)
	}
	after := "none"
	if expiresAt != nil {
		after = expiresAt.Format(time.RFC3339)
	}
	t.SubscriptionExpiresAt = expiresAt
	if err := s.tenantRepo.Update(ctx, t); err != nil {
		return nil, err
	}
	s.audit(ctx, actor, ActionAdjustExpiry, &t.ID, t.Name, fmt.Sprintf("expiry: %s -> %s", before, after), reason)
	return t, nil
}

// --- Tiers ---------------------------------------------------------------

func (s *Service) ListTiers(ctx context.Context) ([]tenant.Tier, error) {
	return s.tenantRepo.FindAllTiers(ctx)
}

// SetTierPrice sets a tier's monthly Razorpay subscription price (plan
// Step 10). Deliberately NOT exposed anywhere a tenant's own admin can
// reach — pricing is the vendor's decision, made once here and inherited by
// every business on that tier the next time they subscribe or renew. An
// ALREADY-created Razorpay Plan is never mutated in place (Razorpay Plans
// are immutable once subscriptions exist against them): changing the price
// here only clears the cached RazorpayPlanID, so the NEXT subscribe call
// lazily creates a fresh Plan at the new price — existing subscribers keep
// billing at their existing Plan's price until they resubscribe, rather
// than a price change silently altering an in-flight subscription's terms.
func (s *Service) SetTierPrice(ctx context.Context, actor *SuperAdminUser, tierID uint, priceInPaise int64, reason string) (*tenant.Tier, error) {
	if err := validateReason(reason); err != nil {
		return nil, err
	}
	if priceInPaise < 0 {
		return nil, httpx.NewBadRequest("price cannot be negative")
	}
	tier, err := s.tenantRepo.FindTierByID(ctx, tierID)
	if err != nil {
		return nil, ErrTierNotFound
	}
	before := tier.PriceInPaise
	tier.PriceInPaise = priceInPaise
	tier.RazorpayPlanID = "" // see doc comment above
	if err := s.tenantRepo.SaveTier(ctx, tier); err != nil {
		return nil, err
	}
	s.audit(ctx, actor, ActionSetTierPrice, nil, tier.Name,
		fmt.Sprintf("price: %d -> %d paise", before, priceInPaise), reason)
	return tier, nil
}

// --- Audit -----------------------------------------------------------------

func (s *Service) ListAuditLog(ctx context.Context, f AuditLogFilter) ([]AuditLog, error) {
	return s.repo.FindAuditLogs(ctx, f)
}

func (s *Service) audit(ctx context.Context, actor *SuperAdminUser, action string, tenantID *uint, tenantName, detail, reason string) {
	entry := &AuditLog{
		SuperAdminUserID: actor.ID,
		ActorName:        actor.Name,
		Action:           action,
		TenantID:         tenantID,
		TenantName:       tenantName,
		Detail:           detail,
		Reason:           reason,
	}
	if err := s.repo.CreateAuditLog(ctx, entry); err != nil {
		// Deliberately not returned as a request error: the underlying
		// action (suspend, tier change, ...) already committed, and failing
		// the whole request AFTER that would tell the caller an action
		// failed when it actually succeeded. Logged server-side instead —
		// a missing audit ROW is a problem to notice and fix, not a reason
		// to leave the business in an inconsistent, half-applied state.
		fmt.Printf("superadmin: failed to write audit log for action=%s tenantId=%v: %v\n", action, tenantID, err)
	}
}

func validateReason(reason string) error {
	if strings.TrimSpace(reason) == "" {
		return ErrReasonRequired
	}
	return nil
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "duplicate key")
}
