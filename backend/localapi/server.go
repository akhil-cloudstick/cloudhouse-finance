// Package localapi answers the app's read requests from the PC's own copy of the business, when the server cannot be
// reached. It runs the backend's own route handlers against the SQLite mirror (see common/mirror), so a list or a detail
// screen shows what the server would have shown. It only reads: every change still goes through the outbox. It trusts
// the session the PC saved at sign-in (the login token cannot be checked without the server's secret), and the user's
// permissions are read from the mirrored role tables, so a role sees offline what it could see online.
package localapi

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"

	"cloudhouse/backend/auth"
	"cloudhouse/backend/common/controllers"
	"cloudhouse/backend/common/routers"
	"cloudhouse/backend/config"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Session is who is signed in on this PC, as saved at sign-in.
type Session struct {
	TenantID   uint   `json:"tenantId"`
	EmployeeID uint   `json:"employeeId"`
	RoleID     uint   `json:"roleId"`
	Role       string `json:"role"`
	BranchID   uint   `json:"branchId"`
	IsSystem   bool   `json:"isSystem"`
}

// Response is the answer to one request.
type Response struct {
	Status int    `json:"status"`
	Body   string `json:"body"`
}

type Server struct {
	mu   sync.RWMutex
	sess Session
	db   *gorm.DB
	raw  *sql.DB
	echo *echo.Echo
	path string
	// gate: reads share it, a replay (see replay.go) holds it alone, because a replay points the handlers at its own transaction
	gate  sync.RWMutex
	token string
	wraw  *sql.DB
	wdb   *gorm.DB
	memo  map[string]memoEntry
}

var (
	once    sync.Once
	current *Server
)

// Open starts the local server on the PC's database file. The first call builds it; later calls return the same one.
func Open(dbPath string) (*Server, error) {
	var err error
	once.Do(func() { current, err = build(dbPath) })
	if err != nil {
		once = sync.Once{}
		return nil, err
	}
	if current == nil {
		return nil, errors.New("the local server is not available")
	}
	return current, nil
}

func build(dbPath string) (*Server, error) {
	raw, err := sql.Open("sqlite", "file:"+strings.ReplaceAll(dbPath, "\\", "/")+"?_pragma=busy_timeout(10000)&_pragma=foreign_keys(0)&_pragma=query_only(1)")
	if err != nil {
		return nil, err
	}
	raw.SetMaxOpenConns(4)
	db, err := gorm.Open(dialector{conn: &pool{db: raw}}, &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		return nil, fmt.Errorf("opening the local copy: %w", err)
	}
	if err := config.RegisterTenantScope(db); err != nil {
		return nil, err
	}
	config.BaseDB = db
	config.DB = config.NewConnPinner(db)

	s := &Server{db: db, raw: raw, path: dbPath, token: newToken()}
	// answers about the session and the business come from the local copy and the saved session, not from server tables
	auth.SingleBranchHeadOffice = func(context.Context, uint) (uint, bool, error) { return 0, false, nil }
	auth.HasModule = func(context.Context, uint, string) (bool, error) { return true, nil }
	auth.TenantIDForHost = func(context.Context, string) (uint, bool) { return 0, false }
	auth.TenantIDForHostLabel = func(context.Context, string) (uint, bool) { return 0, false }
	auth.IsAllowed = controllers.IsAllowed
	auth.LocalStaff = []echo.MiddlewareFunc{s.session, auth.RequireSelf("user_id", "employeeId"), s.readOnly}

	e := echo.New()
	routers.InitRoutes(e)
	s.echo = e
	return s, nil
}

// Close releases the database file (the app calls it when the store is closed or moved).
func Close() {
	if current != nil {
		if current.wraw != nil {
			_ = current.wraw.Close()
		}
		_ = current.raw.Close()
		current = nil
	}
	once = sync.Once{}
	auth.LocalStaff = nil
}

// Bind sets who is signed in. Call it at sign-in and when the session changes.
func (s *Server) Bind(sess Session) error {
	if sess.TenantID == 0 || sess.EmployeeID == 0 || sess.RoleID == 0 {
		return errors.New("the saved session is incomplete")
	}
	sess = s.refreshFromCopy(sess)
	s.mu.Lock()
	s.sess = sess
	s.mu.Unlock()
	return nil
}

// refreshFromCopy takes the employee's role and branch from the copy when it holds them (the server decides these live, and
// the copy follows the server), so a role changed since the login token was issued applies offline too. When the copy does
// not hold the employee (a role without permission to view employees does not receive that table), the token's values stand.
func (s *Server) refreshFromCopy(sess Session) Session {
	var emp struct {
		Role     string
		RoleID   uint
		BranchID uint
	}
	if err := s.db.Raw("SELECT role, role_id, branch_id FROM employees WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL", sess.EmployeeID, sess.TenantID).Scan(&emp).Error; err == nil && emp.RoleID != 0 {
		sess.Role, sess.RoleID, sess.BranchID = emp.Role, emp.RoleID, emp.BranchID
	}
	var role struct{ IsSystem bool }
	if err := s.db.Raw("SELECT is_system FROM roles WHERE id = ? AND tenant_id = ?", sess.RoleID, sess.TenantID).Scan(&role).Error; err == nil {
		sess.IsSystem = role.IsSystem
	}
	return sess
}

func (s *Server) session(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		s.mu.RLock()
		sess := s.sess
		s.mu.RUnlock()
		if sess.EmployeeID == 0 {
			return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "no saved session on this PC"})
		}
		c.Set("employeeId", sess.EmployeeID)
		c.Set("role", sess.Role)
		c.Set("roleId", sess.RoleID)
		c.Set("isSystem", sess.IsSystem)
		c.Set("tenantId", sess.TenantID)
		c.Set("branchId", sess.BranchID)
		return next(c)
	}
}

func (s *Server) readOnly(next echo.HandlerFunc) echo.HandlerFunc {
	return func(c echo.Context) error {
		// a replay of a waiting change (replay.go) is the one write the copy allows, and it is never committed
		if h := c.Request().Header.Get(replayHeader); h != "" && h == s.token {
			return next(c)
		}
		if m := c.Request().Method; m != http.MethodGet && m != http.MethodHead {
			return c.JSON(http.StatusMethodNotAllowed, echo.Map{"success": false, "error": "changes made offline are queued, not applied to the local copy"})
		}
		return next(c)
	}
}

// Handle answers one request. path is the route as the app uses it after /api/v1 (for example /users/5/loans).
func (s *Server) Handle(method, path, query string, headers map[string]string) Response {
	s.gate.RLock()
	defer s.gate.RUnlock()
	s.mu.RLock()
	bound := s.sess.EmployeeID != 0
	s.mu.RUnlock()
	if !bound {
		return Response{Status: http.StatusUnauthorized, Body: `{"success":false,"error":"no saved session on this PC"}`}
	}
	target := "/api/v1" + path
	if query != "" {
		target += "?" + strings.TrimPrefix(query, "?")
	}
	req := httptest.NewRequest(method, target, bytes.NewReader(nil))
	for k, v := range headers {
		switch strings.ToLower(k) {
		case "x-branch-id", "accept", "accept-language":
			req.Header.Set(k, v)
		}
	}
	rec := httptest.NewRecorder()
	s.echo.ServeHTTP(rec, req)
	body, _ := io.ReadAll(rec.Result().Body)
	return Response{Status: rec.Code, Body: string(body)}
}
