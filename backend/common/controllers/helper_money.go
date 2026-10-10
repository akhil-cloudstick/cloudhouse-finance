package controllers

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"math"
	"time"
)

func RoundMoney(f float64) float64 {
	if math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return math.Round(f*100) / 100
}

func ValidateSplit(cash, upi, bank, cheque, total float64) error {
	sum := RoundMoney(cash + upi + bank + cheque)
	total = RoundMoney(total)
	if math.Abs(sum-total) > 0.01 {
		return NewBadRequest(fmt.Sprintf(
			"payment breakdown (%.2f) does not match the amount (%.2f)", sum, total))
	}
	return nil
}

func NormalizeSplit(cash, upi, bank, cheque, total float64, bankID *uint) (float64, float64, float64, float64, error) {
	if RoundMoney(cash+upi+bank+cheque) == 0 {
		cash = total
	}
	if err := ValidateSplit(cash, upi, bank, cheque, total); err != nil {
		return 0, 0, 0, 0, err
	}
	if upi+bank+cheque > 0 && bankID == nil {
		return 0, 0, 0, 0, NewBadRequest("bank is required when the payment breakdown includes UPI, Bank Transfer, or Cheque")
	}
	return cash, upi, bank, cheque, nil
}

func DeriveMethod(cash, upi, bank, cheque float64) string {
	type component struct {
		amount float64
		name   string
	}
	components := [...]component{
		{cash, "Cash"},
		{upi, "UPI"},
		{bank, "Bank Transfer"},
		{cheque, "Cheque"},
	}
	var nonZero int
	var only string
	for _, c := range components {
		if c.amount > 0.01 {
			nonZero++
			only = c.name
		}
	}
	switch nonZero {
	case 0:
		return ""
	case 1:
		return only
	default:
		return "Split"
	}
}

func NewTransactionGroupID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "tg-fallback"
	}
	return "tg-" + hex.EncodeToString(b)
}

func ValidateOccurredOn(occurredOn, lastKnownDate, now time.Time) error {
	occurredDate := dateOnly(occurredOn)
	if occurredDate.After(dateOnly(now)) {
		return NewBadRequest(fmt.Sprintf(
			"date (%s) cannot be in the future", occurredOn.Format("2006-01-02")))
	}
	if !lastKnownDate.IsZero() && occurredDate.Before(dateOnly(lastKnownDate)) {
		return NewBadRequest(fmt.Sprintf(
			"date (%s) is before the most recent recorded entry on this account (%s)",
			occurredOn.Format("2006-01-02"), lastKnownDate.Format("2006-01-02")))
	}
	return nil
}

func dateOnly(t time.Time) time.Time {
	y, m, d := t.Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Location())
}
