FROM golang:1.26-alpine AS build
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/modo-server ./cmd/server && \
    CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/modo-ops ./cmd/ops

FROM postgres:17-alpine
RUN mkdir -p /var/lib/modo/logs /var/lib/modo/erasures /var/lib/modo/backups && \
    chown -R 1000:1000 /var/lib/modo
COPY --from=build /out/modo-server /out/modo-ops /usr/local/bin/
ENV APP_ENV=production PORT=8080 PUBLIC_URL=https://modo.kodeploy.com \
    LOG_DIR=/var/lib/modo/logs ERASURE_JOURNAL=/var/lib/modo/erasures/journal.json \
    BACKUP_DIR=/var/lib/modo/backups MODO_BACKUPS_ENABLED=1
USER 1000:1000
EXPOSE 8080
ENTRYPOINT ["modo-server"]
