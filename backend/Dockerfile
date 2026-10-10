# syntax=docker/dockerfile:1

# Backend-only image: builds the Go API server, which applies its own migrations on boot. This image does NOT build or embed the frontend — the Next.js
# static export is built by a separate `frontend` container/service and
# handed over via a shared Docker volume mounted read-only at
# /app/frontend/out (see ../docker-compose.yml). That keeps frontend and
# backend genuinely separate containers while the Go binary still does its
# own static-file serving (internal/webstatic).
FROM golang:1.26-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/server .

# Debian slim (not alpine) so `apt-get install chromium` works — chromedp
# drives a headless Chromium tab to render the loan indemnity bond PDF
# (see internal/platform/setu_esign.go, internal/loan/indemnitybond.go).
# fonts-noto-core provides the Malayalam/Gujarati glyphs the bond CSS
# requests (Noto Sans Malayalam / Noto Sans Gujarati); without it Chromium
# has no matching font and renders those scripts as tofu boxes, while
# Latin/English text still resolves via Debian's default fonts.
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata chromium \
       fonts-noto-core fontconfig \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

WORKDIR /app
COPY --from=builder /out/server ./server
COPY --from=builder /src/templates ./templates
COPY --from=builder /src/migrations ./migrations
RUN mkdir -p /app/uploads

ENV FRONTEND_DIR=/app/frontend/out
ENV UPLOADS_DIR=/app/uploads
ENV MIGRATIONS_DIR=/app/migrations

EXPOSE 6789
CMD ["./server"]
