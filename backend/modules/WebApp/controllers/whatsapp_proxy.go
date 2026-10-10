package controllers

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/labstack/echo/v4"
)

func RegisterWhatsAppProxy(router *echo.Echo, origin string) {
	target, err := url.Parse(origin)
	if err != nil {
		return
	}
	proxy := httputil.NewSingleHostReverseProxy(target)
	baseDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		req.URL.Path = strings.TrimPrefix(req.URL.Path, "/admin/whatsapp")
		if req.URL.Path == "" {
			req.URL.Path = "/"
		}
		baseDirector(req)
	}
	handler := func(c echo.Context) error {
		proxy.ServeHTTP(c.Response(), c.Request())
		return nil
	}
	router.Any("/admin/whatsapp", handler)
	router.Any("/admin/whatsapp"+"/*", handler)
}
