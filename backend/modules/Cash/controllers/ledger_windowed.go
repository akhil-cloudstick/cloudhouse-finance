package controllers

import (
	common "cloudhouse/backend/common/controllers"
	"cloudhouse/backend/config"
	"context"
	"fmt"
	"strings"
	"sync"
	"time"
)

// A ledger's rows are built in Go from several tables (cash lines, loan payments
// split into interest/principal, personal-loan payments, gold sales). Loading a
// business's whole history at once is hundreds of thousands of rows, so a
// ledger is read in date windows, newest first (see ledgerWindows): only one
// window's rows and the requested page are ever held in memory. Rows are ordered by date
// and a window never splits a day, so the order, running balances and totals are
// exactly what sorting every row at once gives.

// ledgerFloor is the earliest date a ledger without a from-date reaches back to.
var ledgerFloor = time.Date(1990, 1, 1, 0, 0, 0, 0, time.UTC)

// ledgerExportMaxRows caps a PDF export (limit 0 = every row) so it can't build
// a document of the whole history in memory.
const ledgerExportMaxRows = 20000

type ledgerWindow struct{ from, to time.Time } // inclusive days; zero to = no upper bound

// ledgerOlderWindowYears is the span of each window after the newest year: the
// newest year (where paging happens) is read on its own, older history in a few
// larger blocks so a whole-history ledger costs a handful of queries.
const ledgerOlderWindowYears = 5

// ledgerWindows splits [from, to] into windows, newest first: the newest
// calendar year, then blocks of ledgerOlderWindowYears calendar years.
func ledgerWindows(from, to time.Time) []ledgerWindow {
	unbounded := from.IsZero()
	if unbounded {
		from = ledgerFloor
	}
	from = time.Date(from.Year(), from.Month(), from.Day(), 0, 0, 0, 0, from.Location())
	top := to
	if top.IsZero() {
		top = time.Now()
	}
	var out []ledgerWindow
	start := time.Date(top.Year(), 1, 1, 0, 0, 0, 0, from.Location())
	end := to
	for {
		w := ledgerWindow{from: start, to: end}
		if !start.After(from) {
			w.from = from
			if unbounded {
				w.from = time.Time{} // the oldest window reaches back without limit
			}
			out = append(out, w)
			return out
		}
		out = append(out, w)
		end = start.AddDate(0, 0, -1)
		start = start.AddDate(-ledgerOlderWindowYears, 0, 0)
	}
}

func signedLedgerAmount(r ledgerSourceRow) float64 {
	if r.Memo {
		return 0
	}
	if toLedgerRow(r).DebitOrCredit == "debit" {
		return -r.Amount
	}
	return r.Amount
}

// focusMatches is focusRowIndex split in two: the first row on the focus date
// with the focus amount, and the first row with the amount on any date.
func focusMatches(rows []ledgerSourceRow, f ledgerFocus) (exact, fallback int) {
	// Prefer the rows of the loan the user came from; only when none of them matches fall back to any loan's.
	if f.loan != "" && f.ref == "" && f.paymentID == 0 {
		if e, fb := focusMatchesIn(rows, f, true); e >= 0 || fb >= 0 {
			return e, fb
		}
	}
	return focusMatchesIn(rows, f, false)
}

// focusLoanOf is the loan a row belongs to, for a focus that came from a loan page. A gold-loan cash line
// (disbursal, service charge, top-up) has no LoanNumber — that field is only filled from loan_cash_sources —
// and names its loan only in its purpose, which refOrPurpose already turned into the row's Reference.
func focusLoanOf(r ledgerSourceRow) string {
	if r.LoanNumber != "" {
		return r.LoanNumber
	}
	if r.Kind == "cash_movement" {
		return r.Reference
	}
	return ""
}

