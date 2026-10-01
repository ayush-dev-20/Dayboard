# syntax=docker/dockerfile:1
#
# Multi-stage build: base -> deps -> builder -> runtime. The runtime image holds only the
# Next.js standalone output and the bundled migration runner, runs as a non-root user, and
# contains no secrets. Configuration arrives as environment variables at run time.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

# Dependencies, cached until the lockfile changes.
FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Build the app and the migration runner. `next build` needs no runtime secrets: lib/env.ts uses
# placeholders during the build phase.
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build && pnpm build:migrate

FROM node:${NODE_VERSION}-alpine AS runtime
ARG APP_VERSION=dev
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    APP_VERSION=${APP_VERSION}
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
# One-shot migration step: `docker compose run --rm migrate` runs this same image with a different command.
COPY --from=builder --chown=app:app /app/dist/migrate.mjs ./migrate.mjs
COPY --from=builder --chown=app:app /app/drizzle/migrations ./drizzle/migrations

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
