FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY api ./api
COPY scripts ./scripts
COPY data ./data
COPY db/migrations ./db/migrations

RUN mkdir -p /app/uploads && chown node:node /app/uploads

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/health > /dev/null || exit 1

CMD ["sh", "-c", "node api/migrate.js && node scripts/seed-stamm-boulderhallen.js && node api/server.js"]
