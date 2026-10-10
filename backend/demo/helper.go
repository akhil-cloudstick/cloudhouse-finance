package demo

import (
	"time"
)

type clock struct {
	today time.Time
}

func newClock(now time.Time) clock {
	y, m, d := now.Date()
	return clock{today: time.Date(y, m, d, 12, 0, 0, 0, now.Location())}
}

func (c clock) daysAgo(n int) time.Time { return c.today.AddDate(0, 0, -n) }

func (c clock) daysAhead(n int) time.Time { return c.today.AddDate(0, 0, n) }

func (c clock) monthsAgo(n int) time.Time { return c.today.AddDate(0, -n, 0) }

func (c clock) monthsAhead(n int) time.Time { return c.today.AddDate(0, n, 0) }
