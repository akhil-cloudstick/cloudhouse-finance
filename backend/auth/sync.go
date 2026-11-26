package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	headerClientUUID = "X-Client-Uuid"
	headerOccurredAt = "X-Occurred-At"
	headerDuplicate  = "X-Sync-Duplicate"
	uuidPrefix       = "uuid:"
	// a claim with no reply this old belongs to a request that died mid-way, so it may be taken again
	staleClaim = 2 * time.Minute
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// uuidTables maps the part of a route, or the name of a body field, that refers to a record onto the table
// that holds it, so an offline entry can point at a loan or customer that has no number yet.
var uuidTables = map[string]string{
	"loans":     "loans",
	"customers": "customers",
	"schemes":   "schemes",
}

// uuidBodyFields are the body fields that may carry a "uuid:<uuid>" reference.
var uuidBodyFields = map[string]string{
	"loan_id":     "loans",
	"customer_id": "customers",
	"scheme_id":   "schemes",
}

// SyncEntry lets the exe replay offline entries over the app's normal requests. A request carrying
// X-Client-Uuid is run once: the first reply is stored and any resend gets it back. Path params and body
// ids written as "uuid:<uuid>" are swapped for the numeric id before the handler sees them, so every
// existing route can be addressed by UUID with no handler change.
func SyncEntry() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			raw := strings.TrimSpace(c.Request().Header.Get(headerClientUUID))
			isEntry := raw != "" && c.Request().Method != http.MethodGet
			if isEntry && !uuidPattern.MatchString(raw) {
				return failAbort(c, http.StatusBadRequest, "invalid "+headerClientUUID)
			}
			// the PC signed the body exactly as it sent it, so it is checked before any uuid reference is rewritten
			if isEntry {
				if err := verifyDevice(c); err != nil {
					return deviceFailure(c, err)
				}
			}
			if err := resolveUUIDRefs(c); err != nil {
				return failAbort(c, http.StatusServiceUnavailable, "a record this entry points at has not reached the server yet")
			}
			if !isEntry {
				return next(c)
			}
			clientUUID := strings.ToLower(raw)
			ctx := RequestContext(c)
			entry := config.SyncEntry{ClientUUID: clientUUID, OccurredAt: time.Now()}
			if at, err := time.Parse(time.RFC3339, c.Request().Header.Get(headerOccurredAt)); err == nil && !at.After(time.Now().Add(5*time.Minute)) {
				entry.OccurredAt = at
			}
			receipt, claimed, err := claimReceipt(ctx, clientUUID, c.Request().Method, c.Request().URL.Path)
			if err != nil {
				log.Printf("sync receipt for %s: %v", clientUUID, err)
				return failAbort(c, http.StatusServiceUnavailable, "the service is busy — please try again in a moment")
			}
			if !claimed {
				if receipt.CompletedAt == nil {
					return failAbort(c, http.StatusConflict, "this entry is still being processed")
				}
				c.Response().Header().Set(headerDuplicate, "true")
				return c.Blob(receipt.Status, echo.MIMEApplicationJSON, []byte(receipt.Response))
			}
			c.SetRequest(c.Request().WithContext(config.WithSyncEntry(c.Request().Context(), entry)))
			rec := &recorder{ResponseWriter: c.Response().Writer}
			c.Response().Writer = rec
			err = next(c)
			status := c.Response().Status
			if err != nil {
				// the handler's error is written by the error handler after this returns; read its status from the error
				var he *echo.HTTPError
				if errors.As(err, &he) {
					status = he.Code
				}
			}
			if err == nil && status >= 200 && status < 300 {
				completeReceipt(ctx, clientUUID, status, rec.body.String())
			} else {
				// not saved: free the claim so the next attempt runs the action
				releaseReceipt(ctx, clientUUID)
			}
			return err
		}
	}
}

// recorder keeps a copy of the reply so a resend of the same entry can be answered with it.
type recorder struct {
	http.ResponseWriter
	body bytes.Buffer
}

func (r *recorder) Write(b []byte) (int, error) {
	r.body.Write(b)
	return r.ResponseWriter.Write(b)
}