func focusMatchesIn(rows []ledgerSourceRow, f ledgerFocus, onlyLoan bool) (exact, fallback int) {
	exact, fallback = -1, -1
	same := func(a float64) bool { return a-f.amount < 0.005 && f.amount-a < 0.005 }
	for i, r := range rows {
		if f.ref != "" {
			// Unique identity: only that entry's own rows (its same-amount split row first).
			if !f.matchesRef(r) {
				continue
			}
			if exact < 0 && same(r.Amount) {
				exact = i
			}
			if fallback < 0 {
				fallback = i
			}
			continue
		}
		if f.paymentID > 0 {
			// Exact id: that payment's own row (its same-amount split row first), nothing else.
			if r.Memo || !f.matchesPayment(r) {
				continue
			}
			if exact < 0 && same(r.Amount) {
				exact = i
			}
			if fallback < 0 {
				fallback = i
			}
			continue
		}
		if r.Memo || !same(r.Amount) {
			continue
		}
		if onlyLoan && !strings.EqualFold(focusLoanOf(r), f.loan) {
			continue
		}
		if exact < 0 && f.date != "" && r.Date.Format("2006-01-02") == f.date {
			exact = i
		}
		if fallback < 0 {
			fallback = i
		}
	}
	return exact, fallback
}

// paginateLedgerWindowed returns the same page, total and totals as fetching
// every row from fromDate to toDate and calling paginateLedgerRowsFrom with the
// opening balance of everything before fromDate.
func paginateLedgerWindowed(ctx context.Context, fetch func(from, to time.Time) ([]ledgerSourceRow, error), keep func([]ledgerSourceRow) []ledgerSourceRow, fromDate, toDate time.Time, limit, offset int) ([]LedgerRow, int64, LedgerTotals, error) {
	return paginateLedgerWindowedCached(ctx, "", nil, fetch, keep, fromDate, toDate, limit, offset)
}

// windowAgg is what a window adds to a ledger: its row count, debit and credit
// totals and net (memo rows count as rows but carry no amount).
type windowAgg struct {
	count         int
	debit, credit float64
	net           float64
}

func aggregateLedgerRows(rows []ledgerSourceRow) windowAgg {
	a := windowAgg{count: len(rows)}
	for _, r := range rows {
		if r.Memo {
			continue
		}
		if toLedgerRow(r).DebitOrCredit == "debit" {
			a.debit += r.Amount
		} else {
			a.credit += r.Amount
		}
		a.net += signedLedgerAmount(r)
	}
	return a
}

// ledgerFingerprint summarises every source row dated before `before`; while it
// is unchanged, the cached aggregates of windows ending before then still hold.
type ledgerFingerprint func(ctx context.Context, before time.Time) (string, error)

// The aggregates of closed windows (ending before the current year) of the big
// ledgers, so paging through a long history doesn't rebuild every past year's
// rows on each request. Keyed by tenant + ledger filters; dropped whenever the
// fingerprint of the past rows changes (any backdated insert, edit or delete).
type ledgerCacheEntry struct {
	fingerprint string
	windows     map[ledgerWindow]windowAgg
	used        time.Time
}

const ledgerCacheMaxEntries = 200

var ledgerSumCache = struct {
	sync.Mutex
	m map[string]*ledgerCacheEntry
}{m: map[string]*ledgerCacheEntry{}}

// ledgerCacheFor returns the cache entry for key, emptied if fp differs.
func ledgerCacheFor(key, fp string) *ledgerCacheEntry {
	ledgerSumCache.Lock()
	defer ledgerSumCache.Unlock()
	e := ledgerSumCache.m[key]
	if e == nil || e.fingerprint != fp {
		if e == nil && len(ledgerSumCache.m) >= ledgerCacheMaxEntries {
			var oldest string
			for k, v := range ledgerSumCache.m {
				if oldest == "" || v.used.Before(ledgerSumCache.m[oldest].used) {
					oldest = k
				}
			}
			delete(ledgerSumCache.m, oldest)
		}
		e = &ledgerCacheEntry{fingerprint: fp, windows: map[ledgerWindow]windowAgg{}}
		ledgerSumCache.m[key] = e
	}
	e.used = time.Now()
	return e
}

func (e *ledgerCacheEntry) get(w ledgerWindow) (windowAgg, bool) {
	ledgerSumCache.Lock()
	defer ledgerSumCache.Unlock()
	a, ok := e.windows[w]
	return a, ok
}

func (e *ledgerCacheEntry) put(w ledgerWindow, a windowAgg) {
	ledgerSumCache.Lock()
	defer ledgerSumCache.Unlock()
	e.windows[w] = a
}

