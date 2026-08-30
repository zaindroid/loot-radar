/* GAMESCOM LOOT RADAR — app */
'use strict';

/* ------------------------- constants ------------------------- */
const MAP_W = 1600, MAP_H = 1600; // reference image size (square)

const HALLS = [
  // Co-locations re-derived from the official Level 1 plan (maps/shops-level1-1600.jpg).
  // Split halls (10.1/10.2, 2.1/2.2, 3.1/3.2, 4.1/4.2) occupy the same footprint as
  // their base hall on the Level 1 view; the .2 variant sits slightly offset.
  { id: '8',    label: 'Hall 8',    x: 0.451, y: 0.097 },
  { id: '7',    label: 'Hall 7',    x: 0.427, y: 0.210 },
  { id: '6',    label: 'Hall 6',    x: 0.451, y: 0.314 },
  { id: '5',    label: 'Hall 5',    x: 0.542, y: 0.251 },
  { id: '5.1',  label: 'Hall 5.1',  x: 0.499, y: 0.480 },
  { id: '4.1',  label: 'Hall 4.1',  x: 0.486, y: 0.584 },
  { id: '4.2',  label: 'Hall 4.2',  x: 0.479, y: 0.596 },
  { id: '1',    label: 'Hall 1',    x: 0.354, y: 0.466 },
  { id: '2.1',  label: 'Hall 2.1',  x: 0.428, y: 0.773 },
  { id: '3.1',  label: 'Hall 3.1',  x: 0.484, y: 0.773 },
  { id: '3.2',  label: 'Hall 3.2',  x: 0.477, y: 0.784 },
  { id: '11',   label: 'Hall 11',   x: 0.387, y: 0.502 },
  { id: '11.1', label: 'Hall 11.1', x: 0.602, y: 0.780 },
  { id: '9',    label: 'Hall 9',    x: 0.703, y: 0.401 },
  { id: '10.1', label: 'Hall 10.1', x: 0.667, y: 0.500 },
  { id: '10.2', label: 'Hall 10.2', x: 0.658, y: 0.528 },
];
const HALL_IDS = HALLS.map((h) => h.id);

const RARITY = {
  1: { name: 'Common',  color: 'var(--c1)', hex: '#58d5ff', period: '2.6s',
        glyph: '<path d="M12 5v14M5 12h14"/>' },
  2: { name: 'Rare',    color: 'var(--c2)', hex: '#b48cff', period: '2.2s',
        glyph: '<path d="M12 3l6 9-6 9-6-9z"/>' },
  3: { name: 'Epic',    color: 'var(--c3)', hex: '#ff5c8a', period: '1.8s',
        glyph: '<path d="M13 3L5 13h5l-1 8 8-11h-5z"/>' },
  4: { name: 'Legend',  color: 'var(--c4)', hex: '#ffb628', period: '1.4s',
        glyph: '<path d="M12 3l2.6 5.6 6 .6-4.5 4 1.3 5.9L12 16l-5.4 3 1.3-5.9-4.5-4 6-.6z"/>' },
  5: { name: 'Mythic',  color: 'var(--c5)', hex: '#39ffb4', period: '1.0s',
        glyph: '<path d="M4 8l4 3 4-6 4 6 4-3v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>' },
};
const BADGE_NAMES = {
  first: 'First Drop', ten: 'Certified', hopper: 'Hall Hopper',
  legend: 'Legend Finder', mythic: 'Mythic Hunter', magnet: 'Crowd Magnet',
  chatter: 'Chatterbox', grinder: 'XP Grinder',
};
const AV_GRADS = [
  'linear-gradient(135deg,#7c5cff,#38b6ff)',
  'linear-gradient(135deg,#ff5c8a,#ffb628)',
  'linear-gradient(135deg,#39ffb4,#58d5ff)',
  'linear-gradient(135deg,#b48cff,#ff5c8a)',
  'linear-gradient(135deg,#ffb628,#39ffb4)',
];

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ------------------------- state ------------------------- */
let loot = new Map();          // id -> record
let maxId = 0;
let me = null;                 // looter handle
let meProfile = null;
let myVoted = new Set();
let myCrew = new Set();
let filter = 'all';            // rarity filter
let query = '';               // active search filter
let openDetail = null;
let placing = false;
let picked = null;            // {x, y, hallId}
let detailComments = [];

