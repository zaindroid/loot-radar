/* Seed the loot DB with clean, realistic demo loot at correct hall positions.
   Run:  node seed.js   (stop the server first, or it will hold the WAL) */
'use strict';
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { DEMO_LOOT, DEMO_COMMENTS, HALL_XY } = require('./seed_data');

const DATA = path.join(__dirname, 'data');
fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'loot.db'));
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  DROP TABLE IF EXISTS looters; DROP TABLE IF EXISTS loot;
  DROP TABLE IF EXISTS votes; DROP TABLE IF EXISTS comments; DROP TABLE IF EXISTS crew;
  CREATE TABLE looters (handle TEXT PRIMARY KEY, name TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE TABLE loot (
    id INTEGER PRIMARY KEY AUTOINCREMENT, looter TEXT NOT NULL, hall TEXT NOT NULL,
    stand TEXT, company TEXT NOT NULL, item TEXT NOT NULL, rarity INTEGER NOT NULL DEFAULT 1,
    x REAL NOT NULL, y REAL NOT NULL, photo TEXT, upvotes INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL
  );
  CREATE INDEX idx_loot_created ON loot(created DESC);
  CREATE INDEX idx_loot_company ON loot(company);
  CREATE TABLE votes (voter TEXT NOT NULL, loot_id INTEGER NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (voter, loot_id));
  CREATE TABLE comments (id INTEGER PRIMARY KEY AUTOINCREMENT, loot_id INTEGER NOT NULL, looter TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL);
  CREATE INDEX idx_comments_loot ON comments(loot_id, created);
  CREATE TABLE crew (a TEXT NOT NULL, b TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (a, b));
`);

const now = Date.now();
let t = 0;
const mk = () => now - (t++ * 37000);

// looter, hall, stand, company, item, rarity, dx, dy  (shared demo dataset)
const seed = DEMO_LOOT;

const insL = db.prepare('INSERT INTO looters (handle,name,created) VALUES (?,?,?)');
const insLoot = db.prepare(`INSERT INTO loot (looter,hall,stand,company,item,rarity,x,y,photo,upvotes,created) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const insV = db.prepare('INSERT INTO votes (voter,loot_id,created) VALUES (?,?,?)');
const insC = db.prepare('INSERT INTO comments (loot_id,looter,text,created) VALUES (?,?,?,?)');
const insCrew = db.prepare('INSERT INTO crew (a,b,created) VALUES (?,?,?)');

const looters = new Set();
const ids = [];
for (const [looter,hall,stand,company,item,rarity,dx,dy] of seed) {
  if (!looters.has(looter)) { looters.add(looter); insL.run(looter,looter,mk()); }
  const [hx,hy] = HALL_XY[hall];
  const r = insLoot.run(looter,hall,stand,company,item,rarity,
                        Math.min(0.99,Math.max(0.01,hx+dx)), Math.min(0.99,Math.max(0.01,hy+dy)),
                        '', 0, mk());
  ids.push(r.lastInsertRowid);
}

// votes: sprinkle upvotes weighted toward rarer items
let v=0;
for (let i=0;i<ids.length;i++){
  const [rar] = [seed[i][5]];
  let n = 0;
  if (rar>=5) n=4+Math.floor(Math.random()*9);
  else if (rar===4) n=2+Math.floor(Math.random()*7);
  else if (rar===3) n=1+Math.floor(Math.random()*5);
  else n=Math.floor(Math.random()*3);
  for (let k=0;k<n;k++){
    const voter = `u${v++}:${Math.random().toString(16).slice(2,6)}`;
    insV.run(voter, ids[i], mk());
  }
}
db.exec(`UPDATE loot SET upvotes = (SELECT COUNT(*) FROM votes WHERE votes.loot_id = loot.id)`);

// a few comments on top items (shared demo dataset: [seedIndex, looter, text])
for (const [i, l, t] of DEMO_COMMENTS) insC.run(ids[i], l, t, mk());

// crew links
insCrew.run('zain','mira',mk());
insCrew.run('zain','kai',mk());
insCrew.run('mira','nova',mk());

const nLoot = db.prepare('SELECT COUNT(*) c FROM loot').get().c;
const nUp = db.prepare('SELECT SUM(upvotes) s FROM loot').get().s;
console.log(`Seeded ${nLoot} loot across ${looters.size} looters, ${nUp} total upvotes, ${cmt.length} comments.`);
db.close();
