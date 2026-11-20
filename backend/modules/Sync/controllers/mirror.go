package controllers

import (
	"cloudhouse/backend/auth"
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/common/mirror"
	"cloudhouse/backend/config"
	loan "cloudhouse/backend/modules/Loan/controllers"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v4"
)

// The routes below let a desktop PC copy the business's tables row for row (see common/mirror for the list). A PC asks
// for the rows of a table changed since its cursor, the whole of a small table, the child rows of parents it holds, or
// the ids it should still hold. Only listed tables and columns are served, and the rows a caller may see follow the
// same branch rule as the loan pull.

const (
	mirrorOverlap  = 5 * time.Minute
	mirrorMaxLimit = 2000
	mirrorMaxIDs   = 500
)

type mirrorNext struct {
	After string `json:"after"`
	Start string `json:"start"`
}

type mirrorPage struct {
	Rows    []map[string]any `json:"rows"`
	HasMore bool             `json:"has_more"`
	Next    mirrorNext       `json:"next"`
	Cursor  string           `json:"cursor"`
}

func mirrorBranchScope(c echo.Context) *uint {
	scope := auth.GetBranchScope(c)
	if _, pinned := auth.SingleBranchPin(c); !pinned && auth.IsCrossBranchRole(c) {
		return nil
	}
	return scope
}

// visibleFilter is the SQL that limits a table to the rows a caller with this branch scope may see ("" for no limit).
func visibleFilter(t *mirror.Table, scope *uint) (string, []any) {
	if scope == nil {
		return "", nil
	}
	if t.Name == "customers" {
		return "(branch_id = ? OR id IN (SELECT customer_id FROM loans WHERE branch_id = ? AND deleted_at IS NULL))", []any{*scope, *scope}
	}
	if t.BranchKey != "" {
		return fmt.Sprintf("(%s = ? OR %s IS NULL OR %s = 0)", t.BranchKey, t.BranchKey, t.BranchKey), []any{*scope}
	}
	if t.Parent != nil {
		p := mirror.ByName(t.Parent.Table)
		if p == nil {
			return "1 = 0", nil
		}
		psql, pargs := visibleFilter(p, scope)
		if psql == "" {
			return "", nil
		}
		return fmt.Sprintf("%s IN (SELECT %s FROM %s WHERE %s)", t.Parent.Column, p.PrimaryKey[0], p.Name, psql), pargs
	}
	if t.VisibleVia != nil {
		p := mirror.ByName(t.VisibleVia.Table)
		if p == nil {
			return "1 = 0", nil
		}
		psql, pargs := visibleFilter(p, scope)
		if psql == "" {
			return "", nil
		}
		return fmt.Sprintf("%s IN (SELECT %s FROM %s WHERE %s)", t.VisibleVia.Column, p.PrimaryKey[0], p.Name, psql), pargs
	}
	return "", nil
}

func columnList(t *mirror.Table) string {
	names := make([]string, len(t.Columns))
	for i, col := range t.Columns {
		names[i] = col.Name
	}
	return strings.Join(names, ", ")
}

// plain makes database values JSON-friendly: text that arrives as bytes becomes a string.
func plain(rows []map[string]any) []map[string]any {
	if rows == nil {
		return []map[string]any{} // an empty table is [], never null: the PC reads the rows as a list
	}
	for _, r := range rows {
		for k, v := range r {
			if b, ok := v.([]byte); ok {
				r[k] = string(b)
			}
		}
	}
	return rows
}

func parseAfter(raw string) (time.Time, uint, bool, error) {
	if raw == "" {
		return time.Time{}, 0, false, nil
	}
	parts := strings.SplitN(raw, "|", 2)
	if len(parts) != 2 {
		return time.Time{}, 0, false, fmt.Errorf("invalid after")
	}
	at, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, 0, false, err
	}
	id, err := strconv.ParseUint(parts[1], 10, 64)
	if err != nil {
		return time.Time{}, 0, false, err
	}
	return at, uint(id), true, nil
}

