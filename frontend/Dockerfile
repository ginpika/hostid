FROM node:20-alpine AS builder

WORKDIR /app

ARG CF_TURNSTILE_SITE_KEY
ENV CF_TURNSTILE_SITE_KEY=$CF_TURNSTILE_SITE_KEY

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/

RUN npm install --workspace=frontend --include=optional

COPY frontend ./frontend

WORKDIR /app/frontend

RUN npm run build

FROM nginx:alpine AS runner

COPY --from=builder /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
