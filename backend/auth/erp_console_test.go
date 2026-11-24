package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func erpTestKey(t *testing.T) (*ecdsa.PrivateKey, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	return key, string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: der}))
}

func signERP(t *testing.T, key *ecdsa.PrivateKey, claims jwt.Claims) string {
	t.Helper()
	s, err := jwt.NewWithClaims(jwt.SigningMethodES256, claims).SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestParseERPConsoleToken(t *testing.T) {
	key, pub := erpTestKey(t)
	otherKey, _ := erpTestKey(t)
	exp := time.Now().Add(time.Minute).Unix()

	valid := jwt.MapClaims{"type": "erp_console", "aud": "gold-finance", "employee_id": 7, "name": "Asha", "exp": exp}
	c, err := ParseERPConsoleToken(signERP(t, key, valid), pub, "gold-finance")
	if err != nil || c.EmployeeID != 7 || c.Name != "Asha" {
		t.Fatalf("valid token rejected: %v %+v", err, c)
	}

	cases := map[string]string{
		"wrong type":        signERP(t, key, jwt.MapClaims{"type": "x", "aud": "gold-finance", "employee_id": 7, "exp": exp}),
		"wrong audience":    signERP(t, key, jwt.MapClaims{"type": "erp_console", "aud": "other", "employee_id": 7, "exp": exp}),
		"no audience":       signERP(t, key, jwt.MapClaims{"type": "erp_console", "employee_id": 7, "exp": exp}),
		"expired":           signERP(t, key, jwt.MapClaims{"type": "erp_console", "aud": "gold-finance", "employee_id": 7, "exp": time.Now().Add(-time.Minute).Unix()}),
		"no expiry":         signERP(t, key, jwt.MapClaims{"type": "erp_console", "aud": "gold-finance", "employee_id": 7}),
		"no employee":       signERP(t, key, jwt.MapClaims{"type": "erp_console", "aud": "gold-finance", "exp": exp}),
		"system, other key": signERP(t, otherKey, jwt.MapClaims{"type": "erp_console", "aud": "gold-finance", "system": true, "exp": exp}),
		"other key":         signERP(t, otherKey, valid),
		"erp login token":   signERP(t, key, jwt.MapClaims{"user_id": 7, "role_id": 1, "user_type": "admin", "exp": exp}),
	}
	for name, tok := range cases {
		if _, err := ParseERPConsoleToken(tok, pub, "gold-finance"); err == nil {
			t.Errorf("%s: accepted, want rejected", name)
		}
	}

	sys, err := ParseERPConsoleToken(signERP(t, key, jwt.MapClaims{"type": "erp_console", "aud": "gold-finance", "system": true, "exp": exp}), pub, "gold-finance")
	if err != nil || !sys.System {
		t.Fatalf("system token rejected: %v", err)
	}

	hs, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, valid).SignedString([]byte("secret"))
	if _, err := ParseERPConsoleToken(hs, pub, "gold-finance"); err == nil {
		t.Error("HS256 token accepted, want rejected")
	}
}
