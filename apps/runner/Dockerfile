# syntax=docker/dockerfile:1
#
# Standalone hosted-audit runner. Deploys anywhere that runs a plain Docker
# image (Coolify, Fly.io, Railway, Cloud Run, a bare VM) — nothing here is
# specific to one provider.
#
# Uses local Playwright Chromium (see docs/hosted-mvp.md for why), so the
# runtime image needs Chromium's OS-level dependencies, not just the Node
# app. The official Playwright image already bundles exactly the matching
# Chromium build for the pinned `playwright` version below and all of its
# system libraries, which avoids the real failure mode of a naive multi-stage
# build: copying the Node app forward without also copying the shared
# libraries Chromium needs, which silently breaks Chromium at runtime.
#
# Keep this tag in sync with the `playwright` version pinned in
# pnpm-workspace.yaml's catalog.
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.62.1-noble
ARG PNPM_VERSION=10.30.1

FROM ${PLAYWRIGHT_IMAGE} AS base
ARG PNPM_VERSION
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# --- Prune the monorepo down to what @ally/runner actually needs ---
FROM base AS pruner
WORKDIR /app
COPY . .
RUN pnpm dlx turbo prune @ally/runner --docker

# --- Install dependencies and build the pruned workspace ---
FROM base AS installer
WORKDIR /app
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm --filter=@ally/runner... run build
RUN pnpm --filter=@ally/runner exec playwright install chromium

# --- Runtime image ---
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN groupadd --system ally && useradd --system --create-home --gid ally ally

COPY --from=installer /app /app
RUN chown -R ally:ally /app "${PLAYWRIGHT_BROWSERS_PATH}"

USER ally
WORKDIR /app/apps/runner
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.ALLY_HEALTH_PORT || 8080) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# SIGTERM is handled in src/main.ts: stop pulling new jobs, let the in-flight
# one finish (bounded by ALLY_AUDIT_TIMEOUT_MS), then exit — no separate init
# process is needed for this single-process image.
STOPSIGNAL SIGTERM

CMD ["node", "--experimental-strip-types", "src/serve.ts"]
