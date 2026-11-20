module cloudhouse/desktop

go 1.26.0

require (
	github.com/wailsapp/wails/v2 v2.16.0
	golang.org/x/sys v0.49.0
)

require (
	github.com/chromedp/cdproto v0.0.0-20260714215040-dc233986426f // indirect
	github.com/chromedp/chromedp v0.16.0 // indirect
	github.com/chromedp/sysutil v1.1.0 // indirect
	github.com/gabriel-vasile/mimetype v1.4.12 // indirect
	github.com/glebarez/go-sqlite v1.21.2 // indirect
	github.com/glebarez/sqlite v1.11.0 // indirect
	github.com/go-gorp/gorp/v3 v3.1.0 // indirect
	github.com/go-json-experiment/json v0.0.0-20260623181947-01eb4420fa68 // indirect
	github.com/go-playground/locales v0.14.1 // indirect
	github.com/go-playground/universal-translator v0.18.1 // indirect
	github.com/go-playground/validator/v10 v10.30.1 // indirect
	github.com/gobwas/httphead v0.1.0 // indirect
	github.com/gobwas/pool v0.2.1 // indirect
	github.com/gobwas/ws v1.4.0 // indirect
	github.com/golang-jwt/jwt/v5 v5.3.1 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20240606120523-5a60cdf6a761 // indirect
	github.com/jackc/pgx/v5 v5.10.0 // indirect
	github.com/jackc/puddle/v2 v2.2.2 // indirect
	github.com/jinzhu/inflection v1.0.0 // indirect
	github.com/jinzhu/now v1.1.5 // indirect
	github.com/joho/godotenv v1.5.1 // indirect
	github.com/jung-kurt/gofpdf v1.16.2 // indirect
	github.com/leodido/go-urn v1.4.0 // indirect
	github.com/richardlehane/mscfb v1.0.7 // indirect
	github.com/richardlehane/msoleps v1.0.6 // indirect
	github.com/rubenv/sql-migrate v1.7.1 // indirect
	github.com/tiendc/go-deepcopy v1.7.2 // indirect
	github.com/xuri/efp v0.0.1 // indirect
	github.com/xuri/excelize/v2 v2.11.0 // indirect
	github.com/xuri/nfp v0.0.2-0.20250530014748-2ddeb826f9a9 // indirect
	golang.org/x/sync v0.24.0 // indirect
	golang.org/x/time v0.8.0 // indirect
	gorm.io/driver/postgres v1.6.2 // indirect
	gorm.io/gorm v1.31.2 // indirect
)

// CloudHouse patch: adds a way to flip WebView2's DevTools on at runtime
// (behind a PIN check), which upstream Wails only supports via a build tag
// at startup. See wails-patched/wails-v2/internal/frontend/desktop/windows/frontend.go
// for the one small addition — diff against the real v2.16.0 release before
// ever bumping this version.
replace github.com/wailsapp/wails/v2 => ./wails-patched/wails-v2

require (
	cloudhouse/backend v0.0.0
	git.sr.ht/~jackmordaunt/go-toast/v2 v2.0.3 // indirect
	github.com/bep/debounce v1.2.1 // indirect
	github.com/dustin/go-humanize v1.1.0 // indirect
	github.com/go-ole/go-ole v1.3.0 // indirect
	github.com/godbus/dbus/v5 v5.1.0 // indirect
	github.com/google/uuid v1.6.0 // indirect
	github.com/gorilla/websocket v1.5.3 // indirect
	github.com/jchv/go-winloader v0.0.0-20210711035445-715c2860da7e // indirect
	github.com/labstack/echo/v4 v4.13.3 // indirect
	github.com/labstack/gommon v0.4.2 // indirect
	github.com/leaanthony/go-ansi-parser v1.6.1 // indirect
	github.com/leaanthony/gosod v1.0.4 // indirect
	github.com/leaanthony/slicer v1.6.0 // indirect
	github.com/leaanthony/u v1.1.1 // indirect
	github.com/mattn/go-colorable v0.1.13 // indirect
	github.com/mattn/go-isatty v0.0.24 // indirect
	github.com/ncruces/go-strftime v1.1.0 // indirect
	github.com/pkg/browser v0.0.0-20240102092130-5ac0b6a4141c // indirect
	github.com/pkg/errors v0.9.1 // indirect
	github.com/remyoudompheng/bigfft v0.0.0-20230129092748-24d4a6f8daec // indirect
	github.com/rivo/uniseg v0.4.7 // indirect
	github.com/samber/lo v1.49.1 // indirect
	github.com/skip2/go-qrcode v0.0.0-20200617195104-da1b6568686e
	github.com/tkrajina/go-reflector v0.5.8 // indirect
	github.com/valyala/bytebufferpool v1.0.0 // indirect
	github.com/valyala/fasttemplate v1.2.2 // indirect
	github.com/wailsapp/go-webview2 v1.0.22 // indirect
	github.com/wailsapp/mimetype v1.4.1 // indirect
	golang.org/x/crypto v0.54.0 // indirect
	golang.org/x/net v0.56.0 // indirect
	golang.org/x/text v0.40.0 // indirect
	modernc.org/libc v1.79.0 // indirect
	modernc.org/mathutil v1.7.1 // indirect
	modernc.org/memory v1.12.1 // indirect
	modernc.org/sqlite v1.61.0
)

replace cloudhouse/backend => ../../backend
