# syntax=docker/dockerfile:1.7
FROM node:24.22.3-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
COPY web/scripts ./scripts
# Supply either a licensed package archive or the vendor CI token as BuildKit secrets.
RUN --mount=type=secret,id=heroui_pro_archive --mount=type=secret,id=heroui_auth_token \
    npm ci --ignore-scripts && \
    if [ -f /run/secrets/heroui_pro_archive ]; then \
      mkdir -p /tmp/heroui-pro && tar -xzf /run/secrets/heroui_pro_archive -C /tmp/heroui-pro && \
      HEROUI_PRO_DIR=/tmp/heroui-pro node scripts/install-pro.mjs && rm -rf /tmp/heroui-pro; \
    elif [ -f /run/secrets/heroui_auth_token ]; then \
      HEROUI_AUTH_TOKEN="$(cat /run/secrets/heroui_auth_token)" node scripts/install-pro.mjs; \
    else node scripts/install-pro.mjs; fi
COPY web/ ./
RUN npm run build

FROM golang:1.27.0-alpine@sha256:4c9fe60190a2a3350ddc51de80d0224b8a6698d12bdfc999fee45ea9d6c46dbc AS backend
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /word ./cmd/server

FROM alpine:3.22.2@sha256:4b7ce07002c69e8f3d704a9c5d6fd3053be500b7f1c69fc0d80990c2ad8dd4121 AS runtime
RUN addgroup -g 10001 word && adduser -D -u 10001 -G word word && \
    mkdir -p /app/data && chown -R word:word /app
WORKDIR /app
COPY --from=backend /word /app/word
COPY --from=web /src/web/dist /app/web
ARG VCS_REF=unknown
ARG VERSION=dev
LABEL org.opencontainers.image.title="就背单词" \
      org.opencontainers.image.description="Vocabulary learning, spaced repetition and exam sprint" \
      org.opencontainers.image.source="https://github.com/KoinaAI/Word" \
      org.opencontainers.image.revision=$VCS_REF \
      org.opencontainers.image.version=$VERSION
ENV PORT=8080 DB_PATH=/app/data/word.db WEB_DIR=/app/web
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["/app/word"]