/* ------------------------- helpers ------------------------- */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function timeAgo(ts) {
  const s = Math.max(1, (Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function avatarGrad(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AV_GRADS[h % AV_GRADS.length];
}
function api(path, opts = {}) {
  return fetch(path, {
    headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    ...opts,
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'request failed');
    return data;
  });
}
function toast(msg, kind = 'ok', ms = 3200) {
  const t = document.createElement('div');
  t.className = 'toast' + (kind === 'badge' ? ' badge' : '');
  const d = { ok: 'var(--c5)', okx: 'var(--c1)', badge: 'var(--c4)', bad: 'var(--c3)' }[kind] || 'var(--c5)';
  t.innerHTML = `<span class="td" style="background:${d};box-shadow:0 0 8px ${d}"></span><span>${msg}</span>`;
  $('#toasts').appendChild(t);
  setTimeout(() => {
    t.classList.add('bye');
    setTimeout(() => t.remove(), 320);
  }, ms);
}
function burst(x, y, color) {
  for (let i = 0; i < 10; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const a = (Math.PI * 2 * i) / 10 + Math.random() * 0.5;
    const d = 26 + Math.random() * 34;
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.background = color;
    p.style.boxShadow = `0 0 8px ${color}`;
    p.style.setProperty('--dx', Math.cos(a) * d + 'px');
    p.style.setProperty('--dy', Math.sin(a) * d + 'px');
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 720);
  }
}

/* ------------------------- view (pan/zoom) ------------------------- */
const vp = $('#mapvp');
const world = $('#mapworld');
const view = { x: 0, y: 0, k: 1 };
let fitK = 1, minK = 0.5;

function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  world.style.setProperty('--inv', String(1 / view.k));
  renderMarkers();
}
function fitView(anim) {
  const r = vp.getBoundingClientRect();
  // The venue footprint sits in the middle of the 1600px sheet with wide blue
  // margins; fit slightly past the full sheet and centre on the venue so the
  // halls fill the stage instead of floating in blue bars.
  const r0 = Math.min(r.width / MAP_W, r.height / MAP_H);
  const k = r0 * 1.14;
  fitK = k;
  minK = k * 0.6;
  view.k = k;
  view.x = r.width / 2 - (0.525 * MAP_W) * k;
  view.y = r.height / 2 - (0.50 * MAP_H) * k;
  if (anim) {
    world.style.transition = 'transform 0.5s cubic-bezier(0.3,1,0.4,1)';
    applyView();
    setTimeout(() => (world.style.transition = ''), 520);
  } else applyView();
}
function zoomAt(sx, sy, factor) {
  const k2 = clamp(view.k * factor, minK, 6.5);
  const f = k2 / view.k;
  view.x = sx - (sx - view.x) * f;
  view.y = sy - (sy - view.y) * f;
  view.k = k2;
  applyView();
}
function screenToWorld(sx, sy) {
  return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
}
function worldToFraction(wx, wy) {
  return { x: wx / MAP_W, y: wy / MAP_H };
}

/* pointer pan + pinch */
const pointers = new Map();
let pinchStart = null;
let panMoved = false;
vp.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.mk') || e.target.closest('#ghost')) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  panMoved = false;
  if (pointers.size === 1) {
    vp.classList.add('dragging');
    vp.setPointerCapture(e.pointerId);
  }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      k: view.k,
      mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2,
    };
  }
});
vp.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  p.x = e.clientX; p.y = e.clientY;
  panMoved = true;
  const r = vp.getBoundingClientRect();
  if (pointers.size === 1 && !pinchStart) {
    view.x += e.movementX;
    view.y += e.movementY;
    applyView();
  } else if (pointers.size === 2 && pinchStart) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
    const k2 = clamp((d / pinchStart.dist) * pinchStart.k, minK, 6.5);
    view.x = mid.x - (mid.x - pinchStart.mx + (pinchStart.mx - view.x)) * (k2 / view.k) - 0;
    // simpler: keep midpoint anchored
    view.x = mid.x - ((pinchStart.mx - view.x) / pinchStart.k) * k2;
    view.y = mid.y - ((pinchStart.my - view.y) / pinchStart.k) * k2;
    view.k = k2;
    applyView();
  }
});
function endPointer(e) {
  const wasPinch = pinchStart;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (pointers.size === 0) vp.classList.remove('dragging');
  if (pointers.size === 0 && !panMoved && !wasPinch && e.type === 'pointerup') {
    handleMapTap(e);
  }
}
vp.addEventListener('pointerup', endPointer);
vp.addEventListener('pointercancel', endPointer);
vp.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = vp.getBoundingClientRect();
  const f = e.deltaY < 0 ? 1.16 : 1 / 1.16;
  zoomAt(e.clientX - r.left, e.clientY - r.top, f);
}, { passive: false });

$('#zoomIn').onclick = () => {
  const r = vp.getBoundingClientRect();
  zoomAt(r.width / 2, r.height / 2, 1.35);
};
$('#zoomOut').onclick = () => {
  const r = vp.getBoundingClientRect();
  zoomAt(r.width / 2, r.height / 2, 1 / 1.35);
};
$('#zoomFit').onclick = () => fitView(true);
window.addEventListener('resize', () => fitView(false));

