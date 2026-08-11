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
	EmployeeID uint   `json:"employeeId"`
	Role       string `json:"role"`
	BranchID   uint   `json:"branchId"`
	jwt.RegisteredClaims
}

// ErrInvalidToken is returned by ParseToken for any malformed, unsigned,
// wrong-algorithm, or expired token.
var ErrInvalidToken = errors.New("invalid or expired token")

// IssueToken mints a signed HS256 JWT for the given employee, valid for
// expiry from now.
func IssueToken(employeeID uint, role string, branchID uint, secret string, expiry time.Duration) (string, error) {
	now := time.Now()
	claims := Claims{
		EmployeeID: employeeID,
		Role:       role,
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
