# syntax=docker/dockerfile:1
# Production SPA image: static build served by unprivileged nginx, /api proxied to the backend.

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginxinc/nginx-unprivileged:1.28-alpine AS runtime
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY nginx/security-headers-common.conf /etc/nginx/snippets/security-headers-common.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
