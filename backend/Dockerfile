FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS base

WORKDIR /app

RUN apk add --no-cache openssl

FROM base AS builder

COPY package.json package-lock.json ./
COPY prisma ./prisma/

RUN npm ci --ignore-scripts --no-audit --no-fund && npm run db:generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run typecheck && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM base AS runner

ENV NODE_ENV=production \
    PORT=3001 \
    SMTP_PORT=2525 \
    DATABASE_URL=file:/app/data/prod.db

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 --ingroup nodejs appuser && \
    mkdir -p /app/data /app/uploads /app/logs /app/avatars && \
    chown appuser:nodejs /app/data /app/uploads /app/logs /app/avatars

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./
COPY docker-entrypoint.sh reset-admin.cjs promote-admin.cjs ./

RUN sed -i 's/\r$//' docker-entrypoint.sh && chmod +x docker-entrypoint.sh

USER appuser

EXPOSE 3001
EXPOSE 2525

HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=6 \
    CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/health', {signal: AbortSignal.timeout(2000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
