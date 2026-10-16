FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY . .
RUN pnpm install
RUN pnpm --filter @orbaagent/shared build
RUN pnpm --filter @orbaagent/agent-runtime build
RUN pnpm --filter @orbaagent/model-gateway build
RUN pnpm --filter @orbaagent/orchestrator build
RUN pnpm --filter @orbaagent/web build

FROM base AS runner
RUN apk add --no-cache ffmpeg poppler-utils
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/services/agent-runtime/dist ./services/agent-runtime/dist
COPY --from=build /app/services/agent-runtime/package.json ./services/agent-runtime/package.json
COPY --from=build /app/services/model-gateway/dist ./services/model-gateway/dist
COPY --from=build /app/services/model-gateway/package.json ./services/model-gateway/package.json
COPY --from=build /app/services/orchestrator/dist ./services/orchestrator/dist
COPY --from=build /app/services/orchestrator/package.json ./services/orchestrator/package.json
COPY --from=build /app/apps/web/package.json ./apps/web/package.json
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web/node_modules ./apps/web/node_modules

# Persistent upload/artifact storage mount point.
#
# Created as node:node (uid/gid 1000) so the application user can write to it.
# When the named volume `orba_uploads_data` is first mounted here, Docker seeds
# the empty volume with this directory's contents AND ownership, which is what
# makes the volume writable by uid 1000 without any privileged init container or
# a blanket chmod of /app. Runs while still root, before USER node below.
RUN mkdir -p /data/uploads && chown -R node:node /data

WORKDIR /app/apps/web
USER node
EXPOSE 3000
CMD ["pnpm", "start"]

