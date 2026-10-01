// Package httpx holds the shared HTTP response envelope and error
// classification every module's handlers use, so the shape of a response and
// the choice of status code stop being reimplemented per module. It imports
// nothing from internal/<module> packages — only gin and the standard
// library — so every module can import it without a cycle.
package httpx

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
)

// genericMessage is what a client sees for an error that isn't a known,
// user-safe StatusedError — e.g. an unexpected DB/driver failure. The real
// error is logged server-side by FailErr; the client never sees it.
const genericMessage = "Something went wrong. Please try again."

// Success writes {success: true, data: <data>} — the envelope for a single
// resource (Create/Get/Update) and for a plain confirmation message.
func Success(c *gin.Context, status int, data any) {
	c.JSON(status, gin.H{
		"success": true,
		"data":    data,
	})
}

// SuccessMessage writes {success: true, message: <message>} — the
// delete/action-confirmation shape, when there is no resource to return.
func SuccessMessage(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{
		"success": true,
		"message": message,
	})
}

// SuccessList writes the paginated-list envelope:
// {success: true, message: {page, limit, total_pages, data: [...]}}.
// page/limit are echoed back as received; totalPages is 1 when the caller
// requested everything (page=0 or limit=0, per the house convention).
func SuccessList(c *gin.Context, page, limit int, totalPages int64, data any) {
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"message": gin.H{
			"page":        page,
			"limit":       limit,
			"total_pages": totalPages,
			"data":        data,
		},
	})
}

// Fail writes {success: false, error: <message>}. message must already be a
// clean, human-readable sentence safe to show a user — never a raw driver
// or SQL error (log those server-side with log.Println before calling Fail).
func Fail(c *gin.Context, status int, message string) {
	c.JSON(status, gin.H{
		"success": false,
		"error":   message,
	})
}

// FailAbort is Fail's counterpart for middleware: it stops the gin handler
// chain (c.Abort()) so no route handler downstream ever runs, in addition to
// writing the same {success: false, error: <message>} envelope.
func FailAbort(c *gin.Context, status int, message string) {
	c.AbortWithStatusJSON(status, gin.H{
		"success": false,
		"error":   message,
	})
}

// FailErr classifies err and writes the response. An error implementing
// StatusedError (a sentinel declared via NewNotFound/NewBadRequest/
// NewConflict/NewForbidden) is assumed to already carry a clean, user-safe
// message and is sent as-is with its own status. Anything else — an
// unexpected DB/driver failure, a third-party API error — is logged
// server-side and answered with a generic 400 message instead, so raw
// internal detail never reaches the client.
func FailErr(c *gin.Context, err error) {
	var se StatusedError
	if errors.As(err, &se) {
		Fail(c, se.Status(), se.Error())
		return
	}
	log.Printf("unclassified error: %v", err)
	Fail(c, http.StatusBadRequest, genericMessage)
}
