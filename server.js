/**
 * GAMESCOM LOOT RADAR — zero-dependency server
 * Node 18.19+ (uses built-in node:sqlite). No npm install needed.
 *
 *   node server.js            (port 4141 by default, override with PORT)
 *
 * Data:  app/data/loot.db (WAL)      Uploads: app/uploads/
 * Perf:  in-memory read cache, denormalized upvote counters,
 *        SSE fan-out for live updates, static gzip + cache headers.
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

// Default to 8080: that's the platform (Coolify/zorc) convention -- the
// reverse proxy and health probes route to the app.yaml port. Override with
// PORT for local dev (PORT=4141 node server.js).
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = process.env.DATA_DIR || path.join(ROOT, 'data');
const UPLOADS = process.env.UPLOADS_DIR || path.join(ROOT, 'uploads');
const MAPS = process.env.MAPS_DIR || path.join(ROOT, 'maps');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UPLOADS, { recursive: true });

/* ----------------------------- database ----------------------------- */
const db = new DatabaseSync(path.join(DATA, 'loot.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
  CREATE TABLE IF NOT EXISTS looters (
    handle TEXT PRIMARY KEY,
    name   TEXT NOT NULL,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS loot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    looter  TEXT NOT NULL,
    hall    TEXT NOT NULL,
    stand   TEXT,
    company TEXT NOT NULL,
    item    TEXT NOT NULL,
    rarity  INTEGER NOT NULL DEFAULT 1,
    x REAL NOT NULL, y REAL NOT NULL,
    photo   TEXT,
    upvotes INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_loot_created ON loot(created DESC);
  CREATE INDEX IF NOT EXISTS idx_loot_company ON loot(company);
  CREATE TABLE IF NOT EXISTS votes (
    voter TEXT NOT NULL,
    loot_id INTEGER NOT NULL,
    created INTEGER NOT NULL,
    PRIMARY KEY (voter, loot_id)
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    loot_id INTEGER NOT NULL,
    looter  TEXT NOT NULL,
    text    TEXT NOT NULL,
    created INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_comments_loot ON comments(loot_id, created);
  CREATE TABLE IF NOT EXISTS crew (
    a TEXT NOT NULL, b TEXT NOT NULL,
    created INTEGER NOT NULL,
    PRIMARY KEY (a, b)
  );
`);

const q = {
  ensureLooter: db.prepare('INSERT INTO looters (handle, name, created) VALUES (?,?,?) ON CONFLICT(handle) DO NOTHING'),
  getLooter: db.prepare('SELECT * FROM looters WHERE handle = ?'),
  searchLooters: db.prepare(`SELECT name FROM looters WHERE handle LIKE ? OR name LIKE ? ORDER BY created LIMIT 12`),
  allLoot: db.prepare(`SELECT * FROM loot ORDER BY created DESC`),
  lootById: db.prepare(`SELECT * FROM loot WHERE id = ?`),
  insertLoot: db.prepare(`INSERT INTO loot (looter, hall, stand, company, item, rarity, x, y, photo, created)
                          VALUES (?,?,?,?,?,?,?,?,?,?)`),
  deleteLoot: db.prepare('DELETE FROM loot WHERE id = ? AND looter = ?'),
  upvote: db.prepare(`INSERT INTO votes (voter, loot_id, created) VALUES (?,?,?)
                      ON CONFLICT(voter, loot_id) DO NOTHING`),
  unvote: db.prepare('DELETE FROM votes WHERE voter = ? AND loot_id = ?'),
  addUpvoteCol: db.prepare('UPDATE loot SET upvotes = upvotes + 1 WHERE id = ?'),
  subUpvoteCol: db.prepare('UPDATE loot SET upvotes = upvotes - 1 WHERE id = ?'),
  comment: db.prepare(`INSERT INTO comments (loot_id, looter, text, created) VALUES (?,?,?,?)`),
  commentsFor: db.prepare('SELECT looter, text, created FROM comments WHERE loot_id = ? ORDER BY created DESC LIMIT 50'),
  crewAdd: db.prepare('INSERT OR IGNORE INTO crew (a, b, created) VALUES (?,?,?)'),
  crewList: db.prepare('SELECT b FROM crew WHERE a = ?'),
  searchCompanies: db.prepare(`SELECT DISTINCT company FROM loot WHERE company LIKE ? ORDER BY company LIMIT 12`),
  searchItems: db.prepare(`SELECT DISTINCT item FROM loot WHERE item LIKE ? ORDER BY item LIMIT 12`),
  xpLoots: db.prepare('SELECT COUNT(*) c, COALESCE(SUM(upvotes),0) u FROM loot WHERE looter = ?'),
  xpComments: db.prepare('SELECT COUNT(*) c FROM comments WHERE looter = ?'),
  distinctHalls: db.prepare('SELECT COUNT(DISTINCT hall) c FROM loot WHERE looter = ?'),
  maxRarity: db.prepare('SELECT COALESCE(MAX(rarity),0) c FROM loot WHERE looter = ?'),
  myLoot: db.prepare('SELECT * FROM loot WHERE looter = ? ORDER BY created DESC'),
  myComments: db.prepare('SELECT COUNT(*) c FROM comments WHERE looter = ?'),
};

/* --------------------------- level & badges --------------------------- */
const LEVELS = [0, 300, 800, 1600, 3000, 5000, 8000, 12500, 18000, 25000];
function levelFor(xp) {
  let l = 1;
  while (l < LEVELS.length && xp >= LEVELS[l]) l++;
  return l;
}
function levelProgress(xp, lvl) {
  const lo = LEVELS[lvl - 1];
  const hi = lvl < LEVELS.length ? LEVELS[lvl] : LEVELS[lvl - 1] * 2;
  return { lo, hi, pct: Math.min(1, (xp - lo) / (hi - lo)) };
}
const BADGES = [
  { id: 'first',    name: 'First Drop',     need: (s) => s.loots >= 1 },
  { id: 'ten',      name: 'Certified',      need: (s) => s.loots >= 10 },
  { id: 'hopper',   name: 'Hall Hopper',    need: (s) => s.halls >= 5 },
  { id: 'legend',   name: 'Legend Finder',  need: (s) => s.maxRarity >= 4 },
  { id: 'mythic',   name: 'Mythic Hunter',  need: (s) => s.maxRarity >= 5 },
  { id: 'magnet',   name: 'Crowd Magnet',   need: (s) => s.upvotes >= 50 },
  { id: 'chatter',  name: 'Chatterbox',     need: (s) => s.comments >= 10 },
  { id: 'grinder',  name: 'XP Grinder',     need: (s) => s.xp >= 5000 },
];
function statsFor(handle) {
  const l = q.xpLoots.get(handle);
  const c = q.xpComments.get(handle);
  const h = q.distinctHalls.get(handle);
  const r = q.maxRarity.get(handle);
  const loots = l.c, upvotes = l.u, comments = c.c;
  const xp = loots * 100 + upvotes * 20 + comments * 10;
  const lvl = levelFor(xp);
  const earned = BADGES.filter((b) => b.need({ loots, upvotes, halls: h.c, maxRarity: r.c, comments, xp }))
    .map((b) => b.id);
  return { handle, loots, upvotes, comments, xp, lvl, earned,
           progress: levelProgress(xp, lvl) };
}

/* ------------------------------ live feed ----------------------------- */
const sseClients = new Set();
function broadcast(type, payload) {
  if (!sseClients.size) return;
  const msg = `data: ${JSON.stringify({ type, ...payload })}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}
function sseAttach(req, res) {
  const ip = req.socket.remoteAddress || '?';
  if ([...sseClients].filter((r) => r.socket?.remoteAddress === ip).length >= 3) {
    res.writeHead(429, { 'content-type': 'text/plain' });
    return res.end('too many streams from this ip');
  }
  if (sseClients.size >= 800) {
    res.writeHead(503, { 'content-type': 'text/plain' });
    return res.end('server at stream capacity, retry soon');
  }
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write('retry: 3000\n\n');
  sseClients.add(res);
  const keep = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(keep); sseClients.delete(res); });
}

/* ----------------------------- read cache ----------------------------- */
let lootCache = { version: 0, json: null };
function rebuildLootCache() {
  const rows = q.allLoot.all();
  lootCache = {
    version: lootCache.version + 1,
    count: rows.length,
    json: JSON.stringify({
      version: lootCache.version,
      count: rows.length,
      loot: rows.map((r) => ({
        id: r.id, looter: r.looter, hall: r.hall, stand: r.stand || '',
        company: r.company, item: r.item, rarity: r.rarity,
        x: r.x, y: r.y, photo: r.photo || '', upvotes: r.upvotes,
        created: r.created,
      })),
    }),
  };
}
rebuildLootCache();

/* ------------------------------ rate limit ---------------------------- */
const buckets = new Map();
function rateOk(ip, limit = 40, windowMs = 60000) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b || now > b.reset) { b = { count: 0, reset: now + windowMs }; buckets.set(ip, b); }
  b.count++;
  if (buckets.size > 20000) buckets.clear();
  return b.count <= limit;
}