// SyncTables lists the tables a PC copies and how each is kept current.
func SyncTables(c echo.Context) error {
	ts, err := mirror.Tables()
	if err != nil {
		return common.FailErr(c, err)
	}
	ctx := auth.RequestContext(c)
	tenantID, _ := config.TenantFromContext(ctx)
	allowed := make([]mirror.Table, 0, len(ts))
	for i := range ts {
		if mayView(c, &ts[i]) {
			allowed = append(allowed, ts[i])
		}
	}
	return common.Success(c, http.StatusOK, map[string]any{"tenant": tenantID, "scope": loan.ScopeLabel(mirrorBranchScope(c)), "tables": allowed})
}

// mayView says whether the caller's role has the view permission this table needs. A permission that does not exist, or a
// failed check, counts as no.
func mayView(c echo.Context, t *mirror.Table) bool {
	if auth.IsAllowed == nil {
		return false
	}
	_, _, roleID := auth.ActorFromContext(c)
	ok, err := auth.IsAllowed(auth.RequestContext(c), roleID, t.Permission)
	return err == nil && ok
}

func pageTime(c echo.Context, name string) (time.Time, error) {
	if raw := c.QueryParam(name); raw != "" {
		return time.Parse(time.RFC3339Nano, raw)
	}
	return time.Time{}, nil
}

// SyncTableRows returns rows of one table: those changed since the cursor (incremental tables, in pages), or the whole
// table (small tables).
func SyncTableRows(c echo.Context) error {
	ctx := auth.RequestContext(c)
	t := mirror.ByName(c.Param("name"))
	if t == nil || t.Mode == "child" {
		return common.Fail(c, http.StatusNotFound, "table not found")
	}
	if !mayView(c, t) {
		return common.Fail(c, http.StatusForbidden, "you do not have permission to view this table")
	}
	since, err := pageTime(c, "since")
	if err != nil {
		return common.Fail(c, http.StatusBadRequest, "invalid since cursor")
	}
	start, err := pageTime(c, "start")
	if err != nil {
		return common.Fail(c, http.StatusBadRequest, "invalid start")
	}
	if start.IsZero() {
		start = time.Now()
	}
	afterAt, afterID, hasAfter, err := parseAfter(c.QueryParam("after"))
	if err != nil {
		return common.Fail(c, http.StatusBadRequest, "invalid after")
	}
	limit, _ := strconv.Atoi(c.QueryParam("limit"))
	if limit > mirrorMaxLimit {
		limit = mirrorMaxLimit
	}
	q := config.DB.WithContext(ctx).Table(t.Name).Select(columnList(t))
	if sql, args := visibleFilter(t, mirrorBranchScope(c)); sql != "" {
		q = q.Where(sql, args...)
	}
	page := mirrorPage{Rows: []map[string]any{}}
	if t.Mode == "incremental" {
		if since.IsZero() {
			if t.HasDeletedAt {
				q = q.Where("deleted_at IS NULL")
			}
		} else {
			q = q.Where("updated_at >= ?", since)
		}
		if hasAfter {
			q = q.Where("(updated_at > ? OR (updated_at = ? AND id > ?))", afterAt, afterAt, afterID)
		}
		q = q.Order("updated_at, id")
		if limit > 0 {
			q = q.Limit(limit + 1)
		}
	}
	var rows []map[string]any
	if err := q.Find(&rows).Error; err != nil {
		return common.FailErr(c, err)
	}
	if t.Mode == "incremental" && limit > 0 && len(rows) > limit {
		rows = rows[:limit]
		page.HasMore = true
	}
	page.Rows = plain(rows)
	page.Next = mirrorNext{Start: start.UTC().Format(time.RFC3339Nano)}
	if n := len(rows); n > 0 && t.Mode == "incremental" {
		last := rows[n-1]
		if at, ok := last["updated_at"].(time.Time); ok {
			page.Next.After = at.UTC().Format(time.RFC3339Nano) + "|" + fmt.Sprint(last[t.PrimaryKey[0]])
		}
	} else if hasAfter {
		page.Next.After = afterAt.UTC().Format(time.RFC3339Nano) + "|" + strconv.FormatUint(uint64(afterID), 10)
	}
	cursor := start.Add(-mirrorOverlap)
	if cursor.Before(since) {
		cursor = since
	}
	page.Cursor = cursor.UTC().Format(time.RFC3339Nano)
	return common.Success(c, http.StatusOK, page)
}

