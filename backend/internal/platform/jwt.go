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
	Role     string `json:"role"`
	RoleID   uint   `json:"roleId"`
	BranchID uint   `json:"branchId"`
	jwt.RegisteredClaims
}

// ErrInvalidToken is returned by ParseToken for any malformed, unsigned,
// wrong-algorithm, or expired token.
var ErrInvalidToken = errors.New("invalid or expired token")

// CustomerClaims is the JWT payload issued for the customer mobile app (see
// internal/customerauth). Deliberately a distinct type from Claims above —
// it carries "type": "customer" so ParseCustomerToken/CustomerAuthMiddleware
// can reject an employee token even if it were somehow presented here, and
// vice versa (ParseToken/AuthMiddleware never look at CustomerID at all).
type CustomerClaims struct {
	CustomerID uint   `json:"customerId"`
	Type       string `json:"type"`
	jwt.RegisteredClaims
}

// CustomerTokenType is the fixed "type" claim value stamped on every
// customer session JWT.
const CustomerTokenType = "customer"

// IssueCustomerToken mints a signed HS256 JWT for the given customer, valid
// for expiry from now. Uses the same signing secret as employee tokens
// (there's only one JWT_SECRET configured for this server) but a distinct
// claims shape/type so the two token kinds are never interchangeable.
func IssueCustomerToken(customerID uint, secret string, expiry time.Duration) (string, error) {
	now := time.Now()
	claims := CustomerClaims{
		CustomerID: customerID,
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
// expiry from now.
func IssueToken(employeeID uint, role string, roleID uint, branchID uint, secret string, expiry time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		EmployeeID: employeeID,
		Role:       role,
		RoleID:     roleID,
		BranchID:   branchID,
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(expiry)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

// ParseToken verifies and decodes a JWT issued by IssueToken.
func ParseToken(tokenStr, secret string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return nil, ErrInvalidToken
	}
	return claims, nil
}
