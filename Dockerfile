# syntax=docker/dockerfile:1
#
# The API image, built from the repository root.
#
# It lives here rather than in apps/api because Railway builds a
# GitHub-connected service from the repository root, and a root directory is
# a dashboard-only setting. Everything the build needs is copied from
# apps/api; .dockerignore keeps the PWA, the merchant app and node_modules
# out of the context.

# ---- build: static binary, no CGO (prod DB driver is pure-Go pgx) ----
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/rails .

# ---- runtime: minimal, non-root ----
FROM alpine:3.20
# ca-certificates: outbound HTTPS (Fintava, Paycrest, CDP, Base RPC).
# tzdata: app calls time.LoadLocation (SERVER_TIMEZONE, e.g. Africa/Lagos).
RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -u 10001 app
USER app
COPY --from=build /out/rails /usr/local/bin/rails
# Railway/containers inject PORT; the app honours it (falls back to SERVER_PORT).
EXPOSE 8000
ENTRYPOINT ["rails"]
