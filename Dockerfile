# syntax=docker/dockerfile:1
# NovaColor: site (React/Vite) + API server (Node/Hono) in one container.
#   docker compose up -d --build        (see DEPLOY.md)
# Runtime data (content, leads, chats, uploads) lives in /app/data. Mount a volume there.

ARG NODE_VERSION=22

# ---------- build: site (dist/) + server (server-dist/) ----------
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm run build:site && npm run server:build

# ---------- prod-deps: only production node_modules ----------
FROM node:${NODE_VERSION}-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund
# Fail the build early if sharp's native binary is missing for this platform.
RUN node -e "const s=require('sharp'); console.log('sharp', s.versions.sharp, 'libvips', s.versions.vips)"

# ---------- runtime ----------
FROM node:${NODE_VERSION}-alpine AS runtime
# su-exec: the entrypoint starts as root only to fix /app/data ownership, then runs node as user "node".
# ffmpeg (optional, ~+70 MB): poster frames for uploaded videos and background 720p re-encoding of big ones.
# Without it uploads still work (no automatic poster). Build without: --build-arg WITH_FFMPEG=0
ARG WITH_FFMPEG=1
RUN apk add --no-cache su-exec $([ "$WITH_FFMPEG" = "1" ] && echo ffmpeg)
WORKDIR /app
ENV NODE_ENV=production \
    APP_DIR=/app \
    HOST=0.0.0.0 \
    PORT=8080 \
    DATA_DIR=/app/data \
    STATIC_DIR=/app/dist \
    SEED_CONTENT=/app/src/data/content.json

# package.json is required at runtime: it marks server-dist/*.js as ES modules and anchors APP_DIR.
COPY --chown=root:root package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist
COPY --from=build /app/src/data/content.json ./src/data/content.json
COPY deploy/docker-entrypoint.sh /usr/local/bin/novacolor-entrypoint.sh
RUN chmod 755 /usr/local/bin/novacolor-entrypoint.sh \
 && mkdir -p /app/data && chown node:node /app/data

VOLUME ["/app/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

ENTRYPOINT ["novacolor-entrypoint.sh"]
CMD ["node", "server-dist/index.js"]
