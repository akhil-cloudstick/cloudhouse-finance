package controllers

import (
	"sync"

	"github.com/gorilla/websocket"
)

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

func (h *Hub) Connected(customerID uint) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.conns[customerID]) > 0
}

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
