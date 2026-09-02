FROM golang:1.26-alpine AS build

WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/rime ./cmd/rime

FROM alpine:3.22

RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /out/rime /usr/local/bin/rime
USER 1000:1000
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/rime"]