func idList(raw string) ([]uint, bool) {
	if raw == "" {
		return nil, true
	}
	parts := strings.Split(raw, ",")
	if len(parts) > mirrorMaxIDs {
		return nil, false
	}
	ids := make([]uint, 0, len(parts))
	for _, p := range parts {
		n, err := strconv.ParseUint(strings.TrimSpace(p), 10, 64)
		if err != nil {
			return nil, false
		}
		ids = append(ids, uint(n))
	}
	return ids, true
}

// SyncChildRows returns the rows of a child table that belong to the given parent rows, whatever their age: a parent
// that changed has its children fetched again as a set.
func SyncChildRows(c echo.Context) error {
	ctx := auth.RequestContext(c)
	t := mirror.ByName(c.Param("name"))
	if t == nil || t.Mode != "child" || t.Parent == nil {
		return common.Fail(c, http.StatusNotFound, "table not found")
	}
	if !mayView(c, t) {
		return common.Fail(c, http.StatusForbidden, "you do not have permission to view this table")
	}
	ids, ok := idList(c.QueryParam("ids"))
	if !ok {
		return common.Fail(c, http.StatusBadRequest, "invalid ids")
	}
	out := mirrorPage{Rows: []map[string]any{}}
	if len(ids) == 0 {
		return common.Success(c, http.StatusOK, out)
	}
	parent := mirror.ByName(t.Parent.Table)
	if parent == nil {
		return common.Fail(c, http.StatusNotFound, "table not found")
	}
	// only parents this caller may see count, whatever ids were sent
	if sql, args := visibleFilter(parent, mirrorBranchScope(c)); sql != "" {
		var visible []uint
		pq := config.DB.WithContext(ctx).Table(parent.Name).Where(parent.PrimaryKey[0]+" IN ?", ids).Where(sql, args...)
		if err := pq.Pluck(parent.PrimaryKey[0], &visible).Error; err != nil {
			return common.FailErr(c, err)
		}
		ids = visible
		if len(ids) == 0 {
			return common.Success(c, http.StatusOK, out)
		}
	}
	var rows []map[string]any
	if err := config.DB.WithContext(ctx).Table(t.Name).Select(columnList(t)).Where(t.Parent.Column+" IN ?", ids).Order(t.PrimaryKey[0]).Find(&rows).Error; err != nil {
		return common.FailErr(c, err)
	}
	out.Rows = plain(rows)
	return common.Success(c, http.StatusOK, out)
}

// SyncTableIDs returns the primary keys of the rows this caller can see in a table. A PC drops what it holds beyond that:
// a row deleted on the server, or moved out of this caller's branch, cannot be found by a "changed since" request.
func SyncTableIDs(c echo.Context) error {
	ctx := auth.RequestContext(c)
	t := mirror.ByName(c.Param("name"))
	if t == nil || t.Mode == "child" {
		return common.Fail(c, http.StatusNotFound, "table not found")
	}
	if !mayView(c, t) {
		return common.Fail(c, http.StatusForbidden, "you do not have permission to view this table")
	}
	q := config.DB.WithContext(ctx).Table(t.Name)
	if sql, args := visibleFilter(t, mirrorBranchScope(c)); sql != "" {
		q = q.Where(sql, args...)
	}
	if t.HasDeletedAt {
		q = q.Where("deleted_at IS NULL")
	}
	ids := []int64{}
	if err := q.Pluck(t.PrimaryKey[0], &ids).Error; err != nil {
		return common.FailErr(c, err)
	}
	return common.Success(c, http.StatusOK, map[string]any{"ids": ids})
}
