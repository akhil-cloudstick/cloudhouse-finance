package models

import (
	"cloudhouse/backend/config"
	"time"
)

type OTP struct {
	config.TenantScoped
	ID        uint      `json:"-" gorm:"primaryKey"`
	Phone     string    `json:"-" gorm:"not null;size:20;index"`
	CodeHash  string    `json:"-" gorm:"not null;size:64"`
	ExpiresAt time.Time `json:"-" gorm:"not null"`
	Attempts  int       `json:"-" gorm:"not null;default:0"`
	CreatedAt time.Time `json:"-"`
}

type DeviceToken struct {
	config.TenantScoped
	ID         uint       `json:"-" gorm:"primaryKey"`
	CustomerID uint       `json:"-" gorm:"not null;index"`
	DeviceID   string     `json:"-" gorm:"not null;size:100;index"`
	TokenHash  string     `json:"-" gorm:"not null;size:64;uniqueIndex"`
	CreatedAt  time.Time  `json:"-"`
	RevokedAt  *time.Time `json:"-"`
	LastUsedAt *time.Time `json:"-"`
}

func (OTP) TableName() string { return "customer_otp" }

func (DeviceToken) TableName() string { return "customer_device_tokens" }
