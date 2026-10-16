package controllers

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"reflect"
	"strconv"

	"github.com/go-playground/validator/v10"
	"github.com/labstack/echo/v4"
)

var httpValidate = newValidator()

func newValidator() *validator.Validate {
	v := validator.New()
	v.SetTagName("binding")
	return v
}

func StatusForErr(err error) int {
	var se StatusedError
	if errors.As(err, &se) {
		return se.Status()
	}
	return http.StatusBadRequest
}

func logFailure(c echo.Context, status int, message string, err error) {
	tenantID, _ := Get(c, "tenantId")
	userID, _ := Get(c, "employeeId")
	req := c.Request()
	if err != nil {
		log.Printf("%d %s %s tenant=%v user=%v: %s: %v", status, req.Method, req.URL.Path, tenantID, userID, message, err)
	}
}

func Success(c echo.Context, status int, data any) error {
	return c.JSON(status, echo.Map{
		"success": true,
		"data":    data,
	})
}

func SuccessMessage(c echo.Context, status int, message string) error {
	return c.JSON(status, echo.Map{
		"success": true,
		"message": message,
	})
}

func SuccessList(c echo.Context, page, limit int, totalPages int64, data any) error {
	return c.JSON(http.StatusOK, echo.Map{
		"success": true,
		"message": echo.Map{
			"page":        page,
			"limit":       limit,
			"total_pages": totalPages,
			"data":        data,
		},
	})
}

func Fail(c echo.Context, status int, message string) error {
	if status >= http.StatusInternalServerError && status != http.StatusServiceUnavailable {
		status = http.StatusBadRequest
	}
	logFailure(c, status, message, nil)
	return c.JSON(status, echo.Map{
		"success": false,
		"error":   message,
	})
}

func FailWith(c echo.Context, status int, message string, err error) error {
	if status >= http.StatusInternalServerError && status != http.StatusServiceUnavailable {
		status = http.StatusBadRequest
	}
	logFailure(c, status, message, err)
	return c.JSON(status, echo.Map{
		"success": false,
		"error":   message,
	})
}

func FailErr(c echo.Context, err error) error {
	var pe *PermissionDeniedError
	if errors.As(err, &pe) {
		logFailure(c, pe.Status(), pe.Error(), nil)
		return c.JSON(pe.Status(), echo.Map{
			"success":            false,
			"error":              pe.Error(),
			"missing_permission": pe.Permission,
		})
	}
	var se StatusedError
	if errors.As(err, &se) {
		return Fail(c, se.Status(), se.Error())
	}
	return FailWith(c, http.StatusBadRequest, "Something went wrong. Please try again.", err)
}

func BindJSON(c echo.Context, v any) error {
	req := c.Request()
	if req == nil || req.Body == nil {
		return errors.New("invalid request")
	}
	if err := json.NewDecoder(req.Body).Decode(v); err != nil {
		return err
	}
	return validateBody(v)
}

// validateBody runs the binding tags on a struct body, or on each element of a
// list body — validator.Struct rejects anything that is not a struct outright.
func validateBody(v any) error {
	rv := reflect.Indirect(reflect.ValueOf(v))
	switch rv.Kind() {
	case reflect.Struct:
		return httpValidate.Struct(v)
	case reflect.Slice, reflect.Array:
		for i := 0; i < rv.Len(); i++ {
			if err := validateBody(rv.Index(i).Interface()); err != nil {
				return err
			}
		}
	}
	return nil
}

func BindQuery(c echo.Context, v any) error {
	if err := (&echo.DefaultBinder{}).BindQueryParams(c, v); err != nil {
		return err
	}
	return httpValidate.Struct(v)
}

func DefaultQuery(c echo.Context, key, def string) string {
	if _, ok := c.QueryParams()[key]; !ok {
		return def
	}
	return c.QueryParam(key)
}

func Get(c echo.Context, key string) (any, bool) {
	v := c.Get(key)
	return v, v != nil
}

func ErrorHandler(err error, c echo.Context) {
	if c.Response().Committed {
		return
	}
	var he *echo.HTTPError
	if errors.As(err, &he) {
		msg := http.StatusText(he.Code)
		if m, ok := he.Message.(string); ok && m != "" {
			msg = m
		}
		_ = FailWith(c, he.Code, msg, he.Internal)
		return
	}
	_ = FailErr(c, err)
}

func IDParam(c echo.Context, name string) (uint, error) {
	v, err := strconv.ParseUint(c.Param(name), 10, 64)
	if err != nil {
		return 0, NewBadRequest("invalid " + name)
	}
	return uint(v), nil
}

func PageParams(c echo.Context) (page, limit, offset int) {
	page, _ = strconv.Atoi(c.QueryParam("page"))
	limit, _ = strconv.Atoi(c.QueryParam("limit"))
	if page <= 0 || limit <= 0 {
		return 0, 0, 0
	}
	if limit > 500 {
		limit = 500
	}
	return page, limit, (page - 1) * limit
}

func TotalPages(total int64, limit int) int64 {
	if limit <= 0 {
		return 1
	}
	pages := total / int64(limit)
	if total%int64(limit) != 0 {
		pages++
	}
	return pages
}

func SuccessListWith(c echo.Context, page, limit int, totalPages int64, data any, extra echo.Map) error {
	msg := echo.Map{
		"page":        page,
		"limit":       limit,
		"total_pages": totalPages,
		"data":        data,
	}
	for k, v := range extra {
		msg[k] = v
	}
	return c.JSON(http.StatusOK, echo.Map{
		"success": true,
		"message": msg,
	})
}

func NextPages(page int, hasMore bool) int64 {
	if hasMore {
		return int64(page) + 1
	}
	return int64(page)
}

func SuccessPage(c echo.Context, page, limit int, total int64, data any, extra ...echo.Map) error {
	msg := echo.Map{
		"page":        page,
		"limit":       limit,
		"total":       total,
		"total_pages": TotalPages(total, limit),
		"data":        data,
	}
	for _, e := range extra {
		for k, v := range e {
			msg[k] = v
		}
	}
	return c.JSON(http.StatusOK, echo.Map{
		"success": true,
		"message": msg,
	})
}

func SuccessAll(c echo.Context, data any, extra ...echo.Map) error {
	var total int64
	if v := reflect.ValueOf(data); v.Kind() == reflect.Slice || v.Kind() == reflect.Array {
		total = int64(v.Len())
	}
	msg := echo.Map{
		"page":        0,
		"limit":       0,
		"total":       total,
		"total_pages": 1,
		"data":        data,
	}
	for _, e := range extra {
		for k, v := range e {
			msg[k] = v
		}
	}
	return c.JSON(http.StatusOK, echo.Map{
		"success": true,
		"message": msg,
	})
}