/* ------------------------------- helpers ------------------------------ */
const RARITY_MAX = 5;
function cleanStr(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}
function handleOf(v) {
  return cleanStr(v, 24).toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 24);
}
function sendJSON(res, code, obj, extra = {}) {
  const body = typeof obj === 'string' ? obj : JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra,
  });
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('payload too large'), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ------------------------------ static files -------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.woff2': 'font/woff2',
};
let buildStamp = 0;
try { buildStamp = fs.statSync(path.join(PUBLIC, 'index.html')).mtimeMs | 0; } catch {}

function serveStatic(req, res, urlPath) {
  const p = urlPath === '/' ? '/index.html' : urlPath;
  let dir = PUBLIC, cache = 'public, max-age=60', rel = p;
  if (p.startsWith('/maps/')) { dir = MAPS; cache = 'public, max-age=86400'; rel = p.slice(6); }
  else if (p.startsWith('/uploads/')) { dir = UPLOADS; cache = 'public, max-age=86400'; rel = p.slice(9); }
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(dir, safe);
  if (file !== dir && !file.startsWith(dir + path.sep)) return notFound(res);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(res);
    const ext = path.extname(file).toLowerCase();
    const isHtml = urlPath === '/' || ext === '.html';
    const wantGzip = !isHtml && req.headers['accept-encoding']?.includes('gzip') && st.size > 512 &&
      (ext === '.js' || ext === '.css' || ext === '.json');
    const headers = {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': isHtml ? 'no-cache' : cache,
      'x-content-type-options': 'nosniff',
    };
    if (!wantGzip) headers['content-length'] = st.size;
    else headers['content-encoding'] = 'gzip';
    if (urlPath === '/') headers['x-build'] = String(buildStamp);
    res.writeHead(200, headers);
    if (wantGzip) {
      fs.createReadStream(file).pipe(zlib.createGzip({ level: 6 })).pipe(res);
    } else {
      fs.createReadStream(file).pipe(res);
    }
  });
}
function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('404');
}

