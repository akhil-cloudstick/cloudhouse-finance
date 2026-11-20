package auth

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
)

func TestTableForParam(t *testing.T) {
	cases := []struct{ route, param, want string }{
		{"/api/v1/users/:user_id/loans/:id/approve", "id", "loans"},
		{"/api/v1/users/:user_id/customers/:id", "id", "customers"},
		{"/api/v1/users/:user_id/loans/ornaments/:ornament_id/update", "ornament_id", ""},
		{"/api/v1/users/:user_id/loans/:id", "user_id", ""},
	}
	for _, c := range cases {
		if got := tableForParam(c.route, c.param); got != c.want {
			t.Errorf("tableForParam(%q, %q) = %q, want %q", c.route, c.param, got, c.want)
		}
	}
}

func TestSyncEntryPassesThroughWithoutHeader(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(`{"customer_id":5}`))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	var body string
	err := SyncEntry()(func(c echo.Context) error {
		b, _ := io.ReadAll(c.Request().Body)
		body = string(b)
		return c.NoContent(http.StatusOK)
	})(c)
	if err != nil || rec.Code != http.StatusOK {
		t.Fatalf("got err=%v code=%d, want a plain pass-through", err, rec.Code)
	}
	if body != `{"customer_id":5}` {
		t.Errorf("body was altered: %q", body)
	}
}

func TestSyncEntryRejectsMalformedClientUUID(t *testing.T) {
	e := echo.New()
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(`{}`))
	req.Header.Set(headerClientUUID, "not-a-uuid")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	_ = SyncEntry()(func(c echo.Context) error { return c.NoContent(http.StatusOK) })(c)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("code = %d, want 400", rec.Code)
	}
}

func TestUUIDPattern(t *testing.T) {
	for s, want := range map[string]bool{
		"0192a000-0000-7000-8000-00000000a231": true,
		"0192A000-0000-7000-8000-00000000A231": true,
		"0192a000-0000-7000-8000-00000000a23":  false,
		"1; drop table loans":                  false,
	} {
		if got := uuidPattern.MatchString(s); got != want {
			t.Errorf("uuidPattern(%q) = %v, want %v", s, got, want)
		}
	}
}

// The same vector is produced by the exe's WebCrypto signer (frontend/common/offline/device.ts), so a
// signature made on a PC verifies here.
func TestSignatureMatchesTheExe(t *testing.T) {
	const key = "3f9a1c7e5b2d4a6c8e0f1b3d5a7c9e2f"
	body := []byte(`{"customer_id":"uuid:abc","principal_amount":1200.5,"note":"₹ ok"}`)
	const want = "51cb9259386d237b551dc5ef60f6bab64d8a69e2cfd8e7c85203c30aabc67d7a"
	if got := signature(key, body); got != want {
		t.Errorf("signature = %s, want %s", got, want)
	}
	if signature(key, append(body, ' ')) == want {
		t.Error("a changed body produced the same signature")
	}
}
