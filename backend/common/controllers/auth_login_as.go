package controllers

import (
	commonModels "cloudhouse/backend/common/models"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/labstack/echo/v4"
)

// "Login as": the superadmin console opens a business's own site, in a new tab, as one of its employees, with no
// password. The console cannot hand the session over directly (the business's site is another origin, with its own
// storage), so it gets a one-time code that the business's site trades for the session here.
//
// Nothing about the business changes: the session is a plain stateless token, so the real employee is never signed
// out, no password, device or offline sign-in is stored, and nothing is written to the business's tables.

const loginAsCodeTTL = time.Minute

// LoginAsSessionTTL is how long a "Login as" session lasts; after it the superadmin clicks Login as again.
const LoginAsSessionTTL = 4 * time.Hour

type loginAsTicket struct {
	token    string
	employee *commonModels.Employee
	expires  time.Time
}

var loginAsTickets = struct {
	sync.Mutex
	byCode map[string]loginAsTicket
}{byCode: map[string]loginAsTicket{}}

// IssueLoginAsCode keeps a ready-made session behind a one-time code that works once, for one minute.
func IssueLoginAsCode(token string, employee *commonModels.Employee) (string, error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	code := hex.EncodeToString(raw)
	now := time.Now()
	loginAsTickets.Lock()
	defer loginAsTickets.Unlock()
	for key, ticket := range loginAsTickets.byCode {
		if now.After(ticket.expires) {
			delete(loginAsTickets.byCode, key)
		}
	}
	loginAsTickets.byCode[code] = loginAsTicket{token: token, employee: employee, expires: now.Add(loginAsCodeTTL)}
	return code, nil
}

func redeemLoginAsCode(code string) (*loginAsTicket, error) {
	loginAsTickets.Lock()
	ticket, found := loginAsTickets.byCode[code]
	delete(loginAsTickets.byCode, code)
	loginAsTickets.Unlock()
	if !found || time.Now().After(ticket.expires) {
		return nil, NewUnauthorized("This login link has expired. Click Login as again in the superadmin console.")
	}
	return &ticket, nil
}

// LoginAs trades a one-time code from the superadmin console for the session, on the business's own site.
func LoginAs(c echo.Context) error {
	var in struct {
		Code string `json:"code"`
	}
	if err := BindJSON(c, &in); err != nil || strings.TrimSpace(in.Code) == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "The login link is missing its code"})
	}
	ticket, err := redeemLoginAsCode(strings.TrimSpace(in.Code))
	if err != nil {
		return FailErr(c, err)
	}
	SetAuthCookie(c, ticket.token, int(LoginAsSessionTTL.Seconds()))
	return Success(c, http.StatusOK, LoginResponse{Token: ticket.token, Employee: ticket.employee})
}