/* ------------------------- markers ------------------------- */
const mkLayer = $('#markers');
function visibleRecords() {
  let out = [...loot.values()];
  if (filter !== 'all') out = out.filter((l) => String(l.rarity) === filter);
  if (hallFilter !== 'all') out = out.filter((l) => String(l.hall) === hallFilter);
  if (query) {
    const q = query.toLowerCase();
    out = out.filter((l) =>
      l.company.toLowerCase().includes(q) ||
      l.item.toLowerCase().includes(q) ||
      l.looter.toLowerCase().includes(q) ||
      (l.stand || '').toLowerCase().includes(q));
  }
  return out;
}
function renderMarkers() {
  const list = visibleRecords();
  const showAll = view.k >= minK * 2.4;
  mkLayer.innerHTML = '';

  let targets = [];
  if (showAll) {
    targets = list.map((l) => ({ key: 'l' + l.id, rec: l, x: l.x, y: l.y, cluster: false }));
  } else {
    const byHall = new Map();
    for (const l of list) {
      const h = hallOf(l.x, l.y);
      (byHall.get(h.id) || byHall.set(h.id, []).get(h.id)).push(l);
    }
    for (const [hid, arr] of byHall) {
      const cx = arr.reduce((s, l) => s + l.x, 0) / arr.length;
      const cy = arr.reduce((s, l) => s + l.y, 0) / arr.length;
      targets.push({ key: 'h' + hid, hallId: hid, x: cx, y: cy, cluster: true, items: arr });
    }
  }
  for (const t of targets) {
    if (t.cluster) mkLayer.appendChild(clusterEl(t));
    else mkLayer.appendChild(markerEl(t.rec));
  }
  $('#lootCount').textContent = String(list.length);
  $('#emptyHint').style.opacity = list.length ? '0' : '1';
}
function hallOf(fx, fy) {
  let best = HALLS[0], bd = 1e9;
  for (const h of HALLS) {
    const d = (h.x - fx) ** 2 + (h.y - fy) ** 2;
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}
function markerEl(l) {
  const el = document.createElement('div');
  const r = RARITY[l.rarity] || RARITY[1];
  el.className = 'mk r' + l.rarity + (l._new ? ' new' : '');
  el.style.setProperty('--rc', r.hex);
  el.style.setProperty('--pk', r.period);
  el.style.left = (l.x * 100) + '%';
  el.style.top = (l.y * 100) + '%';
  el.innerHTML = `<div class="ring"></div><div class="core"><svg viewBox="0 0 24 24">${r.glyph}</svg></div>${
    l.upvotes > 0 ? `<span class="count">${l.upvotes}</span>` : ''}`;
  el.title = `${l.item} - ${l.company}`;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    openLoot(l.id);
  });
  return el;
}
function clusterEl(t) {
  const el = document.createElement('div');
  const best = Math.max(...t.items.map((l) => l.rarity));
  const r = RARITY[best];
  el.className = 'mk r' + best + ' cluster';
  el.style.setProperty('--rc', r.hex);
  el.style.setProperty('--pk', r.period);
  el.style.left = (t.x * 100) + '%';
  el.style.top = (t.y * 100) + '%';
  const n = t.items.length;
  el.innerHTML = `<div class="ring"></div><div class="core"><svg viewBox="0 0 24 24">${RARITY[best].glyph}</svg></div><span class="count">${n}</span>`;
  el.title = `${t.hallId}: ${n} loot`;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    const rr = vp.getBoundingClientRect();
    const wx = t.x * MAP_W, wy = t.y * MAP_H;
    view.k = Math.max(view.k * 1.9, minK * 3.4);
    view.x = rr.width / 2 - wx * view.k;
    view.y = rr.height / 2 - wy * view.k;
    applyView();
  });
  return el;
}

/* ------------------------- map tap (placement / explore) ------------------------- */
function handleMapTap(e) {
  const r = vp.getBoundingClientRect();
  const w = screenToWorld(e.clientX - r.left, e.clientY - r.top);
  if (w.x < -60 || w.y < -60 || w.x > MAP_W + 60 || w.y > MAP_H + 60) return;
  const p = {
    x: clamp(worldToFraction(w.x, w.y).x, 0.02, 0.98),
    y: clamp(worldToFraction(w.x, w.y).y, 0.02, 0.98),
  };
  p.hallId = hallOf(p.x, p.y).id;
  if (placing) {
    picked = p;
    setPlacing(false);
    updatePosline();
    openSheetForm();
  } else if (sheet.classList.contains('on')) {
    picked = p; // re-pin while form is open
    updatePosline();
    toast('Pinned to Hall ' + p.hallId, 'okx', 1400);
  } else {
    closeDetail();
  }
}
function setPlacing(on) {
  placing = on;
  vp.classList.toggle('placing', on);
  $('#placeBanner').classList.toggle('on', on);
}
$('#placeCancel').onclick = closeSheet;

/* ------------------------- add flow ------------------------- */
const sheet = $('#sheet');
/* Stage 1: FAB starts placement mode - banner invites a map tap.
   Stage 2: tapping the map pins the spot and slides the form up.
   Tapping the map again while the form is open re-pins it. */
function openSheet() {
  picked = null;
  updatePosline();
  closeDetail();
  setPlacing(true);
}
function openSheetForm() {
  sheet.classList.add('on');
  $('#sheet-backdrop').classList.add('on');
}
function closeSheet() {
  sheet.classList.remove('on');
  $('#sheet-backdrop').classList.remove('on');
  setPlacing(false);
}
$('#fab').onclick = openSheet;
$('#btnCancel').onclick = closeSheet;

