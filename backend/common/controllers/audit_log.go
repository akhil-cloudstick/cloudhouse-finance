package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"log"
	"net/http"

	"github.com/labstack/echo/v4"
)

type AuditLogFilter struct {
	EntityType string
	Action     string
	Limit      int
	Offset     int
}

func InsertAuditLog(ctx context.Context, e *commonModels.Entry) error {
	return config.DB.
		WithContext(ctx).Create(e).Error
}

func writeAuditLog(ctx context.Context, actorEmployeeID uint, actorName, action, entityType string, entityID uint, entityName, detail string) {
	e := &commonModels.Entry{
		ActorEmployeeID: actorEmployeeID,
		ActorName:       actorName,
		Action:          action,
		EntityType:      entityType,
		EntityID:        entityID,
		EntityName:      entityName,
		Detail:          detail,
	}
	if err := InsertAuditLog(ctx, e); err != nil {
		log.Printf("auditlog: failed to record %s on %s #%d: %v", action, entityType, entityID, err)
	}
}

func findAuditLogs(ctx context.Context, f AuditLogFilter) ([]commonModels.Entry, error) {
	q := config.DB.
		WithContext(ctx).Order("created_at desc")
	if f.EntityType != "" {
		q = q.Where("entity_type = ?", f.EntityType)
	}
	if f.Action != "" {
		q = q.Where("action = ?", f.Action)
	}
	if f.Limit > 0 {
		q = q.Limit(f.Limit).Offset(f.Offset)
	}
	var out []commonModels.Entry
	err := q.Find(&out).Error
	return out, err
}

func ListAuditLogs(c echo.Context) error {
	ctx := auth.RequestContext(c)
	f := AuditLogFilter{
		EntityType: c.QueryParam("entity_type"),
		Action:     c.QueryParam("action"),
	}
	rec, err := findAuditLogs(ctx, f)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, rec)
}
