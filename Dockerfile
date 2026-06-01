FROM node:22-bookworm-slim AS base

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global pnpm@11.5.0

WORKDIR /app

FROM base AS build

RUN apt-get update \
  && apt-get install --yes --no-install-recommends git python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter=@app/domain build \
  && pnpm --filter=server build \
  && pnpm --filter=website bundle
RUN rm -rf apps/server/public \
  && mkdir -p apps/server/public \
  && cp -R apps/website/dist/. apps/server/public/

FROM base AS runtime

ENV NODE_ENV="production"

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY apps/server/package.json apps/server/package.json
COPY packages/domain/package.json packages/domain/package.json

RUN pnpm install --frozen-lockfile --prod --filter=server... --ignore-scripts

COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/public apps/server/public
COPY --from=build /app/packages/domain/dist packages/domain/dist

WORKDIR /app/apps/server

EXPOSE 3000

CMD ["node", "dist/main.js"]
