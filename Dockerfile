FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS web
WORKDIR /src/web
COPY web/ ./
# Pro is licensed. Credentials/artifacts enter through BuildKit secrets and the
# full package is removed in this same layer after compiling the application.
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=secret,id=heroui_token \
    --mount=type=secret,id=heroui_package \
    if [ -f /run/secrets/heroui_token ]; then export HEROUI_AUTH_TOKEN="$(cat /run/secrets/heroui_token)"; fi; \
    if [ -f /run/secrets/heroui_package ]; then npm ci --ignore-scripts; else npm ci; fi && \
    if [ -f /run/secrets/heroui_package ]; then tar -xzf /run/secrets/heroui_package -C node_modules/@heroui-pro/react; fi && \
    test -f node_modules/@heroui-pro/react/dist/index.js && \
    node -e 'const fs=require("fs");const p=JSON.parse(fs.readFileSync("node_modules/@heroui-pro/react/package.json"));const l=JSON.parse(fs.readFileSync("package-lock.json"));if(p.version!==l.packages["node_modules/@heroui-pro/react"].version)throw Error("HeroUI Pro artifact version does not match package-lock.json")' && \
    npm run build && \
    find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.json' \) -exec gzip -9 -k {} \; && \
    rm -rf node_modules/@heroui-pro/react /root/.heroui

FROM --platform=$BUILDPLATFORM golang:1.26-alpine@sha256:30b1e546a9c7fa3b747c2bdba3a0c7bdf3a02ebb4c5b8405d2f948d7e8aac4ec AS api
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY backend/ ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/word-server ./cmd/server

FROM alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf
ARG VCS_REF=unknown
ARG VERSION=development
LABEL org.opencontainers.image.title="就背单词" \
      org.opencontainers.image.description="Vocabulary learning, spaced repetition, and exam sprints" \
      org.opencontainers.image.source="https://github.com/KoinaAI/Word" \
      org.opencontainers.image.revision=$VCS_REF \
      org.opencontainers.image.version=$VERSION
RUN addgroup -g 10001 -S word && adduser -u 10001 -S -G word word \
    && mkdir -p /app /data && chown word:word /data
COPY --from=api /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=api /out/word-server /app/word-server
COPY --from=web /src/web/dist /app/web
ENV PORT=8080 DB_PATH=/data/word.db WEB_DIR=/app/web
WORKDIR /app
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/api/health || exit 1
STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/word-server"]
