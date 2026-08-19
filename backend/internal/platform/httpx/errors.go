package httpx

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// StatusedError is implemented by any error that knows which HTTP status it
// should map to. CodedError (below) is the one concrete implementation;
// modules migrating to this package declare their sentinel errors with
// NewNotFound/NewBadRequest/NewConflict/NewForbidden instead of a bare
// errors.New, so StatusForErr can classify them without a per-module switch.
type StatusedError interface {
	error
	Status() int
}

// CodedError pairs a clean, user-safe message with the status it maps to.
// Compared with errors.Is like any other sentinel — each New* call returns a
// distinct pointer, so var ErrNotFound = httpx.NewNotFound("...") behaves
// exactly like the errors.New sentinels modules already declare.
type CodedError struct {
	msg    string
	status int
}

func (e *CodedError) Error() string { return e.msg }
func (e *CodedError) Status() int   { return e.status }

func NewNotFound(msg string) error     { return &CodedError{msg, http.StatusNotFound} }
func NewBadRequest(msg string) error   { return &CodedError{msg, http.StatusBadRequest} }
func NewConflict(msg string) error     { return &CodedError{msg, http.StatusConflict} }
func NewForbidden(msg string) error    { return &CodedError{msg, http.StatusForbidden} }
func NewUnauthorized(msg string) error { return &CodedError{msg, http.StatusUnauthorized} }
func NewUnavailable(msg string) error  { return &CodedError{msg, http.StatusServiceUnavailable} }

// StatusForErr classifies err for the response status code. An error
// implementing StatusedError (any CodedError, or a module's own type) maps to
// its own status; anything else defaults to 400 — never 500 (per the house
// standard, an unmapped failure still gets a status the client can act on,
// with the real detail logged server-side by the caller, not returned here).
func StatusForErr(err error) int {
	var se StatusedError
	if errors.As(err, &se) {
		return se.Status()
	}
	return http.StatusBadRequest
}

// IDParam reads and validates a numeric path parameter (e.g. ":id",
// ":loan_id"), replacing the small idParam helper every module used to
// redeclare for itself.
func IDParam(c *gin.Context, name string) (uint, error) {
	v, err := strconv.ParseUint(c.Param(name), 10, 64)
	if err != nil {
		return 0, NewBadRequest("invalid " + name)
	}
	return uint(v), nil
}
