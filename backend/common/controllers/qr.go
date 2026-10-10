package controllers

import (
	"net/http"

	"github.com/labstack/echo/v4"
	qrcode "github.com/skip2/go-qrcode"
)

func parsePositiveInt(s string) (int, error) {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, NewBadRequest("not a number")
		}
		n = n*10 + int(r-'0')
	}
	return n, nil
}

func GenerateQRCode(c echo.Context) error {
	data := c.QueryParam("data")
	if data == "" {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "missing required \"data\" query param"})
	}
	if len(data) > 2048 {
		return c.JSON(http.StatusBadRequest, echo.Map{"success": false, "error": "\"data\" is too long to encode as a QR code"})
	}
	size := 256
	if s := c.QueryParam("size"); s != "" {
		if n, err := parsePositiveInt(s); err == nil && n > 0 && n <= 1024 {
			size = n
		}
	}
	png, err := qrcode.Encode(data, qrcode.Medium, size)
	if err != nil {
		return FailErr(c, err)
	}
	c.Response().Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	return c.Blob(http.StatusOK, "image/png", png)
}
