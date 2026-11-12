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
	// paymentID, when set, is the exact loan_payments.id the user followed: only that payment's rows are
	// focused, never another loan's payment that happens to share the date and amount.
	paymentID uint
}

// matchesPayment reports whether r is a row of the focused loan payment.
func (f ledgerFocus) matchesPayment(r ledgerSourceRow) bool {
	return r.ID == f.paymentID && (r.Kind == "loan_payment" || r.Kind == "loan_discount")
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
					if pid, perr := strconv.ParseUint(strings.TrimSpace(c.QueryParam("focus_payment")), 10, 64); perr == nil {
						f.paymentID = uint(pid)
					}
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
	exact, fallback := focusMatches(rows, f)
	if exact >= 0 {
		return exact
	}
	return fallback
}
