package platform

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims is the JWT payload issued at login (see internal/auth.Login) and
// read back by AuthMiddleware on every subsequent request. Deliberately
// lives in platform (not internal/auth) so both internal/auth (issuing) and
// AuthMiddleware below (verifying) can use it without an import cycle —
// platform is the shared low-level package other domain packages already
// depend on.
type Claims struct {
	EmployeeID uint `json:"employeeId"`
	// Role is the employee's role NAME, carried only for display/back-compat
	// with existing handlers/logs and branch-scoping's Administrator check
	// (see branch_scope.go) — it plays no part in permission resolution.
	// RoleID is the authorization key: RequirePermission resolves grants
	// per-request from role_permissions, so revoking a permission takes
	// effect immediately without waiting for this token to expire (see the
	// house role-permission standard's §5.1 — the token carries identity,
	// never the permission list itself).
	Role   string `json:"role"`
	RoleID uint   `json:"roleId"`

	// TenantID is the business this session belongs to, and it is the ONLY
	// place a request's tenant may come from. It is never read from a
	// header, a query string, a request body, or a URL segment — those are
	// all attacker-controlled, and a tenant taken from one of them is not a
	// security boundary at all.
	//
	// BranchID is subordinate to it: Management may narrow the active branch
	// per request (see the X-Branch-Id middleware), but nothing can change
	// which business you are.
	//
	// Zero means a token minted before multi-tenancy. AuthMiddleware rejects
	// those rather than defaulting them — guessing a tenant is exactly the
	// failure this field exists to prevent.
	TenantID uint `json:"tenantId"`
	BranchID uint `json:"branchId"`

	// Type discriminates this scheme from CustomerClaims and SuperAdminClaims
	// below. Added alongside the superadmin scheme (multi-tenancy plan, Step 7)
	// after noticing a real gap: with three JWT shapes now sharing one
	// signing secret, a token from one scheme can decode STRUCTURALLY into
	// another's Go struct wherever their JSON keys happen to coincide — a
	// customer token carries "tenantId" too, so it decoded into a non-zero
	// Claims.TenantID and passed AuthMiddleware's only check. Nothing in the
	// codebase had exploited that (permission lookups fail closed on the
	// resulting zero RoleID), but it was live and untested, and now that
	// there is a third scheme to keep separate it is worth closing properly
	// rather than trusting the same accident of unrelated checks again.
	//
	// Left EMPTY on a token issued before this field existed, and ParseToken
	// accepts an empty Type — only a token carrying a DIFFERENT scheme's
	// explicit type marker is rejected. That is what avoids forcing every
	// signed-in employee to log in again purely for this change, matching
	// this codebase's precedent of only forcing re-auth when a session is
	// missing information a check must have, not on defensive tightening.
	Type string `json:"type,omitempty"`
	jwt.RegisteredClaims
}

// EmployeeTokenType is the "type" claim stamped on every staff session JWT
// issued from here on. See Claims.Type.
const EmployeeTokenType = "employee"

// ErrInvalidToken is returned by ParseToken for any malformed, unsigned,
// wrong-algorithm, or expired token.
var ErrInvalidToken = errors.New("invalid or expired token")

// CustomerClaims is the JWT payload issued for the customer mobile app (see
// internal/customerauth). Deliberately a distinct type from Claims above —
// it carries "type": "customer" so ParseCustomerToken/CustomerAuthMiddleware
// can reject an employee token even if it were somehow presented here, and
// vice versa (ParseToken/AuthMiddleware never look at CustomerID at all).
type CustomerClaims struct {
	CustomerID uint `json:"customerId"`
	// TenantID is the business this borrower's loans belong to. Carried for
	// the same reason as Claims.TenantID: every query the borrower app makes
	// is tenant-filtered, so a session with no tenant can read nothing.
	//
	// A borrower who has loans with two different businesses has two separate
	// logins, one per business — that was a deliberate decision, since
	// merging them would tell each business the person also borrows
	// elsewhere.
	TenantID uint   `json:"tenantId"`
	Type     string `json:"type"`
	jwt.RegisteredClaims
}

// CustomerTokenType is the fixed "type" claim value stamped on every
// customer session JWT.
const CustomerTokenType = "customer"

