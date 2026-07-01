FROM node:22-alpine AS builder

ARG NODE_OPTIONS
ENV NODE_OPTIONS=${NODE_OPTIONS}

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/

RUN npm ci --workspace=frontend
RUN npm install @rollup/rollup-linux-arm64-musl --save-optional --workspace=frontend

COPY frontend ./frontend

WORKDIR /app/frontend

RUN npm run build

FROM nginx:alpine AS runner

COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/docker-entrypoint.sh"]
