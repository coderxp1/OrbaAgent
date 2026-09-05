FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY pnpm-lock.yaml* package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile || pnpm install
COPY packages/shared/ ./packages/shared/
COPY apps/web/ ./apps/web/
RUN pnpm --filter @orbaagent/shared build
RUN pnpm --filter @orbaagent/web build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/package.json ./package.json
COPY --from=build /app/apps/web/.next ./.next
COPY --from=build /app/apps/web/public ./public
COPY --from=build /app/node_modules ./node_modules

USER node
EXPOSE 3000
CMD ["pnpm", "start"]
