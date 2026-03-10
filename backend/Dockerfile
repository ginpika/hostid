FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

COPY . .

RUN npx prisma generate

FROM node:20-alpine AS runner

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 appuser

RUN apk add --no-cache openssl

COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci --only=production
RUN npm install tsx

RUN npx prisma generate

COPY src ./src
COPY docker-entrypoint.sh ./
COPY reset-admin.cjs ./

RUN chmod +x docker-entrypoint.sh
RUN mkdir -p /app/data /app/uploads /app/logs
RUN chown -R appuser:nodejs /app/data /app/uploads /app/logs

USER appuser

EXPOSE 3001
EXPOSE 25

ENTRYPOINT ["./docker-entrypoint.sh"]