/* hall chips */
const hallChips = $('#hallChips');
for (const h of HALLS) {
  const b = document.createElement('button');
  b.textContent = h.id;
  b.dataset.h = h.id;
  b.onclick = () => {
    $$('#hallChips button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    if (!picked) {
      picked = { x: h.x, y: h.y, hallId: h.id };
      updatePosline();
    }
  };
  hallChips.appendChild(b);
}
function setHallChip(id) {
  $$('#hallChips button').forEach((x) => x.classList.toggle('on', x.dataset.h === id));
}

/* rarity pick */
const rarityPick = $('#rarityPick');
for (const [n, r] of Object.entries(RARITY)) {
  const b = document.createElement('button');
  b.dataset.r = n;
  b.style.setProperty('--rc', r.hex);
  b.innerHTML = `<span class="sw"></span>${r.name}`;
  b.onclick = () => {
    $$('#rarityPick button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
  };
  rarityPick.appendChild(b);
}
function setRarity(n) {
  $$('#rarityPick button').forEach((x) => x.classList.toggle('on', x.dataset.r === String(n)));
}
setRarity(1);

/* photo */
let photoUrl = '';
$('#photoSlot').onclick = () => $('#photoFile').click();
$('#photoFile').onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = await fetch('/api/upload', { method: 'POST', body: f });
    if (!data.ok) throw new Error((await data.json()).error || 'upload failed');
    const j = await data.json();
    photoUrl = j.url;
    $('#photoPrev').src = photoUrl;
    $('#photoPrev').hidden = false;
    $('#photoSlot').classList.add('has');
  } catch (err) {
    toast('Photo: ' + err.message, 'bad');
  }
  e.target.value = '';
};
$('#photoRm').onclick = (e) => {
  e.stopPropagation();
  photoUrl = '';
  $('#photoPrev').hidden = true;
  $('#photoPrev').src = '';
  $('#photoSlot').classList.remove('has');
};

function updatePosline() {
  const el = $('#posline');
  const txt = $('#posText');
  if (picked) {
    el.classList.add('ok');
    txt.textContent = `Pinned to Hall ${picked.hallId}`;
    setHallChip(picked.hallId);
  } else {
    el.classList.remove('ok');
    txt.textContent = 'No position yet - tap somewhere on the map';
  }
}

/* save */
let saving = false;
$('#btnSave').onclick = async () => {
  if (saving) return;
  const handle = me || (await getHandle());
  if (!handle) return;
  const company = $('#fCompany').value.trim();
  const item = $('#fItem').value.trim();
  const rarity = parseInt(document.querySelector('#rarityPick button.on')?.dataset.r || '1', 10);
  if (!picked) { toast('Pick a spot on the map first', 'bad'); setPlacing(true); return; }
  if (!company || !item) { toast('Company and item are needed', 'bad'); return; }
  saving = true;
  $('#btnSave').disabled = true;
  $('#btnSave').textContent = 'DROPPING...';
  try {
    const res = await api('/api/loot', {
      method: 'POST',
      body: JSON.stringify({
        looter: handle,
        company, item,
        stand: $('#fStand').value.trim(),
        hall: picked.hallId,
        rarity,
        x: picked.x, y: picked.y,
        photo: photoUrl,
      }),
    });
    const rec = {
      id: res.id, looter: handle, hall: picked.hallId,
      stand: $('#fStand').value.trim(), company, item, rarity,
      x: picked.x, y: picked.y, photo: photoUrl, upvotes: 0,
      created: Date.now(), _new: true,
    };
    loot.set(res.id, rec);
    maxId = Math.max(maxId, res.id);
    renderMarkers();
    closeSheet();
    clearForm();
    toast(`Loot dropped. <span class="xp">+${res.xp} XP</span>`, 'ok');
    refreshMe();
  } catch (err) {
    toast(err.message, 'bad');
  }
  saving = false;
  $('#btnSave').disabled = false;
  $('#btnSave').textContent = 'DROPPED IT';
};
function clearForm() {
  $('#fStand').value = '';
  $('#fCompany').value = '';
  $('#fItem').value = '';
  setRarity(1);
  photoUrl = '';
  $('#photoPrev').hidden = true;
  $('#photoPrev').src = '';
  $('#photoSlot').classList.remove('has');
  setHallChip('');
  picked = null;
  updatePosline();
}