func claimReceipt(ctx context.Context, clientUUID, method, path string) (*commonModels.SyncReceipt, bool, error) {
	row := commonModels.SyncReceipt{ClientUUID: clientUUID, Method: method, Path: truncate(path, 255), ClaimedAt: time.Now()}
	res := config.DB.WithContext(ctx).Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
	if res.Error != nil {
		return nil, false, res.Error
	}
	if res.RowsAffected == 1 {
		return &row, true, nil
	}
	var existing commonModels.SyncReceipt
	if err := config.DB.WithContext(ctx).Where("client_uuid = ?", clientUUID).First(&existing).Error; err != nil {
		return nil, false, err
	}
	if existing.CompletedAt == nil && time.Since(existing.ClaimedAt) > staleClaim {
		// the earlier attempt died before it answered: take the claim over
		took := config.DB.WithContext(ctx).Model(&commonModels.SyncReceipt{}).
			Where("client_uuid = ? AND completed_at IS NULL AND claimed_at = ?", clientUUID, existing.ClaimedAt).
			Update("claimed_at", time.Now())
		if took.Error != nil {
			return nil, false, took.Error
		}
		if took.RowsAffected == 1 {
			return &existing, true, nil
		}
	}
	return &existing, false, nil
}

func completeReceipt(ctx context.Context, clientUUID string, status int, body string) {
	now := time.Now()
	err := config.DB.WithContext(ctx).Model(&commonModels.SyncReceipt{}).Where("client_uuid = ?", clientUUID).
		Updates(map[string]any{"status": status, "response": body, "completed_at": now}).Error
	if err != nil {
		log.Printf("completing sync receipt %s: %v", clientUUID, err)
	}
}

func releaseReceipt(ctx context.Context, clientUUID string) {
	err := config.DB.WithContext(ctx).Where("client_uuid = ? AND completed_at IS NULL", clientUUID).Delete(&commonModels.SyncReceipt{}).Error
	if err != nil {
		log.Printf("releasing sync receipt %s: %v", clientUUID, err)
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// resolveUUIDRefs rewrites "uuid:<uuid>" references to numeric ids, in route params and in the JSON body.
func resolveUUIDRefs(c echo.Context) error {
	ctx := RequestContext(c)
	names := c.ParamNames()
	values := c.ParamValues()
	changed := false
	for i, name := range names {
		if i >= len(values) || !strings.HasPrefix(values[i], uuidPrefix) {
			continue
		}
		table := tableForParam(c.Path(), name)
		id, err := lookupID(ctx, table, strings.TrimPrefix(values[i], uuidPrefix))
		if err != nil {
			return err
		}
		values[i] = id
		changed = true
	}
	if changed {
		c.SetParamValues(values...)
	}
	return resolveBodyRefs(c)
}

// tableForParam picks the table a route param points at from the segment just before it in the route.
func tableForParam(routePath, param string) string {
	segs := strings.Split(strings.Trim(routePath, "/"), "/")
	for i, s := range segs {
		if s == ":"+param && i > 0 {
			return uuidTables[segs[i-1]]
		}
	}
	return ""
}

func resolveBodyRefs(c echo.Context) error {
	req := c.Request()
	if req.Body == nil || req.Body == http.NoBody || !strings.Contains(req.Header.Get(echo.HeaderContentType), "json") {
		return nil
	}
	data, err := io.ReadAll(req.Body)
	_ = req.Body.Close()
	if err != nil {
		return err
	}
	restore := func(b []byte) {
		req.Body = io.NopCloser(bytes.NewReader(b))
		req.ContentLength = int64(len(b))
	}
	restore(data)
	if !bytes.Contains(data, []byte(`"`+uuidPrefix)) {
		return nil
	}
	var doc map[string]any
	if json.Unmarshal(data, &doc) != nil {
		return nil
	}
	ctx := RequestContext(c)
	changed := false
	for key, table := range uuidBodyFields {
		s, ok := doc[key].(string)
		if !ok || !strings.HasPrefix(s, uuidPrefix) {
			continue
		}
		id, err := lookupID(ctx, table, strings.TrimPrefix(s, uuidPrefix))
		if err != nil {
			return err
		}
		doc[key] = json.Number(id)
		changed = true
	}
	if !changed {
		return nil
	}
	out, err := json.Marshal(doc)
	if err != nil {
		return err
	}
	restore(out)
	return nil
}

func lookupID(ctx context.Context, table, uuid string) (string, error) {
	if table == "" || !uuidPattern.MatchString(uuid) {
		return "", gorm.ErrRecordNotFound
	}
	var id uint
	err := config.DB.WithContext(ctx).Table(table).Select("id").Where("uuid = ?", strings.ToLower(uuid)).Limit(1).Scan(&id).Error
	if err != nil {
		return "", err
	}
	if id == 0 {
		return "", gorm.ErrRecordNotFound
	}
	return strconv.FormatUint(uint64(id), 10), nil
}
