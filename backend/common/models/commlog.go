package models

import (
	"cloudhouse/backend/config"
	"time"
)

const (
	TriggerPayment      = "payment"
	TriggerAuctionEvent = "auction_event"
)

const (
	ChannelWhatsApp = "WhatsApp"
)

const (
	StatusSent   = "sent"
	StatusFailed = "failed"
)

type CommunicationLog struct {
	config.TenantScoped
	ID                    uint      `json:"id" gorm:"primaryKey"`
	RecipientName         string    `json:"recipient_name" gorm:"size:120"`
	RecipientPhone        string    `json:"recipient_phone" gorm:"size:20;index"`
	ChatID                string    `json:"chat_id" gorm:"size:32"`
	Channel               string    `json:"channel" gorm:"not null;size:20;index"`
	TriggerType           string    `json:"trigger_type" gorm:"not null;size:30;index"`
	MessageBody           string    `json:"message_body" gorm:"type:text"`
	RelatedEntityType     string    `json:"related_entity_type" gorm:"size:30;index"`
	RelatedEntityID       uint      `json:"related_entity_id" gorm:"index"`
	Status                string    `json:"status" gorm:"not null;size:10"`
	ErrorMessage          string    `json:"error_message,omitempty" gorm:"size:500"`
	TriggeredByEmployeeID *uint     `json:"triggered_by_employee_id,omitempty" gorm:"index"`
	CreatedAt             time.Time `json:"created_at" gorm:"index"`
}
