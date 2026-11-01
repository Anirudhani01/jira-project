# syntax=docker/dockerfile:1
# Antideploy / single-container production: nginx on $PORT, API on 127.0.0.1:8000.

FROM node:24-alpine AS frontend-build
WORKDIR /app
RUN corepack enable
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ .
RUN pnpm build

FROM python:3.13-slim AS backend-build
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
RUN pip install --no-cache-dir uv==0.11.32
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY backend/alembic.ini ./
COPY backend/migrations ./migrations
COPY backend/app ./app

FROM python:3.13-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends nginx gettext-base \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

WORKDIR /app
COPY --from=backend-build /app /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY --from=frontend-build /app/dist /usr/share/nginx/html
COPY frontend/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY frontend/nginx/security-headers-common.conf /etc/nginx/snippets/security-headers-common.conf
COPY nginx/antideploy.conf.template /etc/nginx/templates/default.conf.template
COPY scripts/antideploy/entrypoint.sh scripts/antideploy/nginx.main.conf /app/scripts/antideploy/
RUN chmod 755 /app/scripts/antideploy/entrypoint.sh
RUN chown -R app:app /app /usr/share/nginx/html /var/lib/nginx /var/log/nginx

USER app
EXPOSE 8080
ENTRYPOINT ["/app/scripts/antideploy/entrypoint.sh"]