// paginateLedgerWindowedCached is paginateLedgerWindowed whose closed windows'
// aggregates are cached under cacheKey (no cache when cacheKey or fp is empty).
func paginateLedgerWindowedCached(ctx context.Context, cacheKey string, fp ledgerFingerprint, fetch func(from, to time.Time) ([]ledgerSourceRow, error), keep func([]ledgerSourceRow) []ledgerSourceRow, fromDate, toDate time.Time, limit, offset int) ([]LedgerRow, int64, LedgerTotals, error) {
	load := func(w ledgerWindow) ([]ledgerSourceRow, error) {
		rows, err := fetch(w.from, w.to)
		if err != nil {
			return nil, err
		}
		if keep != nil {
			rows = keep(rows)
		}
		sortLedgerSourceRows(rows)
		return rows, nil
	}
	focus, hasFocus := ctx.Value(ledgerFocusKey{}).(ledgerFocus)
	hasFocus = hasFocus && limit > 0

	now := time.Now()
	closedBefore := time.Date(now.Year(), 1, 1, 0, 0, 0, 0, time.UTC)
	var cache *ledgerCacheEntry
	if cacheKey != "" && fp != nil {
		f, err := fp(ctx, closedBefore)
		if err != nil {
			return nil, 0, LedgerTotals{}, err
		}
		cache = ledgerCacheFor(cacheKey, f)
	}
	// The open (current-year) window is never cached; when the cache is on, its
	// rows are kept from the totals pass so the page pass doesn't read it again.
	openRows := map[ledgerWindow][]ledgerSourceRow{}
	agg := func(w ledgerWindow) (windowAgg, error) {
		cacheable := cache != nil && !w.to.IsZero() && w.to.Before(closedBefore)
		if cacheable {
			if a, ok := cache.get(w); ok {
				return a, nil
			}
		}
		rows, err := load(w)
		if err != nil {
			return windowAgg{}, err
		}
		a := aggregateLedgerRows(rows)
		if cacheable {
			cache.put(w, a)
		} else if cache != nil {
			openRows[w] = rows
		}
		return a, nil
	}

	opening := 0.0
	if !fromDate.IsZero() {
		for _, w := range ledgerWindows(time.Time{}, fromDate.AddDate(0, 0, -1)) {
			a, err := agg(w)
			if err != nil {
				return nil, 0, LedgerTotals{}, err
			}
			opening += a.net
		}
	}

	// Pass 1: count, totals and each window's size and net (a focus search needs
	// the rows themselves, so it reads every window).
	windows := ledgerWindows(fromDate, toDate)
	sums := make([]windowAgg, len(windows))
	var total int64
	var totals LedgerTotals
	netRange := 0.0
	focusExact, focusFallback := -1, -1
	for i, w := range windows {
		if hasFocus && focusExact < 0 {
			rows, err := load(w)
			if err != nil {
				return nil, 0, LedgerTotals{}, err
			}
			if ex, fb := focusMatches(rows, focus); ex >= 0 {
				focusExact = int(total) + ex
			} else if fb >= 0 && focusFallback < 0 {
				focusFallback = int(total) + fb
			}
			sums[i] = aggregateLedgerRows(rows)
		} else {
			a, err := agg(w)
			if err != nil {
				return nil, 0, LedgerTotals{}, err
			}
			sums[i] = a
		}
		totals.TotalDebit += sums[i].debit
		totals.TotalCredit += sums[i].credit
		netRange += sums[i].net
		total += int64(sums[i].count)
	}
	closing := opening + netRange

	if limit <= 0 && total > ledgerExportMaxRows {
		return nil, 0, LedgerTotals{}, common.NewBadRequest(fmt.Sprintf("this ledger has %d entries in the chosen period — choose a shorter date range (at most %d entries per export)", total, ledgerExportMaxRows))
	}
	if offset < 0 {
		offset = 0
	}
	if focusIdx := focusExact; hasFocus && (focusIdx >= 0 || focusFallback >= 0) {
		if focusIdx < 0 {
			focusIdx = focusFallback
		}
		offset = (focusIdx / limit) * limit
		totals.FocusPage = focusIdx/limit + 1
	}
	if int64(offset) > total {
		offset = int(total)
	}
	end := int(total)
	if limit > 0 && offset+limit < end {
		end = offset + limit
	}

	// Pass 2: collect the page. A row's running balance is the closing balance
	// less the net of every newer row.
	var page []ledgerSourceRow
	var balances []float64
	idx := 0
	newerNet := 0.0
	for i, w := range windows {
		if idx >= end {
			break
		}
		if idx+sums[i].count <= offset {
			idx += sums[i].count
			newerNet += sums[i].net
			continue
		}
		rows, ok := openRows[w]
		if !ok {
			var err error
			if rows, err = load(w); err != nil {
				return nil, 0, LedgerTotals{}, err
			}
		}
		for _, r := range rows {
			if idx >= offset && idx < end {
				page = append(page, r)
				balances = append(balances, closing-newerNet)
			}
			newerNet += signedLedgerAmount(r)
			idx++
		}
	}

	out := make([]LedgerRow, len(page))
	for i, r := range page {
		out[i] = toLedgerRow(r)
		out[i].RunningBalance = balances[i]
	}
	if err := attachReceipts(ctx, page, out); err != nil {
		return nil, 0, LedgerTotals{}, err
	}
	if err := attachEntryMeta(ctx, page, out); err != nil {
		return nil, 0, LedgerTotals{}, err
	}
	return out, total, totals, nil
}