/* ------------------------- handle / profile ------------------------- */
function getHandle() {
  if (me) return me;
  return new Promise((resolve) => {
    const modal = $('#nameModal');
    modal.classList.add('on');
    const input = $('#nameInput');
    input.value = '';
    input.focus();
    const go = async () => {
      const v = input.value.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 24);
      if (v.length < 2) { input.focus(); input.placeholder = 'at least 2 chars'; return; }
      me = v;
      localStorage.setItem('loot.handle', v);
      modal.classList.remove('on');
      try { meProfile = await api('/api/me?looter=' + encodeURIComponent(v)); } catch {}
      $('#myAvatar').textContent = v[0].toUpperCase();
      $('#myAvatar').style.background = avatarGrad(v);
      $('#myHandle').textContent = v;
      updateMyProfile();
      resolve(v);
    };
    wireNameModal(go, input);
  });
}
function wireNameModal(go, input) {
  $('#nameGo').onclick = go;
  input.onkeydown = (e) => { if (e.key === 'Enter') go(); };
}
function updateMyProfile() {
  if (!meProfile) return;
  const p = meProfile;
  $('#myLvl').textContent = 'LV ' + p.lvl;
  $('#myXpBar').style.width = Math.round(p.progress.pct * 100) + '%';
  $('#myLoots').textContent = p.loots;
  $('#myUp').textContent = p.upvotes;
  $('#myXp').textContent = p.xp.toLocaleString();
  const known = BADGE_NAMES ? new Set(Object.keys(BADGE_NAMES)) : null;
  const all = [
    { id: 'first', name: 'First Drop' }, { id: 'ten', name: 'Certified' },
    { id: 'hopper', name: 'Hall Hopper' }, { id: 'legend', name: 'Legend Finder' },
    { id: 'mythic', name: 'Mythic Hunter' }, { id: 'magnet', name: 'Crowd Magnet' },
    { id: 'chatter', name: 'Chatterbox' }, { id: 'grinder', name: 'XP Grinder' },
  ];
  $('#myBadges').innerHTML = all
    .map((b) => `<span class="bchip ${p.earned.includes(b.id) ? 'on' : ''}"><span class="bd"></span>${b.name}</span>`)
    .join('');
}
async function refreshMe() {
  if (!me) return;
  const prev = meProfile?.earned || [];
  try {
    meProfile = await api('/api/me?looter=' + encodeURIComponent(me));
  } catch { return; }
  myCrew = new Set(meProfile.crew || []);
  $('#crewBadge').style.display = myCrew.size ? 'block' : 'none';
  $('#crewBadge').textContent = String(myCrew.size);
  const fresh = (meProfile.earned || []).filter((b) => !prev.includes(b));
  for (const b of fresh) {
    toast(`Badge unlocked: ${BADGE_NAMES[b] || b}`, 'badge', 4200);
  }
  updateMyProfile();
  renderCrew();
  if ($('#boardSide').classList.contains('on')) refreshBoard();
}

/* ------------------------- detail panel ------------------------- */
async function openLoot(id) {
  const l = loot.get(id);
  if (!l) return;
  openDetail = id;
  const r = RARITY[l.rarity] || RARITY[1];
  const d = $('#detail');
  d.style.setProperty('--rc', r.hex);
  const img = $('#dImg');
  const empty = $('#dEmpty');
  if (l.photo) {
    img.src = l.photo;
    img.hidden = false;
    empty.hidden = true;
  } else {
    img.hidden = true;
    empty.hidden = false;
  }
  $('#dHallText').textContent = 'Hall ' + l.hall;
  $('#dHall .fd').style.background = r.hex;
  $('#dRarity').textContent = r.name;
  $('#dItem').textContent = l.item;
  $('#dCo').innerHTML = `<b>${esc(l.company)}</b>${l.stand ? ' - Stand ' + esc(l.stand) : ''}`;
  const mine = me && l.looter === me;
  $('#dMeta').innerHTML =
    `<span>by ${esc(l.looter)}</span><span>${timeAgo(l.created)}</span>` +
    (mine ? `<button id="dDel" style="cursor:pointer;color:var(--c3);border-color:rgba(255,92,138,0.4);background:rgba(255,92,138,0.08);">delete</button>` : '');
  const del = $('#dDel');
  if (del) del.onclick = async () => {
    try {
      await api('/api/loot/' + l.id, { method: 'DELETE', body: JSON.stringify({ looter: me }) });
      loot.delete(l.id);
      renderMarkers();
      closeDetail();
      refreshMe();
      toast('Loot removed', 'okx');
    } catch (err) { toast(err.message, 'bad'); }
  };
  const up = $('#dUp');
  const voted = myVoted.has(id);
  up.classList.toggle('on', voted);
  up.querySelector('span').textContent = voted ? 'CLEANED' : 'CLEAN IT';
  $('#dUpN').textContent = String(l.upvotes);
  up.onclick = () => doUpvote(id, up);
  d.classList.add('on');

  detailComments = [];
  try {
    const c = await api('/api/loot/' + id + '/comments');
    detailComments = c.comments || [];
    renderComments();
  } catch {}
}
function renderComments() {
  const box = $('#dComments');
  if (!detailComments.length) {
    box.innerHTML = '<div class="cmt-empty">No comments yet - be the first to talk this loot up.</div>';
    return;
  }
  box.innerHTML = detailComments
    .map((c) => `<div class="cmt"><div class="who"><span>${esc(c.looter)}</span><time>${timeAgo(c.created)}</time></div><p>${esc(c.text)}</p></div>`)
    .join('');
}
$('#cmtInput').onkeydown = async (e) => {
  if (e.key !== 'Enter' || !openDetail) return;
  const text = e.target.value.trim();
  if (!text) return;
  const handle = me || (await getHandle());
  if (!handle) return;
  e.target.value = '';
  try {
    await api(`/api/loot/${openDetail}/comments`, {
      method: 'POST',
      body: JSON.stringify({ looter: handle, text }),
    });
    detailComments.unshift({ looter: handle, text, created: Date.now() });
    renderComments();
    refreshMe();
  } catch (err) { toast(err.message, 'bad'); }
};
async function doUpvote(id, btn) {
  const handle = me || (await getHandle());
  if (!handle) return;
  try {
    const nowOn = myVoted.has(id);
    const path = nowOn ? `/api/loot/${id}/upvote/remove` : `/api/loot/${id}/upvote`;
    const res = await api(path, { method: 'POST', body: JSON.stringify({ looter: handle }) });
    const l = loot.get(id);
    if (l) l.upvotes = res.total;
    if (res.upvoted) {
      myVoted.add(id);
      const rc = btn.getBoundingClientRect();
      burst(rc.left + rc.width / 2, rc.top + rc.height / 2, '#7c5cff');
    } else myVoted.delete(id);
    btn.classList.toggle('on', res.upvoted);
    btn.querySelector('span').textContent = res.upvoted ? 'CLEANED' : 'CLEAN IT';
    $('#dUpN').textContent = String(res.total);
    renderMarkers();
  } catch (err) { toast(err.message, 'bad'); }
}
function closeDetail() {
  openDetail = null;
  $('#detail').classList.remove('on');
}
$('#dClose').onclick = closeDetail;