/* OpenAPI 3 spec so the next agent can call this app (zorc AGENTS.md §2). */
function openapiSpec() {
  return {
    openapi: '3.0.0',
    info: {
      title: 'gamescom Loot Radar API',
      description: 'Live loot-drop map for gamescom 2026. Mark loot at a hall, rank rarity, upvote, comment, and climb the looter leaderboard. SSE live feed at /api/stream.',
      version: '1.0.0',
    },
    servers: [{ url: '/' }],
    tags: [
      { name: 'loot' }, { name: 'looter' }, { name: 'social' },
      { name: 'platform' },
    ],
    paths: {
      '/health': { get: { tags: ['platform'], summary: 'Liveness (no DB).', responses: { 200: { description: 'ok' } } } },
      '/ready': { get: { tags: ['platform'], summary: 'Readiness (DB probe).', responses: { 200: { description: 'ok' }, 503: { description: 'unavailable' } } } },
      '/version': { get: { tags: ['platform'], summary: 'Deploy info.', responses: { 200: { description: 'ok' } } } },
      '/api/loot': {
        get: {
          tags: ['loot'],
          summary: 'All loot (cached). Add ?since=ID for incremental sync.',
          parameters: [{ name: 'since', in: 'query', schema: { type: 'integer' } }],
          responses: { 200: { description: '{ version, count, loot: [] }' } },
        },
        post: {
          tags: ['loot'],
          summary: 'Mark new loot on the map.',
          requestBody: {
            required: true,
            content: { 'application/json': { schema: {
              type: 'object',
              required: ['looter', 'company', 'item', 'hall', 'x', 'y'],
              properties: {
                looter: { type: 'string' }, company: { type: 'string' },
                item: { type: 'string' }, stand: { type: 'string' },
                hall: { type: 'string' }, rarity: { type: 'integer', minimum: 1, maximum: 5 },
                x: { type: 'number' }, y: { type: 'number' },
                photo: { type: 'string', description: 'URL from /api/upload' },
              },
            } } },
          },
          responses: { 201: { description: '{ id, xp, ... }' }, 429: { description: 'rate limited' } },
        },
      },
      '/api/loot/{id}': {
        delete: {
          tags: ['loot'],
          summary: 'Delete your own loot.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
          responses: { 200: { description: 'ok' }, 404: { description: 'not found' } },
        },
      },
      '/api/loot/{id}/upvote': { post: { tags: ['social'], summary: 'Upvote loot (toggle).', responses: { 200: { description: '{ upvoted, total }' } } } },
      '/api/loot/{id}/upvote/remove': { post: { tags: ['social'], summary: 'Remove upvote.', responses: { 200: { description: '{ upvoted, total }' } } } },
      '/api/loot/{id}/comments': {
        get: { tags: ['loot'], summary: 'List comments.', responses: { 200: { description: '{ comments: [] }' } } },
        post: { tags: ['loot'], summary: 'Add a comment.', responses: { 201: { description: 'ok' } } },
      },
      '/api/search': {
        get: {
          tags: ['loot'],
          summary: 'Autocomplete by company / item / looter.',
          parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: '{ companies, items, looters }' } },
        },
      },
      '/api/leaderboard': { get: { tags: ['looter'], summary: 'Top looters by XP.', responses: { 200: { description: '{ total, top: [] }' } } } },
      '/api/me': {
        get: {
          tags: ['looter'],
          summary: 'Profile, badges, XP, my loot, crew.',
          parameters: [{ name: 'looter', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: '{ xp, lvl, loots, upvotes, earned, crew, myLoot }' } },
        },
      },
      '/api/crew': { post: { tags: ['social'], summary: 'Add/remove a crew mate.', responses: { 201: { description: '{ crew }' } } } },
      '/api/upload': { post: { tags: ['loot'], summary: 'Upload a loot photo (image, <=4MB).', responses: { 201: { description: '{ id, url }' } } } },
      '/api/stream': { get: { tags: ['platform'], summary: 'SSE live feed (loot / upvote / comment / crew / remove).', responses: { 200: { description: 'text/event-stream' } } } },
    },
  };
}

