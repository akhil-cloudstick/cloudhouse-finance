package controllers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"

	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"

	"github.com/labstack/echo/v4"
)

// lanKeyFor derives the key the PCs of one business use to trust each other on the local network (see desktop/lan): it
// signs the announcements that name the main PC and every request a counter makes to it. Only the server holds the
// secret, so a PC that is not signed in to this business cannot compute it, and nothing is stored: the key is derived
// again on every request.
func lanKeyFor(secret string, tenantID uint) string {
	m := hmac.New(sha256.New, []byte(secret))
	m.Write([]byte("lan-key:v1:" + strconv.FormatUint(uint64(tenantID), 10)))
	return hex.EncodeToString(m.Sum(nil))
}

// SyncLanKey gives a signed-in PC of the business the key it needs to join the main PC on the local network. It is the
// caller's own business's key, taken from the login token.
func SyncLanKey(c echo.Context) error {
	tenantID, ok := config.TenantFromContext(auth.RequestContext(c))
	if !ok || tenantID == 0 {
		return common.Fail(c, http.StatusUnauthorized, "no business for this sign-in")
	}
	return common.Success(c, http.StatusOK, map[string]any{"key": lanKeyFor(config.Env.JWTSecret, tenantID)})
}
