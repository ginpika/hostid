FROM node:26-alpine@sha256:c6ad9e9c1d80f6eb607c26b4b0a132ff7a2344fad1c78ea3baa2a7d4c8de6d94 AS builder

ARG NODE_OPTIONS=--max-old-space-size=4096
ENV NODE_OPTIONS=${NODE_OPTIONS}

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/

RUN npm ci --workspace=frontend --no-audit --no-fund

COPY frontend ./frontend

WORKDIR /app/frontend

RUN npm run build

FROM nginx:stable-alpine@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951 AS runner

COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/nginx-main.conf /etc/nginx/nginx.conf
COPY frontend/docker-entrypoint.sh /usr/local/bin/hostid-frontend

RUN sed -i 's/\r$//' /usr/local/bin/hostid-frontend && \
    chmod +x /usr/local/bin/hostid-frontend

USER nginx

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=6 \
    CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/usr/local/bin/hostid-frontend"]
CMD ["nginx", "-g", "daemon off;"]
