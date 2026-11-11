# Minimum patched Node runtime. The verified fallback covers the delay between
# Node security downloads and official Docker tags. Other architectures fail
# closed until their official base image contains this security release.
FROM node:22-alpine AS node-security-base
RUN set -eu; \
    if node -e "const a=process.versions.node.split('.').map(Number),b='22.23.5'.split('.').map(Number);if(a[0]!==b[0]||a[1]<b[1]||(a[1]===b[1]&&a[2]<b[2]))process.exit(1)"; then exit 0; fi; \
    case "$(uname -m)" in \
      x86_64) archive="node-v22.23.5-linux-x64-musl.tar.gz"; checksum="83b8ba916eb22e89ba8274426a40f7aa0011c6e4c5ff77a5b03793f781a90786" ;; \
      *) echo "Patched Node 22.23.5 base image required for this architecture" >&2; exit 1 ;; \
    esac; \
    wget -qO /tmp/node-security.tar.gz "https://nodejs.org/dist/v22.23.5/$archive"; \
    echo "$checksum  /tmp/node-security.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/node-security.tar.gz --strip-components=2 -C /usr/local/bin "${archive%.tar.gz}/bin/node"; \
    rm /tmp/node-security.tar.gz; \
    node -e "const a=process.versions.node.split('.').map(Number),b='22.23.5'.split('.').map(Number);if(a[0]!==b[0]||a[1]<b[1]||(a[1]===b[1]&&a[2]<b[2]))process.exit(1)"

FROM node-security-base

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
RUN apk add --no-cache ffmpeg

COPY api ./api
COPY scripts ./scripts
COPY db/migrations ./db/migrations

RUN mkdir -p /app/uploads && chown node:node /app/uploads

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health > /dev/null || exit 1

CMD ["sh", "-c", "node api/migrate.js && node api/server.js"]
