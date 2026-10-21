# syntax=docker/dockerfile:1

# --- Build: install every dependency, compile, then drop the dev dependencies ----------------
FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# --- Runtime: compiled code and production dependencies, run as the unprivileged node user ---
FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Owned by root and only readable by the node user, so the process can't rewrite its own code.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# Supabase's public root CA, so the database connection verifies the server (README "Deploying").
COPY certs ./certs

USER node
EXPOSE 3000

# Render runs its own health check against /api/v1/health; this one serves `docker run`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# dist/main.js validates the environment, runs pending migrations under an advisory lock, then
# listens on PORT. A failed migration stops the container before it serves anything.
CMD ["node", "--enable-source-maps", "dist/main.js"]
