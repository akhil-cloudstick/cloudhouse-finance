package controllers

import (
	"cloudhouse/backend/auth"
	"net/http"

	"github.com/labstack/echo/v4"
)

func customerCustomerIDFromContext(c echo.Context) (uint, bool) {
	v, ok := Get(c, "customerId")
	if !ok {
		return 0, false
	}
	id, ok := v.(uint)
	return id, ok
}

func CustomerGetProfile(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, ok := customerCustomerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	rec, err := getCustomer(ctx, customerID, nil)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, CustomerToResponse(rec))
}

func CustomerVerifyPAN(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, ok := customerCustomerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	rec, result, err := verifyPAN(ctx, customerID, nil)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, echo.Map{
		"customer":     CustomerToResponse(rec),
		"message":      result.Message,
		"matched_name": result.FullName,
		"trace_id":     result.TraceID,
	})
}

func CustomerStartAadhaarVerify(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, ok := customerCustomerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	var req startAadhaarVerifyRequest
	if err := BindJSON(c, &req); err != nil {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "Invalid input"})
	}
	digReq, err := startAadhaarVerify(ctx, customerID, nil, req.RedirectURL)
	if err != nil {
		return FailErr(c, err)
	}
	return Success(c, http.StatusOK, echo.Map{
		"id":         digReq.ID,
		"url":        digReq.URL,
		"status":     digReq.Status,
		"valid_upto": digReq.ValidUpto,
	})
}

func CustomerCheckAadhaarVerify(c echo.Context) error {
	ctx := auth.RequestContext(c)
	customerID, ok := customerCustomerIDFromContext(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, echo.Map{"success": false, "error": "not authenticated"})
	}
	rec, status, aadhaar, reasons, err := checkAadhaarVerify(ctx, customerID, nil)
	if err != nil {
		return FailErr(c, err)
	}
	if aadhaar == nil {
		return Success(c, http.StatusOK, echo.Map{"status": status.Status})
	}
	return Success(c, http.StatusOK, echo.Map{
		"customer":        CustomerToResponse(rec),
		"status":          status.Status,
		"matched_name":    aadhaar.Aadhaar.Name,
		"dob":             aadhaar.Aadhaar.DateOfBirth,
		"failure_reasons": reasons,
	})
}
