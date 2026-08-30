# gamescom Loot Radar

Live, shareable loot-drop radar for gamescom 2026. Mark loot at a stall on the
official top-down hall map, rank its rarity, upvote, comment, and climb the
looter leaderboard. Built for the show floor: fast, live (SSE), mobile-first,
no build step.

**Stack:** one zero-dependency Node 22 process (`node:sqlite` built in). No
`npm install`, no Postgres, no build. A static SPA is served from the same
process.

## Run it

```bash
node server.js          # http://localhost:4141  (override with PORT)
node seed.js            # optional: seed clean demo loot
node tests/api.test.js  # integration test (ephemeral port + temp DB)
```

## Zorc platform contract

| Path | Purpose |
|---|---|
| `GET /health` | liveness, no DB, <1s |
| `GET /ready` | readiness, SQLite probe |
| `GET /version` | `{ name, sha, built, node }` |
| `GET /openapi.json` | full API spec |

`app.yaml` declares port 8080, 256 MB, no external dependencies. Data
(embedded SQLite) lives under `DATA_DIR` (`/data` in the container); uploads
under `UPLOADS_DIR`.

## API

See `GET /openapi.json`. Core: `GET/POST /api/loot`, `POST /api/loot/:id/upvote`,
`GET/POST /api/loot/:id/comments`, `GET /api/search?q=`, `GET /api/leaderboard`,
`GET /api/me?looter=`, `POST /api/crew`, `POST /api/upload`, and the
`GET /api/stream` SSE feed (`loot`, `upvote`, `comment`, `remove`, `crew`).

## Map coordinates

Halls are mapped onto the official gamescom Level 1 plan
(`maps/shops-level1-1600.jpg`, 1600x1600). Marker world coords are
`HALLS[i].x * 1600` / `.y * 1600` defined in `public/app.js`.