/* -------------------------------- router ------------------------------ */
const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress || '?';
  const u = new URL(req.url, 'http://x');
  const p = u.pathname;

  try {
    /* ---- platform contract endpoints (zorc) ---- */
    if (p === '/health' && req.method === 'GET') {
      // liveness: must NOT touch the DB, must answer < 1s
      return sendJSON(res, 200, { status: 'ok' });
    }
    if (p === '/ready' && req.method === 'GET') {
      // readiness: confirm the SQLite handle is live (cheap, single pragma-free probe)
      try {
        db.prepare('SELECT 1 AS ok').get();
        return sendJSON(res, 200, { status: 'ok' });
      } catch (e) {
        return sendJSON(res, 503, { status: 'unavailable', error: e.message });
      }
    }
    if (p === '/version' && req.method === 'GET') {
      let sha = 'dev';
      try {
        if (process.env.GIT_SHA) sha = process.env.GIT_SHA;
        else if (process.env.BUILD_SHA) sha = process.env.BUILD_SHA;
        else sha = String(buildStamp || Date.now());
      } catch {}
      return sendJSON(res, 200, {
        name: 'loot-radar',
        sha: sha,
        built: new Date(buildStamp || Date.now()).toISOString(),
        node: process.version,
      });
    }
    if (p === '/openapi.json' && req.method === 'GET') {
      return sendJSON(res, 200, openapiSpec());
    }

    /* ---- SSE live feed ---- */
    if (p === '/api/stream' && req.method === 'GET') return sseAttach(req, res);

    /* ---- search autocomplete ---- */
    if (p === '/api/search' && req.method === 'GET') {
      const s = cleanStr(u.searchParams.get('q') || '', 40);
      if (s.length < 1) return sendJSON(res, 200, { companies: [], items: [], looters: [] });
      const like = `%${s.replace(/[%_]/g, '')}%`;
      return sendJSON(res, 200, {
        companies: q.searchCompanies.all(like).map((r) => r.company),
        items: q.searchItems.all(like).map((r) => r.item),
        looters: q.searchLooters.all(like, like).map((r) => r.name),
      });
    }

    /* ---- all loot (cached; ?since=ID for incremental sync) ---- */
    if (p === '/api/loot' && req.method === 'GET') {
      const since = parseInt(u.searchParams.get('since') || '0', 10) || 0;
      if (since > 0) {
        const all = JSON.parse(lootCache.json);
        const rows = all.loot.filter((r) => r.id > since);
        return sendJSON(res, 200, JSON.stringify({
          version: all.version, count: all.count, loot: rows,
        }), { 'cache-control': 'no-store' });
      }
      return sendJSON(res, 200, lootCache.json, { 'cache-control': 'no-store' });
    }

    /* ---- add loot ---- */
    if (p === '/api/loot' && req.method === 'POST') {
      if (!rateOk(ip)) return sendJSON(res, 429, { error: 'slow down' });
      const raw = await readBody(req, 12000);
      const b = JSON.parse(raw.toString('utf8') || '{}');
      const looter = handleOf(b.looter);
      const company = cleanStr(b.company, 80);
      const item = cleanStr(b.item, 90);
      const hall = cleanStr(b.hall, 12);
      const stand = cleanStr(b.stand, 20);
      const photo = cleanStr(b.photo, 100);
      let rarity = parseInt(b.rarity, 10) || 1;
      rarity = Math.max(1, Math.min(RARITY_MAX, rarity));
      let x = parseFloat(b.x), y = parseFloat(b.y);
      if (!looter || !company || !item || !hall)
        return sendJSON(res, 400, { error: 'looter, company, item and hall are required' });
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1)
        return sendJSON(res, 400, { error: 'invalid map position' });
      if (photo && !/^\/uploads\/ph_[a-z0-9]+\.\w+$/.test(photo))
        return sendJSON(res, 400, { error: 'invalid photo' });
      q.ensureLooter.run(looter, looter, Date.now());
      const r = q.insertLoot.run(looter, hall, stand || null, company, item, rarity, x, y,
                                 photo || null, Date.now());
      rebuildLootCache();
      const row = q.lootById.get(r.lastInsertRowid);
      broadcast('loot', {
        loot: {
          id: row.id, looter: row.looter, hall: row.hall, stand: row.stand || '',
          company: row.company, item: row.item, rarity: row.rarity,
          x: row.x, y: row.y, photo: row.photo || '', upvotes: 0,
          created: row.created,
        },
      });
      return sendJSON(res, 201, { id: row.id, xp: 100 });
    }

    /* ---- delete own loot ---- */
    let m = p.match(/^\/api\/loot\/(\d+)$/);
    if (m && req.method === 'DELETE') {
      if (!rateOk(ip)) return sendJSON(res, 429, { error: 'slow down' });
      const b = JSON.parse((await readBody(req, 5000)).toString('utf8') || '{}');
      const looter = handleOf(b.looter);
      if (!looter) return sendJSON(res, 400, { error: 'looter required' });
      const r = q.deleteLoot.run(Number(m[1]), looter);
      if (r.changes) { rebuildLootCache(); broadcast('remove', { id: Number(m[1]) }); }
      return sendJSON(res, 200, { deleted: !!r.changes });
    }

    /* ---- upvote / unvote ---- */
    m = p.match(/^\/api\/loot\/(\d+)\/upvote$/);
    if (m && req.method === 'POST') {
      if (!rateOk(ip, 120)) return sendJSON(res, 429, { error: 'slow down' });
      const b = JSON.parse((await readBody(req, 3000)).toString('utf8') || '{}');
      const looter = handleOf(b.looter);
      const id = Number(m[1]);
      const loot = q.lootById.get(id);
      if (!looter || !loot) return sendJSON(res, 404, { error: 'not found' });
      const voter = `${looter}:${crypto.createHash('sha1').update(ip).digest('hex').slice(0, 8)}`;
      const ins = q.upvote.run(voter, id, Date.now());
      if (ins.changes) {
        q.addUpvoteCol.run(id);
        const cur = q.lootById.get(id).upvotes;
        broadcast('upvote', { id, total: cur });
        return sendJSON(res, 200, { upvoted: true, total: cur });
      }
      return sendJSON(res, 200, { upvoted: false, total: loot.upvotes });
    }
    m = p.match(/^\/api\/loot\/(\d+)\/upvote\/remove$/);
    if (m && req.method === 'POST') {
      const b = JSON.parse((await readBody(req, 3000)).toString('utf8') || '{}');
      const looter = handleOf(b.looter);
      const id = Number(m[1]);
      const loot = q.lootById.get(id);
      if (!looter || !loot) return sendJSON(res, 404, { error: 'not found' });
      const voter = `${looter}:${crypto.createHash('sha1').update(ip).digest('hex').slice(0, 8)}`;
      const del = q.unvote.run(voter, id);
      if (del.changes) {
        q.subUpvoteCol.run(id);
        const cur = q.lootById.get(id).upvotes;
        broadcast('upvote', { id, total: cur });
      }
      return sendJSON(res, 200, { upvoted: false, total: q.lootById.get(id).upvotes });
    }

    /* ---- comments ---- */
    m = p.match(/^\/api\/loot\/(\d+)\/comments$/);
    if (m) {
      const id = Number(m[1]);
      if (req.method === 'GET') {
        return sendJSON(res, 200, {
          comments: q.commentsFor.all(id).map((c) => ({
            looter: c.looter, text: c.text, created: c.created })),
        });
      }
      if (req.method === 'POST') {
        if (!rateOk(ip, 60)) return sendJSON(res, 429, { error: 'slow down' });
        const b = JSON.parse((await readBody(req, 5000)).toString('utf8') || '{}');
        const looter = handleOf(b.looter);
        const text = cleanStr(b.text, 300);
        if (!looter || !text) return sendJSON(res, 400, { error: 'looter and text required' });
        if (!q.lootById.get(id)) return sendJSON(res, 404, { error: 'not found' });
        q.ensureLooter.run(looter, looter, Date.now());
        q.comment.run(id, looter, text, Date.now());
        broadcast('comment', { id, count: q.commentsFor.all(id).length });
        return sendJSON(res, 201, { ok: true });
      }
    }

    /* ---- leaderboard ---- */
    if (p === '/api/leaderboard' && req.method === 'GET') {
      const rows = db.prepare('SELECT handle FROM looters ORDER BY created').all();
      const top = rows.map((r) => statsFor(r.handle))
        .sort((a, b) => b.xp - a.xp).slice(0, 20);
      return sendJSON(res, 200, {
        total: rows.length,
        top: top.map((t) => ({
          handle: t.handle, xp: t.xp, lvl: t.lvl, loots: t.loots,
          upvotes: t.upvotes, badges: t.earned,
          progress: t.progress,
        })),
      });
    }

    /* ---- my profile ---- */
    if (p === '/api/me' && req.method === 'GET') {
      const looter = handleOf(u.searchParams.get('looter') || '');
      if (!looter) return sendJSON(res, 400, { error: 'looter required' });
      const s = statsFor(looter);
      const mine = q.myLoot.all(looter).map((r) => ({
        id: r.id, hall: r.hall, stand: r.stand || '', company: r.company,
        item: r.item, rarity: r.rarity, x: r.x, y: r.y,
        photo: r.photo || '', upvotes: r.upvotes, created: r.created,
      }));
      const crew = q.crewList.all(looter).map((r) => r.b);
      return sendJSON(res, 200, { ...s, name: looter, crew, myLoot: mine });
    }

    /* ---- crew (friends) ---- */
    if (p === '/api/crew' && req.method === 'POST') {
      if (!rateOk(ip, 20)) return sendJSON(res, 429, { error: 'slow down' });
      const b = JSON.parse((await readBody(req, 3000)).toString('utf8') || '{}');
      const a = handleOf(b.me), c = handleOf(b.friend);
      if (!a || !c || a === c) return sendJSON(res, 400, { error: 'invalid' });
      if (b.rm) {
        db.prepare('DELETE FROM crew WHERE a = ? AND b = ?').run(a, c);
        return sendJSON(res, 200, { ok: true, crew: q.crewList.all(a).map((r) => r.b) });
      }
      if (!q.getLooter.get(c)) return sendJSON(res, 404, { error: 'that looter is not registered yet' });
      q.ensureLooter.run(a, a, Date.now());
      q.crewAdd.run(a, c, Date.now());
      broadcast('crew', { a, b: c });
      return sendJSON(res, 201, { ok: true, crew: q.crewList.all(a).map((r) => r.b) });
    }

    /* ---- photo upload ---- */
    if (p === '/api/upload' && req.method === 'POST') {
      if (!rateOk(ip, 20, 120000)) return sendJSON(res, 429, { error: 'too many uploads' });
      const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const extMap = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
      const ext = extMap[ct];
      if (!ext) return sendJSON(res, 415, { error: 'send image/jpeg, image/png, image/webp or image/gif' });
      const body = await readBody(req, 4 * 1024 * 1024);
      if (body.length < 100) return sendJSON(res, 400, { error: 'empty file' });
      const id = 'ph_' + crypto.randomBytes(6).toString('hex');
      fs.writeFileSync(path.join(UPLOADS, id + ext), body);
      return sendJSON(res, 201, { id, url: `/uploads/${id}${ext}` });
    }

    /* ---- health ---- */
    if (p === '/api/health' && req.method === 'GET')
      return sendJSON(res, 200, { ok: true, loot: lootCache.count, streams: sseClients.size });

    /* ---- static ---- */
    if (req.method === 'GET' || req.method === 'HEAD')
      return serveStatic(req, res, p);

    sendJSON(res, 405, { error: 'method not allowed' });
  } catch (e) {
    const code = e.status || e.code === 413 ? 413 : (e instanceof SyntaxError ? 400 : 500);
    try { sendJSON(res, code, { error: e.message || 'server error' }); } catch {}
  }
});

server.listen(PORT, HOST, () => {
  const sha = process.env.GIT_SHA || process.env.BUILD_SHA || 'dev';
  console.log(JSON.stringify({
    ts: new Date().toISOString(), level: 'info', event: 'startup',
    name: 'loot-radar', env: process.env.APP_ENV || 'development',
    sha, port: PORT, host: HOST, node: process.version,
  }));
  console.log(JSON.stringify({
    ts: new Date().toISOString(), level: 'info', event: 'serving',
    url: `http://${HOST}:${PORT}`, mapsDir: MAPS,
  }));
});
