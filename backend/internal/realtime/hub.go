// Package realtime is a small, generic WebSocket connection registry — it
// knows nothing about notifications specifically (that lives in
// internal/notification/ws_handler.go), just "which connections belong to
// which customer" and "push this payload to all of them." Kept generic so
// nothing else that might later want a live push to a customer's device
// needs to duplicate connection bookkeeping.
package realtime

import (
	"sync"

	"github.com/gorilla/websocket"
)

// Hub tracks live WebSocket connections per customer. A customer may have
// more than one open connection (multiple devices) — Push fans out to all
// of them, and any one of them acking is enough to mark a notification
// delivered.
type Hub struct {
	mu    sync.Mutex
	conns map[uint][]*websocket.Conn
}

func NewHub() *Hub {
	return &Hub{conns: make(map[uint][]*websocket.Conn)}
}

func (h *Hub) Register(customerID uint, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.conns[customerID] = append(h.conns[customerID], conn)
}

func (h *Hub) Unregister(customerID uint, conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	list := h.conns[customerID]
	for i, c := range list {
		if c == conn {
			h.conns[customerID] = append(list[:i], list[i+1:]...)
			break
		}
	}
	if len(h.conns[customerID]) == 0 {
		delete(h.conns, customerID)
	}
}

// Connected reports whether the customer has at least one live connection —
// used by the resend ticker to skip customers who are definitely offline
// right now rather than attempting (and failing) a write.
func (h *Hub) Connected(customerID uint) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.conns[customerID]) > 0
}

// Push sends payload (JSON-marshaled by the caller via conn.WriteJSON) to
// every live connection for customerID. Returns true if it was written to
// at least one connection — write failures on an individual connection are
// treated as that connection being dead (best-effort fan-out; the read loop
// on that connection will independently notice the same failure and
// Unregister it).
func (h *Hub) Push(customerID uint, payload any) bool {
	h.mu.Lock()
	conns := append([]*websocket.Conn(nil), h.conns[customerID]...)
	h.mu.Unlock()

	sent := false
	for _, c := range conns {
		if err := c.WriteJSON(payload); err == nil {
			sent = true
		}
	}
	return sent
}
