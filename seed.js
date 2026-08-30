/* Seed the loot DB with clean, realistic demo loot at correct hall positions.
   Run:  node seed.js   (stop the server first, or it will hold the WAL) */
'use strict';
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

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

// looter, hall, stand, company, item, rarity, dx, dy  (dx/dy in fraction of map)
const seed = [
  ['zain',   '8',    'B45',  'Bandai Namco',     'Signed Jujutsu Kaisen figure', 5,  0.00, -0.006],
  ['zain',   '8',    'B12',  'Capcom',           'Limited RE4 art print',        4,  0.05,  0.02],
  ['zain',   '11',   'E08',  'Konami',           'PEAK x gamescom exclusive tee',4,  0.0,   0.0],
  ['zain',   '6',    'A22',  'Razer',            'Free Viper V3 + mousepad',     3,  0.0,   0.0],
  ['zain',   '5',    'C31',  'Steam',            'Free 10% key + wallet',        2, -0.045, 0.0],
  ['mira',   '9',    'D15',  'Nintendo',         'Metroid themed snapback cap',  3,  0.0,   0.0],
  ['mira',   '9',    'D04',  'Nintendo',         'Signed Switch 2 dev unit',     5,  0.05, -0.03],
  ['mira',   '4.1',  'F20',  'Epic Games',       'Unreal 6 dev license',         4,  0.0,   0.0],
  ['mira',   '2.1',  'G11',  'Paradox',          'Handmade Europa Universalis poster', 2, 0.0, 0.03],
  ['kai',    '6',    'A05',  'HyperX',           'Alone in the Dark plush',      3, -0.04,  0.03],
  ['kai',    '5',    'C44',  'Xbox',             'Free Xbox Game Pass code',     3,  0.05,  0.04],
  ['kai',    '1',    'H02',  'Ubisoft',          'Prince of Persia signed copy', 4,  0.0,  -0.04],
  ['kai',    '10.1', 'J18',  'Bethesda',         'Doom x gamescom steelbook',    5,  0.0,   0.04],
  ['kai',    '10.2', 'J09',  'Indie Arena',      'Dev copy + Indie swag bag',   4,  0.0,  -0.03],
  ['nova',   '3.1',  'K09',  'Riot Games',       'Valorant exclusive sticker pack', 2, 0.0, 0.0],
  ['nova',   '4.1',  'L03',  'Valve',            'Free Steam wallet $50',        1, -0.04,  0.02],
  ['nova',   '7',    'M27',  'Warner Bros',      'Suicide Squad: Kill City demo disc', 1, 0.0, 0.0],
  ['zain',   '5.1',  'N01',  'PlayStation',      'PS5 era limited art card',     3,  0.0,   0.0],
];

const insL = db.prepare('INSERT INTO looters (handle,name,created) VALUES (?,?,?)');
const insLoot = db.prepare(`INSERT INTO loot (looter,hall,stand,company,item,rarity,x,y,photo,upvotes,created) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
const insV = db.prepare('INSERT INTO votes (voter,loot_id,created) VALUES (?,?,?)');
const insC = db.prepare('INSERT INTO comments (loot_id,looter,text,created) VALUES (?,?,?,?)');
const insCrew = db.prepare('INSERT INTO crew (a,b,created) VALUES (?,?,?)');

const HALL_XY = {
  '8':[0.451,0.097],'7':[0.427,0.210],'6':[0.451,0.314],'5':[0.542,0.251],
  '5.1':[0.499,0.480],'4.1':[0.486,0.584],'4.2':[0.479,0.596],
  '1':[0.354,0.466],'2.1':[0.428,0.773],'3.1':[0.484,0.773],'3.2':[0.477,0.784],
  '11':[0.387,0.502],'11.1':[0.602,0.780],'9':[0.703,0.401],
  '10.1':[0.667,0.500],'10.2':[0.658,0.528],
};

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

// a few comments on top items
const cmt = [
  [ids[0], 'zain',  'signed + boxed, go fast - north entrance side'],
  [ids[1], 'mira',  'they were handing these out till like 2pm'],
  [ids[6], 'kai',   'dev unit is INSANE, only a few left'],
  [ids[12],'nova',  'steelbook at 10.1, they are restocking every hour'],
  [ids[2], 'zain',  'limited run, 500 pieces total worldwide'],
];
for (const [id,l,t] of cmt) insC.run(id,l,t,mk());

// crew links
insCrew.run('zain','mira',mk());
insCrew.run('zain','kai',mk());
insCrew.run('mira','nova',mk());

const nLoot = db.prepare('SELECT COUNT(*) c FROM loot').get().c;
const nUp = db.prepare('SELECT SUM(upvotes) s FROM loot').get().s;
console.log(`Seeded ${nLoot} loot across ${looters.size} looters, ${nUp} total upvotes, ${cmt.length} comments.`);
db.close();
