package controllers

import (
	"cloudhouse/backend/auth"
	commonModels "cloudhouse/backend/common/models"
	"cloudhouse/backend/config"
	"context"
	"log"
	"net/http"
	"time"

	"github.com/labstack/echo/v4"
	"gorm.io/gorm"
)

type inboundMessage struct {
	Type           string `json:"type"`
	NotificationID uint   `json:"notification_id"`
}

type wireMessage struct {
	Type              string `json:"type"`
	ID                uint   `json:"id"`
	NotifType         string `json:"notif_type"`
	Title             string `json:"title"`
	Body              string `json:"body"`
	RelatedEntityType string `json:"related_entity_type"`
	RelatedEntityID   uint   `json:"related_entity_id"`
	CreatedAt         string `json:"created_at"`
}

func InsertNotification(ctx context.Context, n *commonModels.Notification) error {
	return config.DB.
		WithContext(ctx).Create(n).Error
}

func findNotificationByID(ctx context.Context, id uint) (*commonModels.Notification, error) {
	var n commonModels.Notification
	if err := config.DB.
		WithContext(ctx).First(&n, id).Error; err != nil {
		return nil, err
	}
	return &n, nil
}

func findByCustomerID(ctx context.Context, customerID uint, limit, offset int) ([]commonModels.Notification, error) {
	var items []commonModels.Notification
	q := config.DB.
		WithContext(ctx).Where("customer_id = ?", customerID).Order("created_at desc")
	if limit > 0 {
		q = q.Limit(limit).Offset(offset)
	}
	err := q.Find(&items).Error
	return items, err
}

func findPendingResend(ctx context.Context, maxAttempts int) ([]commonModels.Notification, error) {
	var items []commonModels.Notification
	err := config.DB.
		WithContext(ctx).Where("delivered = ? AND attempts < ?", false, maxAttempts).Order("created_at asc").Find(&items).Error
	return items, err
}

func markDelivered(ctx context.Context, id uint) error {
	now := time.Now()
	return config.DB.
		WithContext(ctx).Model(&commonModels.Notification{}).Where("id = ?", id).Updates(map[string]any{
		"delivered":    true,
		"delivered_at": now,
	}).Error
}

func markRead(ctx context.Context, id uint) error {
	now := time.Now()
	return config.DB.
		WithContext(ctx).Model(&commonModels.Notification{}).Where("id = ?", id).Updates(map[string]any{
		"read":    true,
		"read_at": now,
	}).Error
}

func incrementAttempt(ctx context.Context, id uint) error {
	now := time.Now()
	return config.DB.
		WithContext(ctx).Model(&commonModels.Notification{}).Where("id = ?", id).Updates(map[string]any{
		"attempts":        gorm.Expr("attempts + 1"),
		"last_attempt_at": now,
	}).Error
}

func toWireMessage(n *commonModels.Notification) wireMessage {
	return wireMessage{
		Type:              "notification",
		ID:                n.ID,
		NotifType:         n.Type,
		Title:             n.Title,
		Body:              n.Body,
		RelatedEntityType: n.RelatedEntityType,
		RelatedEntityID:   n.RelatedEntityID,
		CreatedAt:         n.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func NotifyCustomer(ctx context.Context, customerID uint, notifType, title, body, relatedEntityType string, relatedEntityID uint) {
	n := &commonModels.Notification{
		CustomerID:        customerID,
		Type:              notifType,
		Title:             title,
		Body:              body,
		RelatedEntityType: relatedEntityType,
		RelatedEntityID:   relatedEntityID,
	}
	if err := InsertNotification(ctx, n); err != nil {
		return
	}
	if notificationHub.
		Push(customerID, toWireMessage(n)) {
		_ = incrementAttempt(ctx, n.ID)
	}
}

func pushUndeliveredOnConnect(ctx context.Context, customerID uint) {
	items, err := findPendingResend(ctx, 10)
	if err != nil {
		return
	}
	for i := range items {
		n := items[i]
		if n.CustomerID != customerID {
			continue
		}
		if notificationHub.
			Push(customerID, toWireMessage(&n)) {
			_ = incrementAttempt(ctx, n.ID)
		}
	}
}

func ResendPending(ctx context.Context) {
	items, err := findPendingResend(ctx, 10)
	if err != nil {
		return
	}
	for i := range items {
		n := items[i]
		if !notificationHub.
			Connected(n.CustomerID) {
			continue
		}
		if notificationHub.
			Push(n.CustomerID, toWireMessage(&n)) {
			_ = incrementAttempt(ctx, n.ID)
		}
	}
}

func ackNotification(ctx context.Context, id, customerID uint) error {
	n, err := findNotificationByID(ctx, id)
	if err != nil {
		return NewNotFound("notification not found")
	}
	if n.CustomerID != customerID {
		return NewNotFound("notification not found")
	}
	return markDelivered(ctx, id)
}

func readNotification(ctx context.Context, id, customerID uint) error {
	n, err := findNotificationByID(ctx, id)
	if err != nil {
		return NewNotFound("notification not found")
	}
	if n.CustomerID != customerID {
		return NewNotFound("notification not found")
	}
	if n.Read {
		return nil
	}
	return markRead(ctx, id)
}

func listNotifications(ctx context.Context, customerID uint, limit, offset int) ([]commonModels.Notification, error) {
	return findByCustomerID(ctx, customerID, limit, offset)
}

func notificationCustomerIDFromContext(c echo.Context) (uint, bool) {
	v, ok := Get(c, "customerId")
	if !ok {
		return 0, false
	}
	id, ok := v.(uint)
	return id, ok
}

func ListNotifications(c echo.Context) error {
	ctx := auth.RequestContext(c)
	page, limit, offset := PageParams(c)
	customerID, ok := notificationCustomerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	if limit > 0 {
		items, err := listNotifications(ctx, customerID, limit+1, offset)
		if err != nil {
			return FailErr(c, err)
		}
		hasMore := len(items) > limit
		if hasMore {
			items = items[:limit]
		}
		return SuccessList(c, page, limit, NextPages(page, hasMore), items)
	}
	items, err := listNotifications(ctx, customerID, 0, 0)
	if err != nil {
		return FailErr(c, err)
	}
	return SuccessAll(c, items)
}

func AckNotification(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, ok := notificationCustomerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	if err := ackNotification(ctx, id, customerID); err != nil {
		return FailErr(c, err)
	}
	return SuccessMessage(c, http.StatusOK, "Notification acknowledged")
}

func ReadNotification(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, ok := notificationCustomerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	id, err := IDParam(c, "id")
	if err != nil {
		return FailErr(c, err)
	}
	if err := readNotification(ctx, id, customerID); err != nil {
		return FailErr(c, err)
	}
	return SuccessMessage(c, http.StatusOK, "Notification marked read")
}

func ConnectNotificationSocket(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, ok := notificationCustomerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	conn, err := socketUpgrader.
		Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		log.Printf("notification ws upgrade failed for customer %d: %v", customerID, err)
		return nil
	}
	defer conn.Close()
	notificationHub.
		Register(customerID, conn)
	defer notificationHub.
		Unregister(customerID, conn)
	pushUndeliveredOnConnect(
		ctx, customerID)
	for {
		var msg inboundMessage
		if err := conn.ReadJSON(&msg); err != nil {
			return nil
		}
		if msg.Type == "ack" && msg.NotificationID != 0 {
			if err := ackNotification(ctx, msg.NotificationID, customerID); err != nil {
				log.Printf("notification ack failed (customer %d, notification %d): %v", customerID, msg.NotificationID, err)
			}
		}
	}
}