/* ------------------------- filters (rarity, in the legend panel) ------------------------- */
$$('#stage .legend-items button').forEach((b) => {
  b.onclick = () => {
    $$('#stage .legend-items button').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    filter = b.dataset.f;
    renderMarkers();
  };
});

/* ------------------------- hall selector strip ------------------------- */
let hallFilter = 'all';
const hallStrip = $('#hallStrip');
function buildHallStrip() {
  const all = document.createElement('button');
  all.className = 'hs-all on';
  all.textContent = 'All halls';
  all.onclick = () => selectHall('all');
  hallStrip.appendChild(all);
  for (const h of HALLS) {
    const b = document.createElement('button');
    b.className = 'hs';
    b.dataset.h = h.id;
    b.textContent = 'H' + h.id;
    b.onclick = () => selectHall(h.id);
    hallStrip.appendChild(b);
  }
}
function selectHall(id) {
  hallFilter = id;
  $$('#hallStrip .hs, #hallStrip .hs-all').forEach((x) =>
    x.classList.toggle('on', (x.dataset.h || 'all') === id));
  if (id !== 'all') {
    const h = HALLS.find((x) => x.id === id);
    if (h) flyTo(h.x, h.y);
  } else {
    fitView(true);
  }
  renderMarkers();
}
buildHallStrip();

/* ------------------------- search ------------------------- */
const searchInput = $('#search');
const suggest = $('#suggest');
let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 2) {
    clearQueryFilter(); // keep whatever they typed; never clear the box on input
    suggest.classList.remove('on');
    return;
  }
  searchTimer = setTimeout(async () => {
    try {
      const d = await api('/api/search?q=' + encodeURIComponent(q));
      showSuggest(d, q);
    } catch {}
  }, 220);
});
searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim().length >= 2) suggest.classList.add('on');
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.searchwrap')) suggest.classList.remove('on');
});
function showSuggest(d, q) {
  const ql = q.toLowerCase();
  const has = d.companies.length + d.items.length + d.looters.length;
  if (!has) {
    suggest.classList.remove('on');
    applyQuery(q); // live map filter as they type
    return;
  }
  const row = (label, sub, fn, color) => {
    const el = document.createElement('div');
    el.className = 'row';
    el.innerHTML = `<span class="dot" style="background:${color}"></span><span>${esc(label)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}`;
    el.onclick = fn;
    return el;
  };
  suggest.innerHTML = '';
  if (d.companies.length) {
    suggest.appendChild(Object.assign(document.createElement('div'), { className: 'grp', textContent: 'Companies' }));
    for (const c of d.companies) suggest.appendChild(row(c, 'company', () => pickQuery(c), 'var(--accent2)'));
  }
  if (d.items.length) {
    suggest.appendChild(Object.assign(document.createElement('div'), { className: 'grp', textContent: 'Loot items' }));
    for (const c of d.items) suggest.appendChild(row(c, 'item', () => pickQuery(c), 'var(--c3)'));
  }
  if (d.looters.length) {
    suggest.appendChild(Object.assign(document.createElement('div'), { className: 'grp', textContent: 'Looters' }));
    for (const c of d.looters) suggest.appendChild(row(c, 'looter', () => pickQuery(c, c), 'var(--c5)'));
  }
  suggest.classList.add('on');
}
function pickQuery(label, sub) {
  suggest.classList.remove('on');
  applyQuery(label);
  const first = [...loot.values()].find((l) =>
    l.company.toLowerCase().includes(label.toLowerCase()) ||
    l.item.toLowerCase().includes(label.toLowerCase()) ||
    l.looter.toLowerCase().includes(label.toLowerCase()));
  if (first) flyTo(first.x, first.y);
}
function applyQuery(q) {
  query = q;
  renderMarkers();
  const pill = $('#queryPill');
  if (pill) pill.remove();
  if (!q) return;
  const n = visibleRecords().length;
  const el = document.createElement('div');
  el.id = 'queryPill';
  el.style.cssText = 'position:absolute;left:50%;top:14px;transform:translateX(-50%);z-index:26;background:rgba(9,9,16,0.85);border:1px solid var(--line-hi);border-radius:999px;padding:7px 14px;font-size:12px;display:flex;gap:8px;align-items:center;backdrop-filter:blur(8px);';
  el.innerHTML = `<span style="color:var(--muted)">filter:</span><b style="font-size:12.5px">${esc(q)}</b><span style="color:var(--faint)">${n}</span><button style="cursor:pointer;font-weight:800;color:var(--c3)">×</button>`;
  el.querySelector('button').onclick = hideQuery;
  $('#stage').appendChild(el);
}
function clearQueryFilter() {
  if (!query) return;
  query = '';
  const pill = $('#queryPill');
  if (pill) pill.remove();
  renderMarkers();
}
function hideQuery() {
  clearQueryFilter();
  searchInput.value = '';
}
function flyTo(fx, fy) {
  const r = vp.getBoundingClientRect();
  const wx = fx * MAP_W, wy = fy * MAP_H;
  view.k = Math.max(view.k, minK * 3);
  view.x = r.width / 2 - wx * view.k;
  view.y = r.height / 2 - wy * view.k;
  world.style.transition = 'transform 0.55s cubic-bezier(0.3,1,0.4,1)';
  applyView();
  setTimeout(() => (world.style.transition = ''), 580);
}