// modeLedgerFingerprint summarises every row a mode ledger is built from
// (cash lines, loan and personal-loan payments, gold sales) dated before
// `before`: counts and sums of the ids, amounts, mode splits, bank / expense /
// loan ids and dates, plus a hash of the short type and mode strings, so any
// insert, delete or edit that could move a row's total, side or type changes it.
// Numeric sums keep it cheap on a long history.
func modeLedgerFingerprint(ctx context.Context, before time.Time) (string, error) {
	sources := []struct{ table, date, sums, hash string }{
		{"cash_movements", "occurred_on",
			"SUM(amount), SUM(COALESCE(bank_id,0)), SUM(COALESCE(to_bank_id,0)), SUM(COALESCE(expense_id,0)), SUM(COALESCE(branch_id,0)), SUM(EXTRACT(EPOCH FROM occurred_on))",
			"type||COALESCE(mode,'')||COALESCE(source,'')||COALESCE(LEFT(purpose,24),'')"},
		{"loan_payments", "paid_on",
			"SUM(amount), SUM(cash_amount), SUM(upi_amount), SUM(bank_transfer_amount), SUM(cheque_amount), SUM(COALESCE(interest_applied,0)), SUM(COALESCE(principal_applied,0)), SUM(COALESCE(penal_interest_applied,0)), SUM(COALESCE(processing_fee_applied,0)), SUM(COALESCE(bank_id,0)), SUM(loan_id), SUM(EXTRACT(EPOCH FROM paid_on))",
			"type||COALESCE(method,'')||COALESCE(cash_transaction_group_id,'')"},
		{"personal_loan_payments", "paid_on",
			"SUM(amount), SUM(cash_amount), SUM(upi_amount), SUM(bank_transfer_amount), SUM(COALESCE(bank_id,0)), SUM(EXTRACT(EPOCH FROM paid_on))",
			"COALESCE(method,'')"},
		{"gold_sales", "sold_on",
			"SUM(sold_amount), SUM(COALESCE(bank_id,0)), SUM(EXTRACT(EPOCH FROM sold_on))",
			"COALESCE(mode,'')"},
	}
	fp := ""
	for _, s := range sources {
		var r struct{ F string }
		if err := config.DB.
			WithContext(ctx).Table(s.table).
			Select("CONCAT_WS(':', COUNT(*), SUM(id), "+s.sums+", SUM(hashtext("+s.hash+")::bigint)) AS f").
			Where(s.date+" < ?", before).
			Scan(&r).Error; err != nil {
			return "", err
		}
		fp += s.table + "=" + r.F + ";"
	}
	return fp, nil
}

func uintKey(p *uint) string {
	if p == nil {
		return "-"
	}
	return fmt.Sprint(*p)
}
