FROM ghcr.io/pnpm/pnpm:11 AS deps
WORKDIR /app
# Install Node.js via pnpm runtime (pnpm image doesn't bundle Node)
RUN pnpm runtime set node --global 25

# Python + build-essential for native addons (better-sqlite3) requiring node-gyp
RUN apt-get update && apt-get install -y python3 build-essential && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml svelte.config.js ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY . .
RUN pnpm run build

FROM ghcr.io/pnpm/pnpm:11 AS runner
RUN pnpm runtime set node --global 25
WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/vite.config.ts ./vite.config.ts
# build-index.ts needs source + node_modules at runtime
COPY --from=builder /app/node_modules /app/node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/static ./static
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
ENV NODE_ENV=production
EXPOSE 3000
