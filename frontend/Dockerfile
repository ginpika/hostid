FROM node:20-alpine AS builder

WORKDIR /app

ARG CF_TURNSTILE_SITE_KEY
ENV CF_TURNSTILE_SITE_KEY=$CF_TURNSTILE_SITE_KEY

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build

FROM nginx:alpine AS runner

RUN addgroup --system --gid 1001 nginxgroup
RUN adduser --system --uid 1001 nginxuser

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

RUN chown -R nginxuser:nginxgroup /usr/share/nginx/html /var/cache/nginx /var/log/nginx

USER nginxuser

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
