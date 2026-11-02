FROM node:26-alpine@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797 AS builder

ARG NODE_OPTIONS=--max-old-space-size=4096
ENV NODE_OPTIONS=${NODE_OPTIONS}

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/

RUN npm ci --workspace=frontend --no-audit --no-fund

COPY frontend ./frontend

WORKDIR /app/frontend

RUN npm run build

FROM nginx:stable-alpine@sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949 AS runner

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
