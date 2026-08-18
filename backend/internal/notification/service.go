package notification

import (
	"errors"

	"ambikagold/backend/internal/realtime"
)

var ErrNotFound = errors.New("notification not found")

// maxResendAttempts is the cap on live-push resend attempts before the
// ticker gives up on a notification — it stays queryable via List forever,
// just stops being retried. Locked in at 10 per the user's decision.
const maxResendAttempts = 10

// wireMessage is the exact shape pushed down the socket and returned by the
// REST list endpoint's items — see documents/api_documentation.md's
// "Customer App Notifications API" section for the wire contract.
type wireMessage struct {
	Type              string `json:"type"` // always "notification" for a push; distinguishes it from other future socket message kinds
	ID                uint   `json:"id"`
	NotifType         string `json:"notifType"`
	Title             string `json:"title"`
	Body              string `json:"body"`
	RelatedEntityType string `json:"relatedEntityType"`
	RelatedEntityID   uint   `json:"relatedEntityId"`
	CreatedAt         string `json:"createdAt"`
}

// Service ties the durable Notification store to the realtime Hub. It
// implements loan.CustomerNotifier (see internal/loan/service.go) so
// internal/loan can fire notifications without importing this package
// directly — main.go wires the concrete *Service in.
type Service struct {
	repo *Repository
	hub  *realtime.Hub
}

func NewService(repo *Repository, hub *realtime.Hub) *Service {
	return &Service{repo: repo, hub: hub}
}

func toWireMessage(n *Notification) wireMessage {
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

// Notify writes a new Notification row and attempts an immediate live push
// if the customer has a connection open right now. A push failure (or the
// customer simply being offline) is not an error — ResendPending's ticker
// covers it from here. Matches the loan.CustomerNotifier interface exactly.
func (s *Service) Notify(customerID uint, notifType, title, body, relatedEntityType string, relatedEntityID uint) {
	n := &Notification{
		CustomerID:        customerID,
		Type:              notifType,
		Title:             title,
		Body:              body,
		RelatedEntityType: relatedEntityType,
		RelatedEntityID:   relatedEntityID,
	}
	if err := s.repo.Create(n); err != nil {
		return // logged by the caller's own log-and-continue posture (notifyCustomer never hard-fails the operation it's attached to)
	}
	if s.hub.Push(customerID, toWireMessage(n)) {
		_ = s.repo.IncrementAttempt(n.ID)
	}
}

// PushUndeliveredOnConnect is called by the WS upgrade handler right after
// a customer's connection is registered — covers "was offline, reconnected"
// without waiting for the next resend tick.
func (s *Service) PushUndeliveredOnConnect(customerID uint) {
	items, err := s.repo.FindPendingResend(maxResendAttempts)
	if err != nil {
		return
	}
	for i := range items {
		n := items[i]
		if n.CustomerID != customerID {
			continue
		}
		if s.hub.Push(customerID, toWireMessage(&n)) {
			_ = s.repo.IncrementAttempt(n.ID)
		}
	}
}

// ResendPending is called by main.go's 10-minute ticker: re-pushes every
// undelivered, not-yet-exhausted notification to any customer who currently
// has a live connection. Customers with no connection are skipped entirely
// (no point attempting, and Attempts must only count real push attempts,
// not idle ticks) — they'll get PushUndeliveredOnConnect's backfill the
// next time they do connect, and the row stays queryable via List either way.
func (s *Service) ResendPending() {
	items, err := s.repo.FindPendingResend(maxResendAttempts)
	if err != nil {
		return
	}
	for i := range items {
		n := items[i]
		if !s.hub.Connected(n.CustomerID) {
			continue
		}
		if s.hub.Push(n.CustomerID, toWireMessage(&n)) {
			_ = s.repo.IncrementAttempt(n.ID)
		}
	}
}

// Ack marks a notification delivered — ownership-checked (404 on mismatch,
// same convention as every other customer-scoped route in this codebase),
// callable either from the socket's inbound {"type":"ack",...} message or
// the REST fallback endpoint.
func (s *Service) Ack(id, customerID uint) error {
	n, err := s.repo.FindByID(id)
	if err != nil {
		return ErrNotFound
	}
	if n.CustomerID != customerID {
		return ErrNotFound
	}
	return s.repo.MarkDelivered(id)
}

// List backs GET /customer/notifications — the bell list's cold-start
// backfill and general history view.
func (s *Service) List(customerID uint, limit, offset int) ([]Notification, error) {
	return s.repo.FindByCustomerID(customerID, limit, offset)
}
