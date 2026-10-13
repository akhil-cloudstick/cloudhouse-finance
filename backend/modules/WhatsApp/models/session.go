package models

import (
	"cloudhouse/backend/config"
	"time"
)

const (
	StatusNotConnected = "not_connected"
	StatusReady        = "ready"
)

type Session struct {
	config.TenantScoped
	ID              uint      `json:"id" gorm:"primaryKey"`
	OpenWASessionID string    `json:"-" gorm:"column:openwa_session_id;not null;size:80"`
	Phone           string    `json:"phone" gorm:"not null;size:30;default:''"`
	Status          string    `json:"status" gorm:"not null;size:20;default:'created'"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

func (Session) TableName() string { return "whatsapp_sessions" }

type SessionView struct {
	Status    string `json:"status"`
	Connected bool   `json:"connected"`
	Phone     string `json:"phone"`
}

type QRView struct {
	QRCode string `json:"qr_code"`
	Status string `json:"status"`
}

type PairingView struct {
	PairingCode string `json:"pairing_code"`
	Status      string `json:"status"`
}