/* ------------------------- leaderboard ------------------------- */
$('#btnBoard').onclick = () => {
  $('#boardSide').classList.add('on');
  closeCrew();
  refreshBoard();
};
async function refreshBoard() {
  try {
    const d = await api('/api/leaderboard');
    renderBoard(d.top || []);
  } catch {}
}
function renderBoard(top) {
  const list = $('#lbList');
  if (!top.length) {
    list.innerHTML = '<div class="crew-empty">No looters yet.</div>';
    return;
  }
  list.innerHTML = top.map((p, i) => `
    <div class="lb ${me && p.handle === me ? 'me' : ''}">
      <div class="rank">${i + 1}</div>
      <div class="avatar" style="background:${avatarGrad(p.handle)}">${esc(p.handle[0].toUpperCase())}</div>
      <div class="info">
        <div class="h">${esc(p.handle)}${me && p.handle === me ? ' <span style="color:var(--accent2);font-size:10px">(you)</span>' : ''}</div>
        <div class="xp">${p.xp.toLocaleString()} xp - ${p.loots} loot - ${p.upvotes} ups</div>
      </div>
      <div class="lv">LV ${p.lvl}</div>
    </div>`).join('');
}
$$('[data-close]').forEach((b) => {
  b.onclick = () => document.getElementById(b.dataset.close).classList.remove('on');
});

/* ------------------------- crew ------------------------- */
function closeCrew() { $('#crewSide').classList.remove('on'); }
$('#btnCrew').onclick = () => {
  $('#crewSide').classList.add('on');
  $('#boardSide').classList.remove('on');
  renderCrew();
};
function renderCrew() {
  const box = $('#crewList');
  if (!meProfile) { box.innerHTML = '<div class="crew-empty">Pick your tag to manage a crew.</div>'; return; }
  const names = meProfile.crew || [];
  if (!names.length) {
    box.innerHTML = '<div class="crew-empty">No crew yet. Add a looter tag who is already on the map.</div>';
    return;
  }
  box.innerHTML = names.map((n) => `
    <div class="friend-row">
      <div class="avatar" style="background:${avatarGrad(n)}">${esc(n[0].toUpperCase())}</div>
      <div class="h">${esc(n)}</div>
      <button class="lv" data-rm="${esc(n)}" style="cursor:pointer">remove</button>
    </div>`).join('');
  $$('#crewList [data-rm]').forEach((b) => {
    b.onclick = async () => {
      try {
        await api('/api/crew', { method: 'POST', body: JSON.stringify({ me, friend: b.dataset.rm, rm: true }) });
        meProfile.crew = meProfile.crew.filter((c) => c !== b.dataset.rm);
        myCrew = new Set(meProfile.crew);
        $('#crewBadge').style.display = myCrew.size ? 'block' : 'none';
        $('#crewBadge').textContent = String(myCrew.size);
        renderCrew();
      } catch {}
    };
  });
}
$('#crewAdd').onclick = async () => {
  const v = $('#crewInput').value.toLowerCase().trim();
  if (v.length < 2) return;
  const handle = me || (await getHandle());
  if (!handle) return;
  try {
    const res = await api('/api/crew', { method: 'POST', body: JSON.stringify({ me: handle, friend: v }) });
    myCrew = new Set(res.crew);
    $('#crewBadge').style.display = myCrew.size ? 'block' : 'none';
    $('#crewBadge').textContent = String(myCrew.size);
    $('#crewInput').value = '';
    meProfile = meProfile || { crew: res.crew };
    meProfile.crew = res.crew;
    renderCrew();
    toast(`${v} joined your crew`, 'ok');
  } catch (err) {
    toast(err.message, 'bad');
  }
};

