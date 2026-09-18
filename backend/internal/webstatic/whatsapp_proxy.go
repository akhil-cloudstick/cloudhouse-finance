package webstatic

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
)

// whatsAppPrefix is the public path OpenWA is mounted under. OpenWA itself
// (dashboard build and Nest routes) is unaware of this prefix — it is
// stripped here before the request reaches OpenWA, and OpenWA's dashboard
// is built with a matching Vite `base` so the browser only ever asks for
// paths under this prefix in the first place (see
// OpenWA/dashboard/vite.config.ts).
const whatsAppPrefix = "/admin/whatsapp"

// RegisterWhatsAppProxy reverse-proxies everything under /admin/whatsapp to
// the OpenWA service (origin, e.g. "http://127.0.0.1:2785"), so the browser
// only ever talks to this one backend origin — matching the single-origin
// design of webstatic.Register itself. Must be registered before the
// catch-all NoRoute handler.
func RegisterWhatsAppProxy(router *gin.Engine, origin string) {
	target, err := url.Parse(origin)
	if err != nil {
		return
	}

	proxy := httputil.NewSingleHostReverseProxy(target)
	baseDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		req.URL.Path = strings.TrimPrefix(req.URL.Path, whatsAppPrefix)
		if req.URL.Path == "" {
			req.URL.Path = "/"
		}
		baseDirector(req)
	}

	handler := func(c *gin.Context) {
		proxy.ServeHTTP(c.Writer, c.Request)
	}
	router.Any(whatsAppPrefix, handler)
	router.Any(whatsAppPrefix+"/*proxyPath", handler)
}
