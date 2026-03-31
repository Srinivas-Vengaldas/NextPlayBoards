FROM golang:1.22-alpine AS build

WORKDIR /app

COPY go.mod ./
COPY go.sum ./
COPY vendor ./vendor
COPY internal ./internal
COPY cmd ./cmd

RUN go build -mod=vendor -o /app/bin/server ./cmd/server

FROM alpine:3.20

WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --from=build /app/bin/server ./server

USER app

EXPOSE 8080

CMD ["./server"]

