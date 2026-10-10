package auth

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var errInvalidToken = errors.New("invalid token")

type Claims struct {
	EmployeeID uint   `json:"employeeId"`
	Role       string `json:"role"`
	RoleID     uint   `json:"roleId"`
	TenantID   uint   `json:"tenantId"`
	BranchID   uint   `json:"branchId"`
	Type       string `json:"type,omitempty"`
	jwt.RegisteredClaims
}

type CustomerClaims struct {
	CustomerID uint   `json:"customerId"`
	TenantID   uint   `json:"tenantId"`
	Type       string `json:"type"`
	jwt.RegisteredClaims
}

type SuperAdminClaims struct {
	SuperAdminUserID uint   `json:"superAdminUserId"`
	Name             string `json:"name"`
	Type             string `json:"type"`
	jwt.RegisteredClaims
}

func IssueCustomerToken(customerID uint, tenantID uint, secret string, expiry time.Duration) (string, error) {
	if tenantID == 0 {
		return "", errors.New("platform: refusing to issue a customer token with no tenant")
	}
	now := time.Now()
	claims := CustomerClaims{
		CustomerID: customerID,
		TenantID:   tenantID,
		Type:       "customer",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(expiry)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func ParseCustomerToken(tokenStr, secret string) (*CustomerClaims, error) {
	claims := &CustomerClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errInvalidToken
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid || claims.Type != "customer" {
		return nil, errInvalidToken
	}
	return claims, nil
}

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
		Type:       "employee",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(expiry)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func ParseToken(tokenStr, secret string) (*Claims, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errInvalidToken
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid || (claims.Type != "" && claims.Type != "employee") {
		return nil, errInvalidToken
	}
	return claims, nil
}

func IssueSuperAdminToken(superAdminUserID uint, name, secret string, expiry time.Duration) (string, error) {
	now := time.Now()
	claims := SuperAdminClaims{
		SuperAdminUserID: superAdminUserID,
		Name:             name,
		Type:             "superadmin",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(expiry)),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(secret))
}

func ParseSuperAdminToken(tokenStr, secret string) (*SuperAdminClaims, error) {
	claims := &SuperAdminClaims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errInvalidToken
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid || claims.Type != "superadmin" {
		return nil, errInvalidToken
	}
	return claims, nil
}
