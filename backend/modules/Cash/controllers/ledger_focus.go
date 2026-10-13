package controllers

import (
	"context"
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"
)

type ledgerFocusKey struct{}

// ledgerFocus is the transaction a ledger was opened from another ledger to show: the same date and amount.
type ledgerFocus struct {
	date   string
	amount float64
}

// LedgerFocus lets a ledger open on the page that holds a given transaction: with focus_date and focus_amount in
// the query, the ledger's response also says which page that is (focus_page) and returns it.
func LedgerFocus() echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			if c.Request().Method == http.MethodGet {
				amount, err := strconv.ParseFloat(strings.TrimSpace(c.QueryParam("focus_amount")), 64)
				if err == nil {
					req := c.Request()
					f := ledgerFocus{date: strings.TrimSpace(c.QueryParam("focus_date")), amount: amount}
					c.SetRequest(req.WithContext(context.WithValue(req.Context(), ledgerFocusKey{}, f)))
				}
			}
			return next(c)
		}
	}
}

// focusRowIndex is the index of the row to focus: the one on the focus date with the focus amount, else the
// first with that amount. -1 when there is none.
func focusRowIndex(rows []ledgerSourceRow, f ledgerFocus) int {
	same := func(a float64) bool { return a-f.amount < 0.005 && f.amount-a < 0.005 }
	fallback := -1
	for i, r := range rows {
		if r.Memo || !same(r.Amount) {
			continue
		}
		if f.date != "" && r.Date.Format("2006-01-02") == f.date {
			return i
		}
		if fallback < 0 {
			fallback = i
		}
	}
	return fallback
}
