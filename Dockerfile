# gamescom Loot Radar — zero-dependency Node 22 app.
# Pinned to the exact runtime that was verified working with node:sqlite
# (no --experimental-sqlite flag needed on 22.23.x). No npm install.
# Multi-stage, non-root, HEALTHCHECK, well under 500 MB final.

FROM node:22.23.1-slim AS runtime

# Run as the unprivileged 'node' user that the base image ships with.
# node:sqlite is built in on 22.23.x; --no-warnings silences the harmless
# "experimental feature" notice so container logs stay clean/structured.
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    UPLOADS_DIR=/uploads \
    NODE_OPTIONS="--no-warnings"

WORKDIR /app

# Copy runtime files (no node_modules needed — zero dependencies).
COPY package.json ./
COPY server.js seed.js ./
COPY app.yaml ./
COPY public ./public
COPY maps ./maps

# Writable, non-root-owned state dirs for the embedded SQLite DB + uploads.
RUN mkdir -p /data /uploads \
    && chown -R node:node /data /uploads /app

USER node

EXPOSE 8080

# Healthcheck via global fetch (curl is not present in -slim).
HEALTHCHECK --start-period=5s --interval=15s --timeout=4s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
