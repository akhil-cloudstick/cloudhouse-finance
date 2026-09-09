package notification

import (
	"log"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"cloudhouse/backend/internal/platform"
	"cloudhouse/backend/internal/platform/httpx"
)

// Handler wires HTTP/WebSocket requests to the Service.
type Handler struct {
	svc *Service
	hub interface {
		Register(customerID uint, conn *websocket.Conn)
		Unregister(customerID uint, conn *websocket.Conn)
	}
	upgrader websocket.Upgrader
}

func NewHandler(svc *Service, hub interface {
	Register(customerID uint, conn *websocket.Conn)
	Unregister(customerID uint, conn *websocket.Conn)
}) *Handler {
	return &Handler{
		svc: svc,
		hub: hub,
		upgrader: websocket.Upgrader{
			// The customer app is a native RN client, not a browser page —
			// there is no cross-origin browser context to police here (the
			// real auth gate is CustomerAuthMiddleware running before this
			// handler, same as every other /customer/* route).
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}
}

// customerIDFromContext mirrors the same-named helper already duplicated in
// internal/loan/customer_handler.go and internal/customer/
// customer_mobile_handler.go — kept as its own copy here for the same
// reason: this package shouldn't import a sibling domain package just to
// share four lines.
func customerIDFromContext(c *gin.Context) (uint, bool) {
	v, ok := c.Get("customerId")
	if !ok {
		return 0, false
	}
	id, ok := v.(uint)
	return id, ok
}

// List backs GET /customer/notifications — paginated the same
// {items, hasMore} envelope as every other customer-scoped list route.
func (h *Handler) List(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	limit, _ := strconv.Atoi(c.Query("limit"))
	offset, _ := strconv.Atoi(c.Query("offset"))
	if offset < 0 {
		offset = 0
	}
	if limit > 0 {
		items, err := h.svc.List(ctx, customerID, limit+1, offset)
		if err != nil {
			httpx.FailErr(c, err)
			return
		}
		hasMore := len(items) > limit
		if hasMore {
			items = items[:limit]
		}
		httpx.Success(c, http.StatusOK, gin.H{"items": items, "hasMore": hasMore})
		return
	}
	items, err := h.svc.List(ctx, customerID, 0, 0)
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.Success(c, http.StatusOK, items)
}

// Ack backs POST /customer/notifications/:id/ack — the REST fallback for
// when the app fetched via List rather than receiving a live push (e.g.
// cold start, before the socket connects).
func (h *Handler) Ack(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if err := h.svc.Ack(ctx, id, customerID); err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.SuccessMessage(c, http.StatusOK, "Notification acknowledged")
}

// Read backs POST /customer/notifications/:id/read — called when the
// customer taps a notification to view its full description (see the
// customer app's notification detail modal). This is the real "read" signal;
// Delivered/Ack only ever mean "reached the device."
func (h *Handler) Read(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	id, err := httpx.IDParam(c, "id")
	if err != nil {
		httpx.FailErr(c, err)
		return
	}
	if err := h.svc.Read(ctx, id, customerID); err != nil {
		httpx.FailErr(c, err)
		return
	}
	httpx.SuccessMessage(c, http.StatusOK, "Notification marked read")
}

// inboundMessage is the only shape a client ever sends up the socket — an
// ack for a notification it just received (this IS the "client received"
// signal the Delivered flag is keyed on, per the locked decision; there is
// no separate "seen/opened" signal in this batch).
type inboundMessage struct {
	Type           string `json:"type"`
	NotificationID uint   `json:"notificationId"`
}

// Upgrade backs GET /customer/ws — the live-push channel. CustomerAuthMiddleware
// runs first (this route is registered the same way as every other
// customer group in main.go), so customerId is already on the gin context
// by the time this handler runs; gin processes the upgrade request as a
// normal HTTP request right up until Upgrade() hijacks the connection.
func (h *Handler) Upgrade(c *gin.Context) {
	ctx := platform.RequestContext(c)
	customerID, ok := customerIDFromContext(c)
	if !ok {
		httpx.Fail(c, http.StatusUnauthorized, "not authenticated")
		return
	}
	conn, err := h.upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("notification ws upgrade failed for customer %d: %v", customerID, err)
		return
	}
	defer conn.Close()

	h.hub.Register(customerID, conn)
	defer h.hub.Unregister(customerID, conn)

	// Covers "was offline, just reconnected" immediately rather than
	// waiting for the next 10-minute resend tick.
	h.svc.PushUndeliveredOnConnect(ctx, customerID)

	for {
		var msg inboundMessage
		if err := conn.ReadJSON(&msg); err != nil {
			// Connection closed or a malformed frame — either way, this
			// connection is done; Unregister runs via the deferred call
			// above.
			return
		}
		if msg.Type == "ack" && msg.NotificationID != 0 {
			if err := h.svc.Ack(ctx, msg.NotificationID, customerID); err != nil {
				log.Printf("notification ack failed (customer %d, notification %d): %v", customerID, msg.NotificationID, err)
			}
		}
	}
}
