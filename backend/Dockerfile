# syntax=docker/dockerfile:1

# Backend-only image: builds the Go API server plus its `migrate` admin
# command. This image does NOT build or embed the frontend — the Next.js
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
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/server . \
    && CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/migrate ./cmd/migrate

# Debian slim (not alpine) so `apt-get install chromium` works — chromedp
# drives a headless Chromium tab to render the loan indemnity bond PDF
# (see internal/platform/setu_esign.go, internal/loan/indemnitybond.go).
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tzdata chromium \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /out/server ./server
COPY --from=builder /out/migrate ./migrate
COPY --from=builder /src/templates ./templates
RUN mkdir -p /app/uploads

ENV FRONTEND_DIR=/app/frontend/out
ENV UPLOADS_DIR=/app/uploads

EXPOSE 6789
CMD ["./server"]
