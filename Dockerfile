# syntax=docker/dockerfile:1
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm build && pnpm prune --prod

FROM node:${NODE_VERSION}-slim
LABEL org.opencontainers.image.source="https://github.com/davidgarciab/domain-brain" \
      org.opencontainers.image.description="Keep track of the domains you own" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL=file:/data/domain-brain.db
WORKDIR /app
COPY --from=build /app/package.json /app/server.ts /app/cli.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.ts"]
