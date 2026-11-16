# Syntax for multi-arch cross-compilation
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:alpine AS backend
WORKDIR /app
ARG TARGETOS
ARG TARGETARCH
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /app/internal/web/dist ./internal/web/dist
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build -ldflags="-s -w" -o /micromail ./cmd/micromail

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=backend /micromail /micromail
VOLUME ["/data"]
EXPOSE 25 587 993 8080
ENTRYPOINT ["/micromail"]