// IssueCustomerToken mints a signed HS256 JWT for the given customer, valid
// for expiry from now. Uses the same signing secret as employee tokens
// (there's only one JWT_SECRET configured for this server) but a distinct
// claims shape/type so the two token kinds are never interchangeable.
func IssueCustomerToken(customerID uint, tenantID uint, secret string, expiry time.Duration) (string, error) {
	if tenantID == 0 {
		return "", errors.New("platform: refusing to issue a customer token with no tenant")
	}
	now := time.Now()
	claims := CustomerClaims{
		CustomerID: customerID,
		TenantID:   tenantID,
		Type:       CustomerTokenType,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(expiry)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ParseCustomerToken verifies and decodes a JWT issued by IssueCustomerToken,
// rejecting anything without the expected "type": "customer" claim (in
// particular, an employee JWT parses fine structurally but has no such
// claim, so it's rejected here too).
func ParseCustomerToken(tokenStr, secret string) (*CustomerClaims, error) {
	claims := &CustomerClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return []byte(secret), nil
	})
	if err != nil || !token.Valid || claims.Type != CustomerTokenType {
		return nil, ErrInvalidToken
	}
	return claims, nil
}

// IssueToken mints a signed HS256 JWT for the given employee, valid for
// expiry from now. tenantID must be non-zero — see Claims.TenantID.
func IssueToken(employeeID uint, role string, roleID uint, tenantID uint, branchID uint, secret string, expiry time.Duration) (string, error) {
	if tenantID == 0 {
		return "", errors.New("platform: refusing to issue a token with no tenant")
	}
	now := time.Now()
	claims := Claims{
		EmployeeID: employeeID,
		Role:       role,
		RoleID:     roleID,
		TenantID:   tenantID,
		BranchID:   branchID,
		Type:       EmployeeTokenType,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(expiry)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ParseToken verifies and decodes a JWT issued by IssueToken.
//
// Rejects a token that carries another scheme's explicit Type — a customer
// or superadmin token structurally decoded into this struct — but accepts a
// blank Type, which is every employee token issued before this field
// existed. See Claims.Type for why that asymmetry is deliberate.
func ParseToken(tokenStr, secret string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return []byte(secret), nil
	})
	if err != nil || !token.Valid || (claims.Type != "" && claims.Type != EmployeeTokenType) {
		return nil, ErrInvalidToken
	}
	return claims, nil
}

// SuperAdminClaims is the JWT payload for our own team's console (see
// internal/superadmin, multi-tenancy plan Step 7).
//
// Deliberately its own type, its own "type" claim, and — structurally — no
// field that shares a JSON key with Claims or CustomerClaims. A superadmin
// carries no TenantID and no BranchID: they are not scoped to any one
// business, which is the entire point of the role. That absence is also
// what makes a superadmin token harmless if it were ever mistakenly presented to
// AuthMiddleware/CustomerAuthMiddleware — TenantID decodes to zero, and both
// of those already reject a zero tenant. SuperAdminAuthMiddleware additionally
// checks Type explicitly, matching the customer scheme's pattern, so the
// rejection does not rest on that coincidence alone.
type SuperAdminClaims struct {
	SuperAdminUserID uint   `json:"superAdminUserId"`
	Name             string `json:"name"`
	Type             string `json:"type"`
	jwt.RegisteredClaims
}

// SuperAdminTokenType is the fixed "type" claim value stamped on every
// superadmin session JWT.
const SuperAdminTokenType = "superadmin"

// IssueSuperAdminToken mints a signed HS256 JWT for the given superadmin user,
// using the same signing secret as every other scheme (there is one
// JWT_SECRET for this server) but a claims shape that shares no field name
// with Claims or CustomerClaims — see SuperAdminClaims.
func IssueSuperAdminToken(superAdminUserID uint, name, secret string, expiry time.Duration) (string, error) {
	now := time.Now()
	claims := SuperAdminClaims{
		SuperAdminUserID: superAdminUserID,
		Name:             name,
		Type:             SuperAdminTokenType,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(expiry)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ParseSuperAdminToken verifies and decodes a JWT issued by IssueSuperAdminToken,
// strictly requiring the "type": "superadmin" claim — unlike ParseToken's
// blank-Type allowance, there is no pre-existing population of superadmin
// tokens to stay compatible with, so this can and does reject anything that
// isn't exactly a superadmin token.
func ParseSuperAdminToken(tokenStr, secret string) (*SuperAdminClaims, error) {
	claims := &SuperAdminClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return []byte(secret), nil
	})
	if err != nil || !token.Valid || claims.Type != SuperAdminTokenType {
		return nil, ErrInvalidToken
	}
	return claims, nil
}
