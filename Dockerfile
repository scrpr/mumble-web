FROM node:24-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
COPY . /app
WORKDIR /app

FROM base AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile --registry https://registry.npmmirror.com

FROM base AS build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --registry https://registry.npmmirror.com
RUN pnpm run build

FROM base
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/apps/gateway/node_modules /app/apps/gateway/node_modules
COPY --from=build /app/apps/gateway/dist /app/apps/gateway/dist
COPY --from=build /app/apps/web/out /app/apps/web/out

EXPOSE 64737
CMD ["pnpm", "start"]
