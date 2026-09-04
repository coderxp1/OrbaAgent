FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY pnpm-lock.yaml* package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY services/computer-runtime/package.json ./services/computer-runtime/
RUN pnpm install --frozen-lockfile || pnpm install
COPY packages/shared/ ./packages/shared/
COPY services/computer-runtime/ ./services/computer-runtime/
RUN pnpm --filter @orbaagent/shared build
RUN pnpm --filter @orbaagent/computer-runtime build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/services/computer-runtime/dist ./services/computer-runtime/dist
COPY --from=build /app/services/computer-runtime/package.json ./services/computer-runtime/package.json
COPY --from=build /app/node_modules ./node_modules

USER node
CMD ["node", "services/computer-runtime/dist/index.js"]