/* ------------------------- SSE live ------------------------- */
function connectSSE() {
  let es;
  const start = () => {
    es = new EventSource('/api/stream');
    es.onopen = () => $('#liveDot').classList.remove('stale');
    es.onerror = () => {
      $('#liveDot').classList.add('stale');
      es.close();
      setTimeout(start, 3000);
    };
    es.addEventListener('loot', (e) => {
      const d = JSON.parse(e.data);
      if (d.loot) {
        if (!loot.has(d.loot.id)) {
          loot.set(d.loot.id, { ...d.loot, _new: true });
          maxId = Math.max(maxId, d.loot.id);
          renderMarkers();
          if (d.loot.looter === me) refreshMe();
        }
      }
    });
    es.addEventListener('remove', (e) => {
      const d = JSON.parse(e.data);
      loot.delete(d.id);
      if (openDetail === d.id) closeDetail();
      renderMarkers();
      if (d.looter === me) refreshMe();
    });
    es.addEventListener('upvote', (e) => {
      const d = JSON.parse(e.data);
      const l = loot.get(d.id);
      if (l) { l.upvotes = d.total; renderMarkers(); }
      if (openDetail === d.id) $('#dUpN').textContent = String(d.total);
      if (me) refreshMeQuiet();
    });
    es.addEventListener('comment', (e) => {
      const d = JSON.parse(e.data);
      if (openDetail === d.id) openLoot(d.id);
      if (me) refreshMeQuiet();
    });
    es.addEventListener('crew', (e) => {
      if (me) refreshMe();
    });
  };
  start();
  async function refreshMeQuiet() {
    try {
      const prev = meProfile?.earned || [];
      meProfile = await api('/api/me?looter=' + encodeURIComponent(me));
      const fresh = (meProfile.earned || []).filter((b) => !prev.includes(b));
      for (const b of fresh) toast(`Badge unlocked: ${BADGE_NAMES[b] || b}`, 'badge', 4200);
      updateMyProfile();
    } catch {}
  }
}

/* ------------------------- boot ------------------------- */
async function boot() {
  fitView(false);
  // hall labels
  const hl = $('#hallLabels');
  for (const h of HALLS) {
    const s = document.createElement('div');
    s.className = 'hall-label';
    s.style.left = h.x * 100 + '%';
    s.style.top = h.y * 100 + '%';
    s.style.transform = 'translate(-50%,-50%) scale(var(--inv,1))';
    s.textContent = h.id;
    hl.appendChild(s);
  }
  const saved = localStorage.getItem('loot.handle');
  if (saved) {
    me = saved;
    try { meProfile = await api('/api/me?looter=' + encodeURIComponent(saved)); } catch {}
    if (meProfile) {
      $('#myAvatar').textContent = me[0].toUpperCase();
      $('#myAvatar').style.background = avatarGrad(me);
      $('#myHandle').textContent = me;
      myCrew = new Set(meProfile.crew || []);
      $('#crewBadge').style.display = myCrew.size ? 'block' : 'none';
      $('#crewBadge').textContent = String(myCrew.size);
      updateMyProfile();
      renderCrew();
    }
  } else {
    // no tag yet - claim one on first visit (drives leaderboard + crew)
    const modal = $('#nameModal');
    const input = $('#nameInput');
    const goFirst = async () => {
      const v = input.value.toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 24);
      if (v.length < 2) { input.focus(); input.placeholder = 'at least 2 chars'; return; }
      me = v;
      localStorage.setItem('loot.handle', v);
      modal.classList.remove('on');
      try { meProfile = await api('/api/me?looter=' + encodeURIComponent(v)); } catch {}
      $('#myAvatar').textContent = v[0].toUpperCase();
      $('#myAvatar').style.background = avatarGrad(v);
      $('#myHandle').textContent = v;
      myCrew = new Set((meProfile && meProfile.crew) || []);
      $('#crewBadge').style.display = myCrew.size ? 'block' : 'none';
      $('#crewBadge').textContent = String(myCrew.size);
      updateMyProfile();
      renderCrew();
    };
    modal.classList.add('on');
    input.value = '';
    wireNameModal(goFirst, input);
    setTimeout(() => input.focus(), 250);
  }
  try {
    const d = await api('/api/loot');
    for (const l of d.loot) {
      loot.set(l.id, l);
      maxId = Math.max(maxId, l.id);
    }
    renderMarkers();
  } catch {
    toast('Could not load loot map', 'bad');
  }
  connectSSE();
}
boot();
