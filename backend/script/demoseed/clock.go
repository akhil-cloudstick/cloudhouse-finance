package demoseed

import "time"

// clock is the seeder's only source of "now".
//
// time.Now() is called exactly once, in Reset, and every date in the dataset
// is derived from the result. Two reasons, both learned the hard way in
// seeders like this one:
//
//  1. A seeder that calls time.Now() in each of twenty files can straddle
//     midnight. A loan created at 23:59:59.9 and a payment "the same day" at
//     00:00:00.1 land on different dates, and the run that produced them is
//     not reproducible.
//  2. Every demo-relevant question is relative — is this loan due soon, is it
//     overdue, is that auction scheduled. Anchoring on one instant makes those
//     answers exact rather than approximately right.
//
// Services still call time.Now() internally for CreatedAt, which is correct
// and wanted: the rows really were written now.
type clock struct {
	// today is midday local, not midnight. Midnight is a hazard: a due date
	// stored at 00:00:00 and compared with >= against a "today" that is
	// really 00:00:00.000001 flips the answer, and daylight-saving shifts can
	// move a midnight timestamp across a date boundary. Midday is 12 hours
	// from either edge, so no comparison in the app can straddle a day.
	today time.Time
}

func newClock(now time.Time) clock {
	y, m, d := now.Date()
	return clock{today: time.Date(y, m, d, 12, 0, 0, 0, now.Location())}
}

// daysAgo returns n whole days before today. n may be negative.
func (c clock) daysAgo(n int) time.Time { return c.today.AddDate(0, 0, -n) }

// daysAhead returns n whole days after today.
func (c clock) daysAhead(n int) time.Time { return c.today.AddDate(0, 0, n) }

// monthsAgo returns n calendar months before today. Uses AddDate, so it
// carries Go's normalisation: 31 March minus one month is 3 March, not
// 28 February. That is fine for demo data and matters nowhere here.
func (c clock) monthsAgo(n int) time.Time { return c.today.AddDate(0, -n, 0) }

// monthsAhead returns n calendar months after today.
func (c clock) monthsAhead(n int) time.Time { return c.today.AddDate(0, n, 0) }
