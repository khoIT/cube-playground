# syntax=docker/dockerfile:1.7
#
# Multi-stage, multi-target build for cube-playground.
#
# Build three runtime images from one file; docker-compose.prod.yml selects each
# via its `target`:
#   - server        Fastify API + Cube proxy        (:3004, internal)
#   - chat-service  Claude-agent chat microservice  (:3005, internal)
#   - web           nginx: serves the built SPA + reverse-proxies /api & /cube-api
#
# Node 22 LTS. The whole point of packing this is that the better-sqlite3 native
# addon is compiled once here, so the deploy host needs Docker only — no Node,
# npm, or C++ toolchain.

############################################################
# base — Node + the toolchain better-sqlite3's node-gyp build needs
############################################################
FROM node:22-bookworm-slim AS base
WORKDIR /app
# CI runners have no direct internet from build steps — apt and npm reach the
# mirrors only through the org proxy, passed in as the predefined *_PROXY build
# args (see docker-compose.prod.yml). BuildKit exposes these to every RUN and
# strips them from the final image, so no ENV plumbing is needed downstream.
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG NO_PROXY
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

############################################################
# deps — install every workspace's deps once (good layer caching).
# The root `gds-cube` (file:..) link only needs root package.json present; it is
# declared but not imported at runtime, so a bare manifest is enough to resolve.
############################################################
FROM base AS deps
# .npmrc carries legacy-peer-deps=true — required to resolve the antd v4 /
# @ant-design/compatible (peer antd@3.x) conflict. All three installs run with
# cwd /app, so this single root config governs each npm ci.
COPY .npmrc ./
COPY package.json package-lock.json ./
COPY server/package.json server/package-lock.json ./server/
COPY chat-service/package.json chat-service/package-lock.json ./chat-service/
RUN npm ci \
 && npm ci --prefix server \
 && npm ci --prefix chat-service

############################################################
# build — compile FE (vite), server (tsc), chat-service (tsc)
############################################################
FROM deps AS build
COPY . .
# VITE_* are inlined into the bundle at BUILD time (Vite limitation) — they are
# NOT runtime config. Same-origin defaults: the SPA calls /api and /cube-api,
# which nginx proxies to the server. Override per-env via CI build args.
ARG VITE_CUBE_API_URL=/cube-api/v1
ARG VITE_CUBE_TOKEN=
ARG VITE_LANGFUSE_HOST=
RUN npm run build \
 && npm run build --prefix server \
 && npm run build --prefix chat-service

############################################################
# server — runtime (Fastify :3004)
############################################################
FROM node:22-bookworm-slim AS server
ENV NODE_ENV=production
WORKDIR /app/server
# Proven node_modules with the already-compiled better-sqlite3 binary.
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
# tsc does NOT emit .sql — the migration runner reads dist/db/migrations/*.sql.
COPY --from=build /app/server/src/db/migrations ./dist/db/migrations
# tsc does NOT emit .yml either — the business-metrics registry loader and the
# dashboard-starter-pack loader both readdir dist/presets/**/*.yml at runtime.
# Without this, the prod image ships an empty dir → the metrics catalog and the
# starter dashboards load zero entries.
COPY --from=build /app/server/src/presets ./dist/presets
# Seed assets read at cwd: data/glossary.seed.json + data/seed/* (DBs excluded by .dockerignore).
COPY --from=build /app/server/data ./data
# Root file:.. link target + game/workspace config read from the repo root.
# Both workspace registries are baked in; WORKSPACES_CONFIG_PATH (compose) selects
# the prod one at runtime, leaving the local-dev default file for local runs.
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/gds.config.json /app/workspaces.config.json /app/workspaces.prod.config.json /app/
# SQLite lives on a mounted volume (see compose), never in the image.
ENV DB_PATH=/data/segments.db
EXPOSE 3004
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3004/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]

############################################################
# chat-service — runtime (Fastify :3005)
############################################################
FROM node:22-bookworm-slim AS chat-service
ENV NODE_ENV=production
# Runtime egress proxy. The LLM gateway (ANTHROPIC_BASE_URL —
# aawp-litellm-testing.vnggames.net — resolves to a PUBLIC IP) is reachable from
# the network-isolated prod runner ONLY via the org proxy; without it the Claude
# Code subprocess's HTTPS call to the gateway hangs until the turn times out
# (~140s, 0 LLM calls). Unlike the build stages, this runtime stage keeps the
# proxy as a persistent ENV so the running container (and the CLI it spawns) use
# it. The VALUE comes from the build arg the deploy injects (x-build-proxy-args),
# so the proxy credential is NOT hardcoded in git; empty in local builds (direct).
# NO_PROXY keeps internal traffic off the proxy — compose service names plus the
# docker bridge (172.16/12) and VNG internal ranges (10/8). `.vnggames.net` is
# deliberately ABSENT so the PUBLIC gateway still routes through the proxy (the
# internal Trino host is reached by cube_api, not this container).
ARG HTTP_PROXY
ARG HTTPS_PROXY
ENV http_proxy=${HTTP_PROXY} \
    https_proxy=${HTTPS_PROXY} \
    HTTP_PROXY=${HTTP_PROXY} \
    HTTPS_PROXY=${HTTPS_PROXY} \
    no_proxy=localhost,127.0.0.1,server,chat-service,cube_api,cubestore,.internal,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16 \
    NO_PROXY=localhost,127.0.0.1,server,chat-service,cube_api,cubestore,.internal,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16
WORKDIR /app/chat-service
COPY --from=build /app/chat-service/node_modules ./node_modules
COPY --from=build /app/chat-service/dist ./dist
# Non-TS runtime assets tsc skips:
#   - db/schema.sql            (migrate.ts reads resolve(__dirname,'schema.sql'))
#   - .claude/{commands,skills} (mode-prompts + skill-loader read ../../.claude)
COPY --from=build /app/chat-service/src/db/schema.sql ./dist/db/schema.sql
COPY --from=build /app/chat-service/.claude ./.claude
COPY --from=build /app/node_modules /app/node_modules
# Writable scratch (boot log, claude-home, parallel-emit). chat.db is on a volume.
RUN mkdir -p runtime && chown -R node:node /app/chat-service/runtime
ENV PORT=3005
ENV CHAT_DB_PATH=/data/chat.db
EXPOSE 3005
HEALTHCHECK --interval=30s --timeout=4s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3005/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]

############################################################
# web — runtime (nginx): serves the SPA + proxies API to the server
############################################################
FROM nginx:1.27-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null 2>&1 || exit 1
