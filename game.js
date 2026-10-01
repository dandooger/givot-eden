'use strict';
// ===================== basics =====================
const M = window.MAP, D = window.DATA;
const $ = s => document.querySelector(s);
const NS = 'http://www.w3.org/2000/svg';
const DAY = 1440, WEEK = 7 * DAY;
const SH_IN = 5 * DAY + 17 * 60 + 30;  // Friday 17:30 — candle lighting
const SH_OUT = 6 * DAY + 18 * 60 + 45; // Saturday 18:45 — havdalah
const SPEEDS = [1, 3, 8];             // game minutes per tick (4 ticks a second)
const SAVE_KEY = 'givot-eden-v1';
const TAX = [
  { name: 'נמוכה', rate: 700, mood: 5 },
  { name: 'רגילה', rate: 900, mood: 0 },
  { name: 'גבוהה', rate: 1200, mood: -7 },
];

const fmt = n => (n < 0 ? '-' : '') + '₪' + Math.abs(Math.round(n)).toLocaleString('en-US');
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hhmm = t => { const m = ((t % DAY) + DAY) % DAY; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const dayOf = t => Math.floor((t % WEEK) / DAY);
const minOf = t => t % DAY;
const isShabbat = t => { const w = t % WEEK; return w >= SH_IN && w < SH_OUT; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const bById = {};
M.buildings.forEach(b => (bById[b.id] = b));
const surname = b => D.surnames[b.id % D.surnames.length];
const addr = b => `רחוב ${b.st} ${b.n}`;
const [BX0, BY0, BX1, BY1] = M.bounds;

let S = null; // the saved game
const ui = { paused: false, busy: null, placing: null, picking: false, modal: false, mq: [], later: [], panel: null, tab: {}, silent: false, facId: null, away: false };
const g = (m, f) => (S && S.gender === 'f' ? f : m);

// ===================== state =====================
function newState(o) {
  return {
    v: 1, t: 7 * 60, gender: o.gender, name: o.name, spouse: o.spouse,
    kids: o.kids.map(k => ({ name: k.name, g: k.g, age: k.age, h: 70, played: -1 })),
    job: o.job, house: o.house,
    money: 500000, budget: 1500000, families: 136, boost: 0, tax: 1, fh: 70,
    car: null, items: [], built: [], done: [], speed: 0,
    stats: { workdays: 0, arvit: 0, prayers: 0, trips: 0 },
    workedDay: -1, shopWeek: -1, babyDue: 0, ba: { club: false, painted: false, camp: -99 }, funWeek: -1,
  };
}
const save = () => { try { if (S) localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} };
const load = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; } };

const today = () => Math.floor(S.t / DAY);
const weekNo = () => Math.floor(S.t / WEEK) + 1;
const has = type => S.built.some(b => b.type === type && b.done);
const findBuilt = type => S.built.find(b => b.type === type && b.done);
const job = () => D.jobs.find(j => j.id === S.job);
const car = () => D.cars.find(c => c.id === S.car);
const kidsHome = () => S.kids.filter(k => k.age < 18);
const famSize = () => 2 + kidsHome().length;
const capacity = () => M.buildings.length + 4 * S.built.filter(b => b.done && b.type === 'houses').length;
const famHappy = () => { const a = [S.fh, ...kidsHome().map(k => k.h)]; return Math.round(a.reduce((s, v) => s + v, 0) / a.length); };
const boostFam = n => { S.fh = clamp(S.fh + n, 0, 100); kidsHome().forEach(k => (k.h = clamp(k.h + n, 0, 100))); };
const boostTown = n => (S.boost = clamp(S.boost + n, -20, 25));
const myIcon = () => g('🚶', '🚶‍♀️');
const carIcon = () => ({ bike: '🛵', octavia: '🚙', carnival: '🚐', jeep: '🛻' }[S.car] || '🚗');
const kidIcon = k => k.age < 3 ? '👶' : k.age >= 18 ? '🪖' : k.g === 'b' ? (k.age < 13 ? '👦' : '🧑') : (k.age < 13 ? '👧' : '👩');

function happy() {
  let h = 36 + TAX[S.tax].mood + S.boost;
  const c = {};
  for (const b of S.built) if (b.done) {
    const n = (c[b.type] = (c[b.type] || 0) + 1);
    h += D.facilities[b.type].happy * (n === 1 ? 1 : n === 2 ? 0.4 : 0.15);
  }
  if (has('bneiakiva')) h += (S.ba.club ? 4 : 0) + (S.ba.painted ? 2 : 0);
  return clamp(Math.round(h), 0, 100);
}
function stars() {
  const f = S.built.filter(b => b.done && b.type !== 'houses').length, p = S.families;
  if (p >= 240 && f >= 18) return 5;
  if (p >= 200 && f >= 14) return 4;
  if (p >= 160 && f >= 9) return 3;
  if (p >= 140 && f >= 4) return 2;
  return 1;
}
const api = { get S() { return S; }, has, happy };

// ===================== svg map =====================
const svg = $('#map');
const L = {};
function mk(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(e);
  return e;
}
const pathD = (p, close) => 'M' + p.map(q => q[0] + ' ' + q[1]).join('L') + (close ? 'Z' : '');
const AREA = { forest: '#a9c98f', farmland: '#e6dea8', scrub: '#c4d6a0', residential: '#efe4cf', construction: 'url(#constr)', park: '#b5dc97' };
const ROOFS = ['#c8664a', '#d4785a', '#b95a40', '#cf6d4f', '#bf6a50'];

function buildMap() {
  svg.innerHTML = '';
  const defs = mk('defs', {}, svg);
  defs.innerHTML = `
    <pattern id="constr" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(30)"><rect width="9" height="9" fill="#e9dcc0"/><rect width="1.6" height="9" fill="#d6c6a3"/></pattern>
    <pattern id="stripes" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f3d27a"/><rect width="3" height="6" fill="#333" opacity=".22"/></pattern>`;
  mk('rect', { x: -6000, y: -6000, width: 12000, height: 12000, fill: '#cddbb0' }, svg);
  for (const n of ['areas', 'roads', 'bld', 'fac', 'plots', 'night', 'lights', 'labels', 'nums', 'actors', 'marks']) L[n] = mk('g', ['night', 'lights', 'labels', 'nums', 'actors'].includes(n) ? { 'pointer-events': 'none' } : {}, svg);

  const order = ['forest', 'farmland', 'scrub', 'residential', 'construction', 'park'];
  [...M.areas].sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k)).forEach(a =>
    mk('path', { d: pathD(a.p, true), fill: AREA[a.k], stroke: a.k === 'residential' ? '#d8c9a8' : 'none', 'stroke-width': 1 }, L.areas));

  const casing = mk('g', {}, L.roads), fill = mk('g', {}, L.roads);
  for (const r of M.roads) {
    if (r.k === 'track' || r.k === 'footway' || r.k === 'steps' || r.k === 'path') {
      mk('path', { d: pathD(r.p), fill: 'none', stroke: r.k === 'track' ? '#a8946f' : '#d9a184', 'stroke-width': r.k === 'track' ? 1.6 : 1.1, 'stroke-dasharray': '3 2', 'stroke-linecap': 'round' }, fill);
      continue;
    }
    mk('path', { d: pathD(r.p), fill: 'none', stroke: '#b5a789', 'stroke-width': r.w + 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, casing);
    mk('path', { d: pathD(r.p), fill: 'none', stroke: r.k === 'tertiary' ? '#fff1bf' : '#ffffff', 'stroke-width': r.w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, fill);
  }

  for (const b of M.buildings) {
    b.el = mk('path', { d: pathD(b.p, true), fill: ROOFS[b.id % ROOFS.length], stroke: '#8a4a32', 'stroke-width': 0.5, class: 'bld', 'data-b': b.id }, L.bld);
    mk('rect', { x: b.c[0] - 1.8, y: b.c[1] - 1.8, width: 3.6, height: 3.6, rx: 0.6, fill: '#ffd76a' }, L.lights);
    const t = mk('text', { x: b.c[0], y: b.c[1] + 1.6, 'font-size': 4.4, 'text-anchor': 'middle', fill: '#fff', 'font-weight': 700, stroke: '#7a3a22', 'stroke-width': 0.9, 'paint-order': 'stroke' }, L.nums);
    t.textContent = b.n;
  }
  L.night.appendChild(mk('rect', { x: -6000, y: -6000, width: 12000, height: 12000, fill: '#0b1a45', opacity: 0, id: 'nightRect' }));

  // street names, on the longest straight piece of each street
  const best = {};
  for (const r of M.roads) {
    if (!r.name || r.name === 'גבעות עדן' || /גדר/.test(r.name)) continue;
    for (let i = 1; i < r.p.length; i++) {
      const [a, b] = [r.p[i - 1], r.p[i]], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!best[r.name] || l > best[r.name].l) best[r.name] = { l, a, b };
    }
  }
  for (const [name, s] of Object.entries(best)) {
    let ang = (Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]) * 180) / Math.PI;
    if (ang > 90) ang -= 180;
    if (ang < -90) ang += 180;
    const x = (s.a[0] + s.b[0]) / 2, y = (s.a[1] + s.b[1]) / 2;
    const t = mk('text', { x, y: y + 2, 'font-size': 6.5, 'text-anchor': 'middle', fill: '#5a5040', stroke: '#fff', 'stroke-width': 2, 'paint-order': 'stroke', 'font-weight': 600, transform: `rotate(${ang} ${x} ${y})` }, L.labels);
    t.textContent = name;
  }
  // bus stops + entrance sign
  for (const s of M.stops) {
    const t = mk('text', { x: s.p[0], y: s.p[1], 'font-size': 9, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, L.labels);
    t.textContent = '🚏';
  }
  if (M.entrance) {
    const t = mk('text', { x: M.entrance[0] + 4, y: M.entrance[1] - 12, 'font-size': 11, 'text-anchor': 'middle', fill: '#2f6b3f', stroke: '#fff', 'stroke-width': 2.6, 'paint-order': 'stroke', 'font-weight': 800 }, L.labels);
    t.textContent = 'ברוכים הבאים לגבעות עדן';
  }
  L.flab = mk('g', {}, L.labels);
  L.lights.setAttribute('opacity', 0);
  L.flights = mk('g', {}, L.lights);
}

// ---------- view (pan / zoom) ----------
let vb = { x: 0, y: 0, w: 600, h: 600 };
function applyVB() {
  const r = svg.getBoundingClientRect();
  vb.h = vb.w * (r.height || 600) / (r.width || 800);
  svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  L.nums.style.display = vb.w < 340 ? '' : 'none';
  L.labels.style.display = vb.w < 1000 ? '' : 'none';
}
function fitView() {
  const r = svg.getBoundingClientRect(), asp = (r.width || 800) / (r.height || 600);
  let w = BX1 - BX0 + 30, h = BY1 - BY0 + 30;
  if (w / h < asp) w = h * asp;
  vb = { x: (BX0 + BX1) / 2 - w / 2, y: (BY0 + BY1) / 2 - (w / asp) / 2, w, h: w / asp };
  applyVB();
}
function centerOn(x, y, w) { vb.w = w || vb.w; applyVB(); vb.x = x - vb.w / 2; vb.y = y - vb.h / 2; applyVB(); }
function toSvg(cx, cy) { const r = svg.getBoundingClientRect(); return [vb.x + ((cx - r.left) / r.width) * vb.w, vb.y + ((cy - r.top) / r.height) * vb.h]; }
function zoomAt(f, px, py) {
  const nw = clamp(vb.w * f, 70, 1600), k = nw / vb.w;
  vb.x = px - (px - vb.x) * k; vb.y = py - (py - vb.y) * k; vb.w = nw;
  applyVB();
}
const ptrs = new Map();
let moved = 0, pinch = null, downTarget = null;
svg.addEventListener('pointerdown', e => {
  svg.setPointerCapture(e.pointerId);
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (ptrs.size === 1) { moved = 0; downTarget = e.target; }
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a.x - b.x, a.y - b.y); }
  svg.classList.add('drag');
});
svg.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  const r = svg.getBoundingClientRect();
  if (ptrs.size === 1) {
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    moved += Math.abs(dx) + Math.abs(dy);
    vb.x -= (dx * vb.w) / r.width; vb.y -= (dy * vb.h) / r.height;
    applyVB();
  }
  p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 2 && pinch) {
    const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), c = toSvg((a.x + b.x) / 2, (a.y + b.y) / 2);
    zoomAt(pinch / d, c[0], c[1]);
    pinch = d; moved += 20;
  }
});
const endPtr = e => {
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  if (ptrs.size === 0) { svg.classList.remove('drag'); if (moved < 8 && e.type === 'pointerup') mapClick(downTarget); }
};
svg.addEventListener('pointerup', endPtr);
svg.addEventListener('pointercancel', endPtr);
svg.addEventListener('wheel', e => { e.preventDefault(); const c = toSvg(e.clientX, e.clientY); zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, c[0], c[1]); }, { passive: false });
window.addEventListener('resize', () => applyVB());

function mapClick(target) {
  if (!target || !target.closest) return;
  const bEl = target.closest('[data-b]'), fEl = target.closest('[data-f]'), pEl = target.closest('[data-plot]');
  if (ui.picking) { if (bEl) pickHouse(+bEl.dataset.b); return; }
  if (ui.placing) { if (pEl) confirmPlace(+pEl.dataset.plot); else toast('צריך ללחוץ על אחד המגרשים הכחולים 👆', 'blue'); return; }
  if (fEl) { ui.facId = +fEl.dataset.f; openPanel('facility'); return; }
  if (bEl) {
    const b = bById[bEl.dataset.b];
    if (b.id === S.house) openPanel('home');
    else toast(`🏠 <b>${addr(b)}</b> — משפחת ${surname(b)}`, 'blue', [], 3500);
  }
}

// ---------- dynamic layers ----------
function paintHouses() {
  for (const b of M.buildings) {
    const mine = S && b.id === S.house, chosen = ui.picking && b.id === setupData.house;
    b.el.setAttribute('fill', chosen ? '#3d7bd9' : mine ? '#f2c14e' : ROOFS[b.id % ROOFS.length]);
    b.el.setAttribute('stroke', chosen ? '#173f7a' : mine ? '#9a6a08' : '#8a4a32');
    b.el.setAttribute('stroke-width', mine || chosen ? 1.6 : 0.5);
  }
}
function renderMarker() {
  L.marks.innerHTML = '';
  if (!S || ui.away) return;
  const b = bById[S.house];
  const gEl = mk('g', { transform: `translate(${b.c[0]} ${b.c[1] - 13})`, 'data-b': b.id, style: 'cursor:pointer' }, L.marks);
  const bob = mk('g', { class: 'bob' }, gEl);
  mk('path', { d: 'M-3 6 L0 11 L3 6 Z', fill: '#9a6a08' }, bob);
  mk('circle', { r: 7.5, fill: '#fff', stroke: '#e0a526', 'stroke-width': 1.6 }, bob);
  const t = mk('text', { 'font-size': 9.5, 'text-anchor': 'middle', 'dominant-baseline': 'central', y: 0.5 }, bob);
  t.textContent = g('👨', '👩');
}
function renderFacilities() {
  L.fac.innerHTML = ''; L.flab.innerHTML = ''; L.flights.innerHTML = '';
  for (const b of S.built) {
    const f = D.facilities[b.type], p = M.plots[b.plot];
    const gEl = mk('g', { transform: `translate(${p.x} ${p.y})`, 'data-f': b.id, class: 'fac' }, L.fac);
    if (!b.done) {
      mk('rect', { x: -10, y: -10, width: 20, height: 20, rx: 2, fill: 'url(#stripes)', stroke: '#a07d1c', 'stroke-width': 0.8 }, gEl);
      mk('rect', { x: -10, y: 11.5, width: 20, height: 2.6, rx: 1.2, fill: '#fff', stroke: '#a07d1c', 'stroke-width': 0.4 }, gEl);
      mk('rect', { x: -10, y: 11.5, width: (20 * b.prog) / b.need, height: 2.6, rx: 1.2, fill: '#3f8a52' }, gEl);
      const t = mk('text', { 'font-size': 11, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, gEl);
      t.textContent = '🏗️';
    } else if (b.type === 'houses') {
      for (const [dx, dy] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) mk('rect', { x: dx - 4, y: dy - 4, width: 8, height: 8, rx: 0.8, fill: '#d4785a', stroke: '#8a4a32', 'stroke-width': 0.5 }, gEl);
      for (const [dx, dy] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) mk('rect', { x: p.x + dx - 1.4, y: p.y + dy - 1.4, width: 2.8, height: 2.8, fill: '#ffd76a' }, L.flights);
    } else {
      mk('rect', { x: -10, y: -10, width: 20, height: 20, rx: 3, fill: f.color, stroke: '#00000055', 'stroke-width': 0.8 }, gEl);
      mk('rect', { x: -8, y: -8, width: 16, height: 16, rx: 2.4, fill: '#ffffff40' }, gEl);
      const t = mk('text', { 'font-size': 12, 'text-anchor': 'middle', 'dominant-baseline': 'central', y: 0.5 }, gEl);
      t.textContent = f.icon;
      if (b.type === 'bneiakiva') { // blue & white flag
        mk('rect', { x: 5, y: -15, width: 0.8, height: 9, fill: '#555' }, gEl);
        mk('rect', { x: 5.8, y: -15, width: 6, height: 4, fill: '#fff', stroke: '#3a6ea5', 'stroke-width': 0.4 }, gEl);
        mk('rect', { x: 5.8, y: -14, width: 6, height: 0.8, fill: '#3a6ea5' }, gEl);
        mk('rect', { x: 5.8, y: -12.2, width: 6, height: 0.8, fill: '#3a6ea5' }, gEl);
      }
      mk('rect', { x: p.x - 2, y: p.y - 9, width: 4, height: 2.5, fill: '#ffd76a' }, L.flights);
    }
    const lab = mk('text', { x: p.x, y: p.y + (b.done ? 16 : 19.5), 'font-size': 5.2, 'text-anchor': 'middle', fill: '#2b2a27', stroke: '#fff', 'stroke-width': 1.8, 'paint-order': 'stroke', 'font-weight': 700 }, L.flab);
    lab.textContent = f.name;
  }
}
const freePlots = () => M.plots.map((p, i) => i).filter(i => !S.built.some(b => b.plot === i));
function renderPlots(show) {
  L.plots.innerHTML = '';
  if (!show) return;
  for (const i of freePlots()) mk('rect', { x: M.plots[i].x - 10, y: M.plots[i].y - 10, width: 20, height: 20, rx: 3, class: 'plot', 'data-plot': i }, L.plots);
}
function updateNight() {
  if (!S) return;
  const m = minOf(S.t);
  const a = m < 300 ? 0.55 : m < 390 ? (0.55 * (390 - m)) / 90 : m < 1080 ? 0 : m < 1200 ? (0.55 * (m - 1080)) / 120 : 0.55;
  $('#nightRect').setAttribute('opacity', a.toFixed(3));
  L.lights.setAttribute('opacity', clamp(a * 2, 0, 1).toFixed(2));
}

// ===================== routes & driving =====================
const G = M.graph;
const mainSet = (() => {
  const seen = new Uint8Array(G.p.length), q = [M.exitNode];
  seen[M.exitNode] = 1;
  while (q.length) { const a = q.pop(); for (const [b] of G.e[a]) if (!seen[b]) { seen[b] = 1; q.push(b); } }
  return seen;
})();
const townNodes = G.p.map((p, i) => i).filter(i => mainSet[i] && G.p[i][0] > BX0 && G.p[i][0] < BX1 && G.p[i][1] > BY0 && G.p[i][1] < BY1);
function nearest(x, y) {
  let best = townNodes[0], bd = Infinity;
  for (const i of townNodes) { const d = (G.p[i][0] - x) ** 2 + (G.p[i][1] - y) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}
function dijkstra(a, b) {
  const n = G.p.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), done = new Uint8Array(n);
  dist[a] = 0;
  for (;;) {
    let u = -1, ud = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < ud) { ud = dist[i]; u = i; }
    if (u < 0 || u === b) break;
    done[u] = 1;
    for (const [v, w] of G.e[u]) if (ud + w < dist[v]) { dist[v] = ud + w; prev[v] = u; }
  }
  const path = [];
  for (let u = b; u >= 0; u = prev[u]) { path.push(u); if (u === a) break; }
  return path.reverse();
}
// from/to are [x,y]; to = null means "out of the settlement"
function route(from, to) {
  const a = nearest(from[0], from[1]), b = to ? nearest(to[0], to[1]) : M.exitNode;
  const pts = [from, ...dijkstra(a, b).map(i => G.p[i])];
  if (to) pts.push(to);
  return pts;
}
const homeXY = () => bById[S.house].c;
const facXY = b => [M.plots[b.plot].x, M.plots[b.plot].y];
const FIELDS = (() => { // the closest point of the farmland next to the settlement
  let best = [0, 300], bd = Infinity;
  for (const a of M.areas) if (a.k === 'farmland') for (const p of a.p) { const d = Math.hypot(p[0], p[1]); if (d < bd) { bd = d; best = p; } }
  return best;
})();
const CARAVAN = (() => { // temporary prayer place before there is a synagogue: the park closest to the center
  let best = [0, 0], bd = Infinity;
  for (const a of M.areas) if (a.k === 'park') { const c = [a.p.reduce((s, p) => s + p[0], 0) / a.p.length, a.p.reduce((s, p) => s + p[1], 0) / a.p.length]; const d = Math.hypot(c[0], c[1]); if (d < bd) { bd = d; best = c; } }
  return best;
})();

function makeActor(icon, size) {
  const gEl = mk('g', {}, L.actors);
  mk('ellipse', { rx: size * 0.42, ry: size * 0.16, cy: size * 0.38, fill: '#0003' }, gEl);
  const tx = mk('text', { 'font-size': size, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, gEl);
  tx.textContent = icon;
  return { gEl, tx };
}
function placeActor(a, pts, seg, d) {
  let i = 0, acc = 0;
  while (i < seg.length - 1 && acc + seg[i] < d) { acc += seg[i]; i++; }
  const p0 = pts[i], p1 = pts[i + 1] || pts[i], t = seg[i] ? clamp((d - acc) / seg[i], 0, 1) : 1;
  const x = p0[0] + (p1[0] - p0[0]) * t, y = p0[1] + (p1[1] - p0[1]) * t;
  a.gEl.setAttribute('transform', `translate(${x.toFixed(1)} ${y.toFixed(1)})`);
  if (Math.abs(p1[0] - p0[0]) > 0.5) a.tx.setAttribute('transform', `scale(${p1[0] > p0[0] ? -1 : 1} 1)`);
  return x < BX0 - 30 || x > BX1 + 30 || y < BY0 - 30 || y > BY1 + 30;
}
const segs = pts => pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
// Animates the player along a path; resolves when arrived.
function travel(pts, icon, speed = 80, size = 13) {
  return new Promise(res => {
    const a = makeActor(icon, size), seg = segs(pts), total = seg.reduce((s, v) => s + v, 0);
    let d = 0, last = performance.now();
    const frame = now => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      const out = placeActor(a, pts, seg, d);
      a.gEl.style.opacity = out ? 0.45 : 1;
      if (d >= total) { a.gEl.remove(); res(); return; }
      d += speed * (out ? 5 : 1) * dt;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

// ---------- neighbours walking and driving around ----------
const amb = [];
let ambLast = 0, ambSpawn = 0;
function ambTarget() {
  if (!S) return { w: 0, c: 0 };
  const m = minOf(S.t), sh = isShabbat(S.t);
  if (m < 6 * 60 || m > 22 * 60) return { w: 1, c: sh ? 0 : 1 };
  return sh ? { w: 14, c: 0 } : { w: 7, c: 4 };
}
function ambLoop(now) {
  const dt = Math.min(0.05, (now - ambLast) / 1000 || 0); ambLast = now;
  if (S && !ui.picking) {
    const tg = ambTarget(), sh = isShabbat(S.t);
    if (sh) for (const a of amb.filter(a => a.car)) { a.gEl.remove(); amb.splice(amb.indexOf(a), 1); }
    if (now > ambSpawn) {
      ambSpawn = now + 400;
      const w = amb.filter(a => !a.car).length, c = amb.filter(a => a.car).length;
      const wantCar = c < tg.c, wantWalk = w < tg.w;
      if (wantCar || wantWalk) {
        const isCar = wantCar && (!wantWalk || Math.random() < 0.4);
        const icon = isCar ? pick(['🚗', '🚙', '🚗', '🚐']) : pick(sh ? ['🚶', '🚶‍♀️', '👫', '👨‍👧', '🧒', '👪'] : ['🚶', '🚶‍♀️', '🧒', '🐕', '🚴', '👫']);
        const a = makeActor(icon, isCar ? 10 : 8.5);
        Object.assign(a, { car: isCar, speed: isCar ? 45 : 11 });
        ambRoute(a, pick(townNodes));
        amb.push(a);
      }
    }
    if (!ui.paused) for (const a of [...amb]) {
      a.d += a.speed * dt;
      placeActor(a, a.pts, a.seg, a.d);
      if (a.d >= a.total) {
        const tg2 = ambTarget(), n = amb.filter(x => x.car === a.car).length;
        if (n > (a.car ? tg2.c : tg2.w)) { a.gEl.remove(); amb.splice(amb.indexOf(a), 1); }
        else ambRoute(a, a.end);
      }
    }
  }
  requestAnimationFrame(ambLoop);
}
function ambRoute(a, from) {
  let to = pick(townNodes);
  for (let k = 0; k < 4 && Math.hypot(G.p[to][0] - G.p[from][0], G.p[to][1] - G.p[from][1]) > 260; k++) to = pick(townNodes);
  a.pts = dijkstra(from, to).map(i => G.p[i]);
  if (a.pts.length < 2) a.pts = [G.p[from], G.p[from]];
  a.seg = segs(a.pts); a.total = a.seg.reduce((s, v) => s + v, 0) || 1; a.d = 0; a.end = to;
}

// ===================== time =====================
function tick() {
  if (!S || ui.picking) return;
  if (!ui.paused && !ui.modal && !ui.busy && !ui.placing && !ui.panel) advance(SPEEDS[S.speed]);
  renderHud();
  updateNight();
}
function advance(n) {
  for (let i = 0; i < n; i++) { S.t++; minute(); if (ui.modal || ui.busy) break; }
}
function advanceSilent(n) {
  ui.silent = true;
  for (let i = 0; i < n; i++) { S.t++; minute(); }
  ui.silent = false;
  renderFacilities();
}
const notify = fn => (ui.silent ? ui.later.push(fn) : fn());
function flushLater() { const l = ui.later; ui.later = []; l.forEach(f => f()); }

function minute() {
  const d = dayOf(S.t), m = minOf(S.t), sh = isShabbat(S.t), live = !ui.silent;
  // building work (stops on Shabbat)
  if (!sh) for (const b of S.built) if (!b.done) {
    b.prog += S.job === 'builder' ? 1.25 : 1;
    if (b.prog >= b.need) finishBuild(b);
  }
  if (m === 0) daily();
  if (m % 60 === 0) { if (S.built.some(b => !b.done)) renderFacilities(); save(); }
  if (S.babyDue && S.t >= S.babyDue) birth();

  if (d <= 5) {
    if (m === 6 * 60 + 30 && live) toast('🌅 בוקר טוב! זה זמן <b>תפילת שחרית</b>', 'blue', [['🙏 ללכת להתפלל', () => goPray()], ['אחר כך', () => {}]]);
    if (m === 7 * 60 + 20 && live) schoolMorning();
  }
  if (d <= 4) {
    if (m === 8 * 60 && live && S.workedDay !== today()) toast(`${job().icon} 8:00 — זמן ללכת לעבודה!`, '', [['🚗 לצאת לעבודה', goWork], ['אחר כך', () => {}]]);
    if (m === 9 * 60 + 30 && Math.random() < 0.3) notify(randomEvent);
    if (m === 13 * 60 + 30 && live) toast('☀️ 13:30 — מניין <b>מנחה</b>', 'blue', [['🙏 ללכת', () => goPray()]], 5000);
    if (m === 19 * 60 + 30 && live) arvitPrompt();
  }
  if (d === 5) {
    if (m === 10 * 60 && live) fridayShopping();
    if (m === 16 * 60 + 30 && live) toast(`⏰ עוד שעה שבת! מתקלחים, מתלבשים יפה ושמים את האוכל ${S.items.includes('plata') ? 'על הפלטה ♨️' : '... רגע, אין לכם פלטה! (אפשר לקנות ב🏠)'}`, 'gold');
    if (m === 17 * 60 + 30) notify(shabbatIn);
    if (m === 20 * 60) notify(fridayMeal);
  }
  if (d === 6) {
    if (m === 8 * 60 + 30 && live) toast('🕍 שבת בבוקר — <b>תפילת שחרית</b> וקריאת התורה', 'blue', [['🙏 ללכת לבית הכנסת', () => goPray()]]);
    if (m === 12 * 60) notify(() => { boostFam(3); toast('🍲 סעודת שבת בצהריים — חמין חם עם כל המשפחה! 😊', 'gold'); });
    if (m === 16 * 60) notify(bneiAkivaShabbat);
    if (m === 18 * 60 + 45) notify(havdalah);
  }
  if (d === 0 && m === 6 * 60) weekly();
  if (m === 22 * 60 + 30 && live) toast('🌙 כבר 22:30... לילה טוב!', '', [['😴 ללכת לישון', sleep], ['עוד קצת', () => {}]]);
}

function daily() {
  boostTown(S.boost > 0 ? -1 : S.boost < 0 ? 1 : 0);
  S.fh = clamp(S.fh - 3, 0, 100);
  for (const k of S.kids) {
    const before = Math.floor(k.age);
    k.age += 1 / 14; // two weeks in the game = one year for the kids
    if (k.age < 18) k.h = clamp(k.h - 3, 0, 100);
    const now = Math.floor(k.age);
    if (now > before) notify(() => {
      if (now === 18) modal({ icon: '🪖', title: `${k.name} ${k.g === 'b' ? 'התגייס' : 'התגייסה'}!`, text: `${k.name} ${k.g === 'b' ? 'בן' : 'בת'} 18 ו${k.g === 'b' ? 'מתגייס לצה״ל' : 'מתחילה שירות'}. כל הכבוד! 🇮🇱 כולם גאים.` });
      else toast(`🎂 יום הולדת ${now} ל${k.name}! מזל טוב!`, 'gold');
    });
  }
  checkMissions();
}

function weekly() {
  const tax = S.families * TAX[S.tax].rate;
  let income = 0, upkeep = 0;
  for (const b of S.built) if (b.done) { income += D.facilities[b.type].income || 0; upkeep += D.facilities[b.type].upkeep || 0; }
  const budgetDelta = tax + income - upkeep;
  S.budget += budgetDelta;
  let home = 1200 + 450 * kidsHome().length;
  if (has('grocery')) home *= 0.9;
  if (S.items.includes('solar')) home -= 400;
  if (S.car) home += 250;
  S.money -= home;
  const h = happy(), cap = capacity();
  let moved = 0;
  if (h >= 55 && S.families < cap) moved = Math.min(cap - S.families, 1 + Math.floor((h - 55) / 12));
  else if (h < 35 && S.families > 100) moved = -1;
  S.families += moved;
  notify(() => modal({
    icon: '📊', title: `סיכום שבוע ${weekNo() - 1}`,
    html: `<div style="text-align:right">
      <div class="sect">🏛️ קופת היישוב</div>
      <div class="stat"><span>ארנונה מ-${S.families} משפחות</span><b>+${fmt(tax)}</b></div>
      ${income ? `<div class="stat"><span>הכנסות מעסקים</span><b>+${fmt(income)}</b></div>` : ''}
      ${upkeep ? `<div class="stat"><span>אחזקת מבנים</span><b>-${fmt(upkeep)}</b></div>` : ''}
      <div class="stat"><span>בקופה עכשיו</span><b>${fmt(S.budget)}</b></div>
      <div class="sect">💰 הכסף שלך</div>
      <div class="stat"><span>הוצאות הבית (אוכל, חשבונות${S.car ? ', דלק' : ''})</span><b>-${fmt(home)}</b></div>
      <div class="stat"><span>יש לך עכשיו</span><b>${fmt(S.money)}</b></div>
      <div class="sect">👨‍👩‍👧 היישוב</div>
      <div class="stat"><span>שמחה ביישוב</span><b>${h}%</b></div>
      <div class="stat"><span>${moved > 0 ? `🎉 ${moved} משפחות חדשות עברו ליישוב!` : moved < 0 ? '😢 משפחה אחת עזבה את היישוב' : S.families >= cap ? '🏘️ אין בתים פנויים — צריך לבנות שכונה חדשה!' : 'אף משפחה חדשה לא הגיעה (צריך יותר שמחה)'}</span><b>${S.families}</b></div>
      ${S.money < 0 ? '<div class="note red">😬 נגמר לך הכסף! צריך ללכת לעבודה.</div>' : ''}
      ${S.budget < 0 ? '<div class="note red">😬 הקופה של היישוב במינוס! אפשר להעלות ארנונה או לבנות עסקים.</div>' : ''}
    </div>`,
    buttons: [{ t: 'שבוע טוב! 👍' }],
  }));
  checkMissions();
}

// ===================== events =====================
function schoolMorning() {
  const kids = kidsHome().filter(k => k.age >= 3);
  if (!kids.length) return;
  const school = kids.filter(k => k.age >= 6);
  if (school.length && Math.random() < 0.3) {
    const k = pick(school), boy = k.g === 'b', inTown = has('school');
    modal({
      icon: '😱', title: `${k.name} ${boy ? 'איחר' : 'איחרה'} להסעה!`,
      text: `ההסעה ${inTown ? 'לבית הספר' : 'לבית הספר בצור הדסה'} כבר יצאה ו${k.name} ${boy ? 'עומד' : 'עומדת'} בפתח עם התיק... מה עושים?`,
      buttons: [
        { t: `🚗 להסיע ${boy ? 'אותו' : 'אותה'} ברכב`, fn: () => driveKid(k), disabled: !S.car || S.car === 'bike' ? 'אין לך רכב' : null },
        ...(inTown ? [{ t: '🚶 ללוות ברגל לבית הספר', fn: () => walkKid(k) }] : []),
        { t: `😴 ${boy ? 'שיישאר' : 'שתישאר'} בבית היום`, cls: 'sec', fn: () => { k.h = clamp(k.h + 3, 0, 100); S.fh = clamp(S.fh - 6, 0, 100); toast(`📞 המורה התקשרה לשאול איפה ${k.name}... 😬`, 'red'); } },
      ],
    });
  } else {
    const gan = kids.filter(k => k.age < 6).length;
    toast(`🎒 ${school.length ? 'הילדים יצאו לבית הספר' : ''}${school.length && gan ? ' ו' : ''}${gan ? 'הקטנים הלכו לגן' : ''} — יום טוב!`, '', [], 4000);
  }
}
async function driveKid(k) {
  if (busyCheck()) return;
  ui.busy = 'מסיע לבית הספר';
  const sc = findBuilt('school'), dest = sc ? facXY(sc) : null, pts = route(homeXY(), dest);
  ui.away = true; renderMarker();
  await travel(pts, carIcon(), 90);
  advanceSilent(sc ? 15 : 30);
  await travel([...pts].reverse(), carIcon(), 90);
  ui.away = false; renderMarker();
  k.h = clamp(k.h + 8, 0, 100); S.fh = clamp(S.fh + 2, 0, 100);
  ui.busy = null;
  toast(`🚗 ${k.name} ${k.g === 'b' ? 'הגיע' : 'הגיעה'} בזמן לבית הספר! ${k.g === 'b' ? 'הוא אמר' : 'היא אמרה'} תודה ❤️`, 'gold');
  flushLater();
}
async function walkKid(k) {
  if (busyCheck()) return;
  ui.busy = 'מלווה לבית הספר';
  const pts = route(homeXY(), facXY(findBuilt('school')));
  ui.away = true; renderMarker();
  await travel(pts, '👨‍👧', 35, 11);
  advanceSilent(20);
  await travel([...pts].reverse(), myIcon(), 40, 11);
  ui.away = false; renderMarker();
  k.h = clamp(k.h + 6, 0, 100);
  ui.busy = null;
  toast(`🚶 ליווית את ${k.name} לבית הספר. הספקתם לדבר בדרך 😊`, 'gold');
  flushLater();
}
function arvitPrompt() {
  const syn = has('synagogue');
  modal({
    icon: '🌙', title: 'השעה כבר 19:30!',
    text: `${g('צריך', 'צריכה')} ללכת לתפילת ערבית ${syn ? 'בבית הכנסת 🕍' : '— עוד אין בית כנסת ביישוב, אז מתפללים במניין בקרוואן הזמני בפארק'}.`,
    buttons: [{ t: '🚶 ללכת לתפילה', fn: () => goPray() }, { t: 'הפעם לא', cls: 'sec' }],
  });
}
function fridayShopping() {
  if (S.shopWeek === weekNo()) return;
  if (has('grocery')) toast('🛒 יום שישי! זמן לקנות אוכל לשבת', 'gold', [['🛒 לקנות במכולת (₪600)', () => shopForShabbat()]]);
  else toast('🛒 יום שישי! צריך לקנות אוכל לשבת — אין מכולת ביישוב, אז נוסעים לצור הדסה', 'gold', [['🛍️ לנסוע לקניות', () => goTrip('tzur')]]);
}
function shabbatIn() {
  modal({
    icon: '🕯️🕯️', title: 'יאללה, כניסת שבת!', cls: 'shabbat',
    text: `השעה 17:30 — מדליקים נרות. <b>שבת שלום!</b><br>בשבת לא נוסעים, לא עובדים, לא קונים ולא בונים — רק נחים, מתפללים ונהנים עם המשפחה.`,
    buttons: [{ t: `🕍 ללכת לקבלת שבת${has('synagogue') ? ' בבית הכנסת' : ''}`, fn: () => goPray() }, { t: '🏠 להישאר בבית', cls: 'sec' }],
  });
}
function fridayMeal() {
  let bonus = 4; const notes = [];
  if (S.items.includes('table')) bonus += 3; else notes.push('שולחן שבת גדול');
  if (S.items.includes('plata')) bonus += 3; else notes.push('פלטה (בלי פלטה האוכל קר 🥶)');
  if (S.shopWeek === weekNo()) bonus += 4; else notes.push('קניות לשבת ביום שישי');
  boostFam(bonus);
  toast(`🍷 <b>סעודת שבת!</b> קידוש, חלות, דגים ושירי שבת עם כל המשפחה. 😊 +${bonus}${notes.length ? `<br><small>מה היה משפר: ${notes.join(', ')}</small>` : ''}`, 'gold', [], 9000);
}
const BA_TOPICS = ['אהבת ארץ ישראל', 'עזרה לזולת', 'תורה ועבודה', 'גבורה ואומץ', 'חסד בשכונה', 'שמירה על הטבע', 'אחדות בעם ישראל', 'משחק מחנאות ענק', 'זרקורים בשטח'];
function bneiAkivaShabbat() {
  const mine = kidsHome().filter(k => k.age >= 9);
  if (!has('bneiakiva')) {
    if (mine.length) { mine.forEach(k => (k.h = clamp(k.h - 3, 0, 100))); toast('😕 שבת אחה״צ... ואין סניף בני עקיבא ביישוב! הילדים משתעממים. <b>כדאי להקים סניף</b> (🏗️ לבנות)', 'red', [], 9000); }
    return;
  }
  const n = Math.round(S.families * 1.1);
  mine.forEach(k => (k.h = clamp(k.h + 10, 0, 100)));
  boostTown(S.ba.club ? 3 : 1.5);
  modal({
    icon: '🔵⚪', title: 'זמן בני עקיבא!',
    text: `${n} חניכים מכל היישוב הגיעו לפעולה בסניף. נושא הפעולה היום: <b>${pick(BA_TOPICS)}</b>!${mine.length ? `<br>${mine.map(k => k.name).join(' ו')} ${mine.length > 1 ? 'רצו' : k1(mine[0], 'רץ', 'רצה')} לסניף עם החולצה הכחולה 💙` : ''}`,
    buttons: [{ t: 'איזה כיף! 💙' }, { t: '🚶 ללוות את הילדים לסניף', cls: 'sec', fn: () => walkTo(facXY(findBuilt('bneiakiva')), 30, () => { boostFam(2); toast('💙 ליווית את הילדים לסניף ושרתם יחד את ההמנון של בני עקיבא', 'gold'); }) }],
  });
}
const k1 = (k, m, f) => (k.g === 'b' ? m : f);
function havdalah() {
  modal({
    icon: '🍷🕯️', title: 'שבוע טוב!',
    text: 'השבת יצאה — עשינו הבדלה עם יין, בשמים ונר. עכשיו אפשר שוב לנסוע, לעבוד ולבנות!',
    buttons: [{ t: 'שבוע טוב! 🎶' }, ...(has('bneiakiva') ? [{ t: '🔥 לארגן קומזיץ של בני עקיבא', cls: 'sec', fn: kumzitz }] : [])],
  });
}
const EVENTS = [
  () => modal({ icon: '💸', title: 'מענק מהמועצה!', text: 'המועצה האזורית מטה יהודה העבירה מענק פיתוח לגבעות עדן. +₪60,000 לקופת היישוב!', buttons: [{ t: 'יש! 🎉', fn: () => (S.budget += 60000) }] }),
  () => modal({ icon: '⛈️', title: 'סערה!', text: 'רוח חזקה הפילה עמוד תאורה ברחוב. התיקון עלה ₪20,000 מהקופה.', buttons: [{ t: 'אוף... 😕', fn: () => (S.budget -= 20000) }] }),
  () => { const b = pick(M.buildings); modal({ icon: '🎉', title: 'בר מצווה ביישוב!', text: `משפחת ${surname(b)} מ${addr(b)} חוגגת בר מצווה, וכל היישוב מוזמן. ריקודים עד הלילה!`, buttons: [{ t: 'מזל טוב! 💃', fn: () => boostTown(2) }] }); },
  () => modal({ icon: '🐕', title: 'כלב חמוד ביישוב', text: 'כלב שובב מסתובב בין הבתים וכל הילדים רצים אחריו. מישהו צריך להוציא אותו לטיול! 😄', buttons: [{ t: '🦮 לקחת אותו לסיבוב', fn: () => { boostTown(1); boostFam(3); } }, { t: 'חמוד', cls: 'sec' }] }),
  () => modal({ icon: '❄️', title: 'שלג ירד ביישוב!', text: 'כל גבעות עדן לבנה! אין לימודים, והילדים בונים בובות שלג ועושים מלחמת כדורי שלג ⛄', buttons: [{ t: 'יאללה לצאת! ⛄', fn: () => boostFam(8) }] }),
  () => modal({ icon: '📰', title: 'כתבה בעיתון!', text: 'עיתון כתב כתבה על "היישוב הכי מתפתח במטה יהודה" — גבעות עדן! עוד משפחות רוצות לעבור לגור כאן.', buttons: [{ t: 'כמה כיף 😎', fn: () => { boostTown(3); if (S.families < capacity()) S.families++; } }] }),
  () => modal({
    icon: '🛝', title: 'בקשה מהתושבים', text: 'התושבים מבקשים לשפץ את השבילים והמדרכות ביישוב. זה יעלה ₪25,000 מהקופה. לאשר?',
    buttons: [{ t: '✅ לאשר', fn: () => { S.budget -= 25000; boostTown(4); toast('👏 התושבים מרוצים מהשיפוץ!', 'gold'); } }, { t: '❌ לא עכשיו', cls: 'sec', fn: () => boostTown(-2) }],
  }),
  () => modal({
    icon: '🚧', title: 'תלונה על חניה', text: 'תושבים מתלוננים שאין מספיק חניה ליד הבתים. לבנות חניון קטן ב-₪40,000?',
    buttons: [{ t: '✅ לבנות חניון', fn: () => { S.budget -= 40000; boostTown(4); } }, { t: '❌ לא', cls: 'sec', fn: () => boostTown(-3) }],
  }),
  () => modal({ icon: '🍲', title: 'חסד ביישוב', text: 'מתנדבים מהיישוב בישלו ארוחות למשפחה שנולד לה תינוק. איזו קהילה!', buttons: [{ t: '❤️', fn: () => boostTown(2) }] }),
  () => has('bneiakiva') ? modal({ icon: '🍋', title: 'דוכן לימונדה', text: 'חניכי בני עקיבא מכרו לימונדה ברחוב כדי לממן את המחנה. הם אספו ₪3,000 לסניף!', buttons: [{ t: 'כל הכבוד! 💙', fn: () => { S.budget += 3000; boostTown(1); } }] }) : null,
];
function randomEvent() { const e = pick(EVENTS); if (e() === null) EVENTS[0](); }

function birth() {
  S.babyDue = 0;
  const boy = Math.random() < 0.5, name = pick(boy ? D.boys : D.girls);
  const k = { name, g: boy ? 'b' : 'g', age: 0, h: 90, played: -1 };
  S.kids.push(k);
  boostFam(10); boostTown(1);
  notify(() => modal({
    icon: '👶🎉', title: `מזל טוב! ${boy ? 'נולד לכם בן' : 'נולדה לכם בת'}!`,
    text: `קוראים ${boy ? 'לו' : 'לה'} <b>${name}</b>. כל היישוב שולח מזל טוב, והשכנים כבר מביאים עוגות 🍰`,
    buttons: [{ t: 'מזל טוב! 🎉' }, { t: '✏️ לבחור שם אחר', cls: 'sec', fn: () => { const n = prompt('איך קוראים לתינוק/ת?', name); if (n && n.trim()) { k.name = n.trim().slice(0, 20); save(); toast(`👶 ${boy ? 'ברוך הבא' : 'ברוכה הבאה'} ${k.name}!`, 'gold'); } } }],
  }));
}

// ===================== player actions =====================
function busyCheck() {
  if (ui.busy) { toast(`⏳ רגע, ${g('אתה', 'את')} באמצע: ${ui.busy}`, 'red'); return true; }
  return false;
}
function dayTime() { const m = minOf(S.t); return { m, d: dayOf(S.t) }; }

function prayerName() {
  const { m, d } = dayTime();
  if (d === 5 && m >= 16 * 60) return 'קבלת שבת';
  if (d === 6 && m < 12 * 60) return 'תפילת שבת';
  if (m < 11 * 60) return 'שחרית';
  if (m < 18 * 60) return 'מנחה';
  return 'ערבית';
}
async function walkTo(dest, minutes, after) {
  if (busyCheck()) return;
  closePanel();
  ui.busy = 'בדרך';
  const pts = route(homeXY(), dest);
  ui.away = true; renderMarker();
  await travel(pts, myIcon(), 40, 11);
  advanceSilent(minutes);
  if (after) after();
  await travel([...pts].reverse(), myIcon(), 50, 11);
  ui.away = false; renderMarker();
  ui.busy = null;
  flushLater(); checkMissions(); save();
}
function goPray() {
  const syn = findBuilt('synagogue'), name = prayerName();
  walkTo(syn ? facXY(syn) : CARAVAN, 40, () => {
    S.stats.prayers++;
    if (name === 'ערבית') S.stats.arvit++;
    boostTown(syn ? 1.5 : 0.7); S.fh = clamp(S.fh + 2, 0, 100);
    toast(`🙏 התפללת <b>${name}</b> ${syn ? 'בבית הכנסת' : 'במניין בקרוואן'}.${syn ? '' : ' (עם בית כנסת אמיתי זה היה הרבה יותר נעים...)'}`, 'gold');
  });
}
function shopForShabbat() {
  if (S.shopWeek === weekNo()) return toast('✔️ כבר קניתם אוכל לשבת השבוע', 'blue');
  if (isShabbat(S.t)) return toast('🕯️ שבת! המכולת סגורה', 'red');
  if (S.money < 600) return toast('אין לך מספיק כסף 😬', 'red');
  walkTo(facXY(findBuilt('grocery')), 30, () => {
    S.money -= 600; S.shopWeek = weekNo();
    toast('🛒 קנית חלות, יין, דגים, עוף וממתקים לשבת! 🥖🍷', 'gold');
  });
}

function canWork() {
  const { m, d } = dayTime();
  if (isShabbat(S.t)) return '🕯️ שבת היום — לא עובדים!';
  if (d >= 5) return 'ביום שישי ובשבת לא עובדים 🙂 העבודה בימים ראשון–חמישי.';
  if (S.workedDay === today()) return `כבר ${g('עבדת', 'עבדת')} היום! מחר בבוקר שוב.`;
  if (m < 6 * 60) return 'מוקדם מדי — עוד לילה 🌙';
  if (m > 11 * 60) return 'מאוחר מדי ללכת לעבודה היום. מחר בבוקר!';
  return null;
}
async function goWork() {
  const why = canWork();
  if (why) return toast(why, 'red');
  if (busyCheck()) return;
  closePanel();
  const j = job(), late = minOf(S.t) > 9 * 60;
  let where = j.where;
  if (where === 'school') where = has('school') ? 'school' : 'out';
  const hasCar = !!S.car;
  S.workedDay = today();
  ui.busy = 'בדרך לעבודה'; ui.away = true; renderMarker();
  let back;
  if (where === 'out') {
    if (hasCar) { const pts = route(homeXY(), null); await travel(pts, carIcon(), 90 * car().speed); back = async () => travel([...pts].reverse(), carIcon(), 90 * car().speed); }
    else {
      const stop = M.entrance, w = route(homeXY(), stop), bus = route(stop, null);
      await travel(w, myIcon(), 40, 11); await travel(bus, '🚌', 70, 14);
      back = async () => { await travel([...bus].reverse(), '🚌', 70, 14); await travel([...w].reverse(), myIcon(), 40, 11); };
    }
  } else {
    const dest = where === 'school' ? facXY(findBuilt('school')) : FIELDS, pts = route(homeXY(), dest);
    await travel(pts, where === 'fields' ? '🚜' : myIcon(), where === 'fields' ? 50 : 40, 12);
    back = async () => travel([...pts].reverse(), myIcon(), 45, 11);
  }
  ui.busy = 'בעבודה';
  advanceSilent(9 * 60 + (where === 'out' && !hasCar ? 60 : 0));
  S.stats.workdays++;
  const raise = 1 + 0.05 * Math.floor((S.stats.workdays - 1) / 5);
  let pay = Math.round(j.pay * raise * (late ? 0.75 : 1)) - (where === 'out' && !hasCar ? 12 : 0);
  S.money += pay;
  S.fh = clamp(S.fh - 2, 0, 100);
  await back();
  ui.away = false; renderMarker(); ui.busy = null;
  modal({
    icon: j.icon, title: 'יום העבודה נגמר!',
    text: `${g('עבדת', 'עבדת')} כ${j.name} ב${where === 'school' ? 'בית הספר של היישוב' : j.place} ו${g('הרווחת', 'הרווחת')} <b>${fmt(pay)}</b>.${late ? '<br>😬 איחרת לעבודה, אז קיבלת פחות.' : ''}${where === 'out' && !hasCar ? '<br>🚌 נסעת באוטובוס (₪12) — עם רכב היית חוזר מהר יותר.' : ''}${S.stats.workdays % 5 === 0 ? '<br>📈 <b>קיבלת העלאה במשכורת!</b>' : ''}`,
    buttons: [{ t: '🏠 הביתה!' }],
  });
  flushLater(); checkMissions(); save();
}

function canTrip(tr) {
  const { m } = dayTime();
  if (isShabbat(S.t)) return '🕯️ בשבת לא נוסעים!';
  if (m < 6 * 60) return 'עוד לילה 🌙 — יוצאים בבוקר';
  if (m > 17 * 60 && tr.hours < 30) return 'מאוחר מדי לטיול היום — מחר בבוקר!';
  const dur = Math.round(tr.hours * 60 * (S.car ? 1 : 1.4));
  for (let x = S.t; x <= S.t + dur; x += 10) if (isShabbat(x)) return '🕯️ אי אפשר — לא תספיקו לחזור לפני כניסת שבת!';
  const cost = tr.cost + (!S.car && tr.bus ? 20 * famSize() : 0);
  if (S.money < cost) return 'אין לך מספיק כסף לטיול הזה 😬';
  if (tr.needCar === false) return null;
  const c = car();
  if (!c || c.seats < 2) return tr.bus ? null : 'צריך רכב בשביל הטיול הזה (אפשר לקנות ב🏠 הבית → רכבים)';
  if (c.seats < famSize()) return tr.bus ? null : `לא כולם נכנסים לרכב! ב${c.name} יש ${c.seats} מקומות ואתם ${famSize()}. צריך רכב גדול יותר 🚐`;
  return null;
}
async function goTrip(id) {
  const tr = D.trips.find(t => t.id === id), why = canTrip(tr);
  if (why) return toast(why, 'red');
  if (busyCheck()) return;
  closePanel();
  const c = car(), byCar = tr.needCar !== false && !!c && c.seats >= famSize();
  const byBus = tr.needCar !== false && !byCar;
  const cost = tr.cost + (byBus ? 20 * famSize() : 0);
  ui.busy = `טיול: ${tr.name}`; ui.away = true; renderMarker();
  let pts, icon, speed;
  if (tr.needCar === false) { pts = route(homeXY(), null); icon = kidsHome().length ? '👨‍👩‍👧' : '👫'; speed = 45; }
  else if (byCar) { pts = route(homeXY(), null); icon = carIcon(); speed = 90 * c.speed; }
  else { pts = [...route(homeXY(), M.entrance), ...route(M.entrance, null)]; icon = '🚌'; speed = 70; }
  await travel(pts, icon, speed, 13);
  advanceSilent(Math.round(tr.hours * 60 * (byBus ? 1.4 : 1)));
  S.money -= cost; S.stats.trips++;
  boostFam(tr.happy);
  if (id === 'tzur') S.shopWeek = weekNo();
  await travel([...pts].reverse(), icon, speed, 13);
  ui.away = false; renderMarker(); ui.busy = null;
  modal({ icon: tr.icon, title: tr.name, text: `${tr.text}${id === 'tzur' ? '<br>🛒 וגם קניתם אוכל לשבת!' : ''}<br><br>💰 ${fmt(cost)}${byBus ? ' (באוטובוס 🚌)' : ''} · 😊 המשפחה +${tr.happy}`, buttons: [{ t: 'היה כיף! 😄' }] });
  flushLater(); checkMissions(); save();
}

function sleep() {
  if (busyCheck()) return;
  const m = minOf(S.t);
  const wake = dayOf(S.t + (m >= 20 * 60 ? DAY : 0)) === 6 ? 7 * 60 : 6 * 60; // on Shabbat we sleep a bit more
  let add = m >= 20 * 60 ? DAY - m + wake : m < wake ? wake - m : 0;
  if (add <= 0) return toast('עוד לא לילה! 😄', 'blue');
  closePanel();
  advanceSilent(add);
  S.fh = clamp(S.fh + 2, 0, 100);
  toast(`☀️ בוקר טוב! השעה ${hhmm(S.t)} — יום ${D.days[dayOf(S.t)]}`, 'gold');
  flushLater(); save();
}
function kumzitz() {
  if (S.budget < 2000) return toast('אין מספיק כסף בקופה', 'red');
  if (isShabbat(S.t)) return toast('🕯️ מחכים לצאת השבת...', 'red');
  S.budget -= 2000; boostTown(2); kidsHome().forEach(k => (k.h = clamp(k.h + 6, 0, 100)));
  modal({ icon: '🔥', title: 'קומזיץ!', text: 'כל הסניף ישב סביב המדורה, שרו שירים עם גיטרה ואפו תפוחי אדמה בגחלים 🥔🎸', buttons: [{ t: 'איזה ערב! 🌟' }] });
}
function outing(type) {
  const O = OUTINGS[type], fac = S.built.find(b => b.id === ui.facId) || findBuilt(type);
  if (!kidsHome().length && O.kids) return toast('אין ילדים קטנים בבית 🙂', 'blue');
  if (isShabbat(S.t) && !O.shabbat) return toast('🕯️ שבת היום — זה סגור. אפשר ללכת לגן שעשועים או לגינה!', 'red');
  if (S.money < O.cost) return toast('אין לך מספיק כסף 😬', 'red');
  walkTo(facXY(fac), O.min, () => {
    S.money -= O.cost; boostFam(O.h);
    toast(`${D.facilities[type].icon} ${O.text} 😊 +${O.h}`, 'gold');
  });
}
const OUTINGS = {
  playground: { cost: 0, min: 60, h: 10, kids: true, shabbat: true, text: 'הילדים התנדנדו וגלשו עד שנגמר להם הכוח!' },
  garden: { cost: 0, min: 90, h: 7, shabbat: true, text: 'פיקניק על הדשא עם אבטיח ועוגה 🍉' },
  pizzeria: { cost: 250, min: 60, h: 9, text: 'פיצה עם זיתים ותירס — כולם שבעים ושמחים!' },
  pool: { cost: 120, min: 120, h: 11, text: 'קפצתם למים ועשיתם תחרות שחייה!' },
  football: { cost: 0, min: 60, h: 8, kids: true, text: 'משחק כדורגל משפחתי — ניצחתם 5:3! ⚽' },
  library: { cost: 0, min: 45, h: 5, text: 'כל אחד לקח ספר חדש הביתה 📚' },
  community: { cost: 200, min: 90, h: 7, kids: true, text: 'הילדים נהנו בחוג ציור ותיאטרון' },
  clinic: { cost: 0, min: 30, h: 2, text: 'הרופא בדק את כולם — כולם בריאים! 💪' },
  grocery: { cost: 40, min: 20, h: 5, kids: true, text: 'קנית לילדים ארטיקים 🍦' },
};

// ---------- building ----------
function startPlacing(type) {
  const f = D.facilities[type];
  if (isShabbat(S.t)) return toast('🕯️ בשבת לא בונים! מחכים למוצאי שבת.', 'red');
  if (S.budget < f.cost) return toast(`אין מספיק כסף בקופת היישוב 😬 צריך ${fmt(f.cost)}`, 'red');
  if (!freePlots().length) return toast('אין יותר מגרשים פנויים ביישוב!', 'red');
  closePanel();
  ui.placing = type;
  renderPlots(true);
  const ban = document.createElement('div');
  ban.id = 'banner';
  ban.innerHTML = `<span>${f.icon} ${g('בחר', 'בחרי')} מגרש פנוי (כחול) ל<b>${f.name}</b></span><button>ביטול</button>`;
  ban.querySelector('button').onclick = cancelPlacing;
  $('#game').appendChild(ban);
  fitView();
}
function cancelPlacing() {
  ui.placing = null;
  renderPlots(false);
  const b = $('#banner'); if (b) b.remove();
}
function confirmPlace(i) {
  const type = ui.placing, f = D.facilities[type];
  modal({
    icon: f.icon, title: `לבנות ${f.name} כאן?`,
    text: `💰 ${fmt(f.cost)} מקופת היישוב · ⏱️ ${f.days} ימי עבודה${S.job === 'builder' ? ' (מהר יותר כי את/ה קבלן!)' : ''}`,
    buttons: [{ t: '🏗️ כן, לבנות!', fn: () => {
      if (S.budget < f.cost) return toast('אין מספיק כסף בקופה', 'red');
      S.budget -= f.cost;
      S.built.push({ id: Date.now(), type, plot: i, prog: 0, need: f.days * DAY, done: false });
      cancelPlacing(); renderFacilities(); save();
      toast(`🚧 הפועלים התחילו לבנות ${f.name}! ${f.days} ימים וזה מוכן.`, 'gold');
    } }, { t: 'מגרש אחר', cls: 'sec' }],
  });
}
const OPENINGS = {
  synagogue: ['🕍📜', 'חנוכת בית הכנסת!', 'כל היישוב הגיע עם ספר תורה חדש, ריקודים ושירה ברחובות. מעכשיו מתפללים בבית כנסת אמיתי!'],
  bneiakiva: ['🔵⚪', 'סניף בני עקיבא נפתח!', 'הדגל הכחול-לבן מתנופף! כל ילדי היישוב מכיתה ד׳ ומעלה מוזמנים לפעולות בשבת. "במעלה הר ציון..." 🎶'],
  school: ['🏫🔔', 'בית הספר נפתח!', 'הצלצול הראשון! הילדים כבר לא צריכים הסעה לצור הדסה — הולכים ברגל לבית הספר.'],
  houses: ['🏘️🔑', 'שכונה חדשה מוכנה!', '4 בתים חדשים מחכים למשפחות. אם היישוב שמח (55%+), משפחות חדשות יעברו לגור בהם בסוף השבוע.'],
};
function finishBuild(b) {
  b.done = true;
  const f = D.facilities[b.type], first = S.built.filter(x => x.type === b.type && x.done).length === 1;
  boostTown(1);
  notify(() => {
    renderFacilities();
    if (first && OPENINGS[b.type]) { const [icon, title, text] = OPENINGS[b.type]; modal({ icon, title, text, buttons: [{ t: 'מזל טוב! 🎉' }] }); }
    else toast(`🎉 <b>${f.name}</b> ${f.name.startsWith('גן') || f.name.startsWith('בית') ? 'נפתח' : 'נפתח/ה'} ביישוב!`, 'gold');
    checkMissions();
  });
}

// ---------- missions ----------
function checkMissions() {
  if (!S) return;
  for (const m of D.missions) {
    if (S.done.includes(m.id) || !m.check(api)) continue;
    S.done.push(m.id);
    if (m.reward.budget) S.budget += m.reward.budget;
    if (m.reward.money) S.money += m.reward.money;
    toast(`🏆 <b>משימה הושלמה:</b> ${m.text}!<br>${m.reward.budget ? `🏛️ +${fmt(m.reward.budget)} לקופת היישוב` : `💰 +${fmt(m.reward.money)} לך`}`, 'gold', [], 8000);
  }
}

// ===================== UI: toasts, modal, hud =====================
function toast(html, cls = '', acts = [], ttl = 7000) {
  const box = $('#toasts'), t = document.createElement('div');
  t.className = 'toast ' + cls;
  t.innerHTML = html + (acts.length ? `<div class="acts">${acts.map((a, i) => `<button class="btn ${i ? 'sec' : ''}" data-i="${i}">${a[0]}</button>`).join('')}</div>` : '');
  acts.forEach((a, i) => (t.querySelector(`[data-i="${i}"]`).onclick = () => { t.remove(); a[1](); }));
  box.prepend(t);
  setTimeout(() => t.remove(), acts.length ? ttl * 1.7 : ttl);
  while (box.children.length > 4) box.lastChild.remove();
}
function modal(o) {
  if (ui.modal) { ui.mq.push(o); return; }
  ui.modal = true;
  const c = $('#mcard'), buttons = o.buttons || [{ t: 'סגור' }];
  c.className = 'mcard ' + (o.cls || '');
  c.innerHTML = `<div class="e">${o.icon || ''}</div><h3>${o.title}</h3>${o.text ? `<p>${o.text}</p>` : ''}${o.html || ''}
    <div class="acts">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}" ${b.disabled ? 'disabled' : ''}>${b.t}${b.disabled ? ` <small>(${b.disabled})</small>` : ''}</button>`).join('')}</div>`;
  $('#modal').classList.remove('hidden');
  c.querySelectorAll('[data-i]').forEach(btn => (btn.onclick = () => { const b = buttons[+btn.dataset.i]; closeModal(); if (b.fn) b.fn(); }));
}
function closeModal() {
  $('#modal').classList.add('hidden');
  ui.modal = false;
  if (ui.mq.length) setTimeout(() => modal(ui.mq.shift()), 180);
}

function initHud() {
  $('#hud').innerHTML = `
    <div class="pill" id="clock"><small id="hDay"></small><b id="hTime"></b></div>
    <div class="pill" id="speed"><button data-speed="p" title="עצירה">⏸</button><button data-speed="0" title="רגיל">▶</button><button data-speed="1" title="מהר">⏩</button><button data-speed="2" title="מהר מאוד">⏭</button></div>
    <div class="pill" data-go="town" title="קופת היישוב">🏛️ <span id="hBudget"></span><small>קופת היישוב</small></div>
    <div class="pill" data-go="home" title="הכסף שלך">💰 <span id="hMoney"></span><small>שלי</small></div>
    <div class="pill" data-go="town">👨‍👩‍👧 <span id="hFam"></span><small>משפחות</small></div>
    <div class="pill" data-go="town">😊 <span id="hHappy"></span></div>
    <div class="pill" data-go="town" id="hStars"></div>
    <div class="pill hidden" id="hBusy"></div>
    <div class="pill hidden" id="hSleep" data-act="sleep">😴 ללכת לישון</div>`;
  $('#hud').onclick = e => {
    const t = e.target.closest('[data-go],[data-speed],[data-act]');
    if (!t) return;
    if (t.dataset.go) openPanel(t.dataset.go);
    if (t.dataset.speed) { if (t.dataset.speed === 'p') ui.paused = !ui.paused; else { ui.paused = false; S.speed = +t.dataset.speed; } renderHud(); }
    if (t.dataset.act === 'sleep') sleep();
  };
}
function renderHud() {
  if (!S) return;
  const sh = isShabbat(S.t), m = minOf(S.t);
  $('#clock').classList.toggle('shabbat', sh);
  $('#hDay').textContent = `יום ${D.days[dayOf(S.t)]}${sh ? ' · שבת שלום 🕯️' : ''} · שבוע ${weekNo()}${ui.panel || ui.paused ? ' · ⏸' : ''}`;
  $('#hTime').textContent = hhmm(S.t);
  $('#hBudget').textContent = fmt(S.budget);
  $('#hMoney').textContent = fmt(S.money);
  $('#hFam').textContent = S.families;
  $('#hHappy').textContent = happy() + '%';
  $('#hStars').textContent = '⭐'.repeat(stars());
  $('#speed').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.speed === 'p' ? ui.paused : !ui.paused && +b.dataset.speed === S.speed));
  $('#hBusy').classList.toggle('hidden', !ui.busy);
  $('#hBusy').textContent = '⏳ ' + (ui.busy || '');
  $('#hSleep').classList.toggle('hidden', !(m >= 21 * 60 || m < 5 * 60) || !!ui.busy);
}

// ===================== panels =====================
const sheet = $('#sheet');
$('#sheetX').onclick = () => closePanel();
function openPanel(name) {
  if (!S || ui.picking) return;
  if (ui.placing) cancelPlacing();
  ui.panel = name;
  sheet.classList.remove('hidden');
  refreshPanel();
}
function closePanel() { ui.panel = null; sheet.classList.add('hidden'); }
function refreshPanel() {
  if (!ui.panel) return;
  const p = PANELS[ui.panel]();
  $('#sheetTitle').innerHTML = p.title;
  $('#sheetBody').innerHTML = p.html;
  renderHud();
}
$('#nav').onclick = e => { const b = e.target.closest('[data-p]'); if (b) (ui.panel === b.dataset.p ? closePanel() : openPanel(b.dataset.p)); };
$('#sheetBody').onclick = e => {
  const b = e.target.closest('[data-a]');
  if (!b || b.disabled) return;
  const [a, arg] = b.dataset.a.split(':');
  ACT[a](arg);
};
const item = (icon, title, sub, btn) => `<div class="item"><div class="ic">${icon}</div><div class="tx"><b>${title}</b><small>${sub}</small></div>${btn || ''}</div>`;
const tabs = (panel, list) => { const cur = ui.tab[panel] || list[0][0]; return `<div class="tabs">${list.map(([id, t]) => `<button data-a="tab:${panel}.${id}" class="${id === cur ? 'on' : ''}">${t}</button>`).join('')}</div>`; };
const bar = v => `<div class="bar"><i style="width:${clamp(v, 0, 100)}%;background:${v < 35 ? '#c8553d' : v < 60 ? '#e0a526' : '#3f8a52'}"></i></div>`;

const PANELS = {
  build() {
    const st = stars();
    let h = `<div class="note">🏛️ הכסף לבנייה יוצא מ<b>קופת היישוב</b>: ${fmt(S.budget)}<br>👷 כל מבנה נבנה כמה ימים. בשבת העבודות מושבתות 🕯️</div>`;
    for (const [id, f] of Object.entries(D.facilities)) {
      const cnt = S.built.filter(b => b.type === id).length, locked = (f.stars || 1) > st;
      h += item(f.icon, `${f.name}${cnt ? ` <span class="owned">(יש ${cnt})</span>` : ''}`,
        `${f.desc}<br>💰 ${fmt(f.cost)} · ⏱️ ${f.days} ימים${f.happy ? ` · 😊 +${f.happy}` : ''}${f.income ? ` · 📈 ${fmt(f.income)}/שבוע` : ''}${f.families ? ` · 🏠 +${f.families} משפחות` : ''}`,
        `<button data-a="build:${id}" ${locked ? 'disabled' : ''}>${locked ? '🔒 ' + '⭐'.repeat(f.stars) : 'לבנות'}</button>`);
    }
    return { title: '🏗️ לבנות ביישוב', html: h };
  },
  home() {
    const b = bById[S.house], tab = ui.tab.home || 'living';
    let h = `<div class="note">🏠 <b>${addr(b)}</b>, גבעות עדן · 💰 יש לך <b>${fmt(S.money)}</b>${isShabbat(S.t) ? '<br>🕯️ שבת — החנויות סגורות. אפשר רק להסתכל.' : ''}</div><div class="rooms">`;
    for (const [rid, rname] of Object.entries(D.rooms)) {
      if (rid === 'reno') continue;
      const things = D.shop.filter(i => i.room === rid && S.items.includes(i.id)).map(i => i.icon).join('');
      h += `<div class="room ${things ? '' : 'empty'}"><b>${rname}</b><div class="things">${things || '· · ·'}</div></div>`;
    }
    h += `<div class="room ${S.car ? '' : 'empty'}"><b>חניה</b><div class="things">${S.car ? car().icon : '· · ·'}</div></div></div>`;
    h += tabs('home', [...Object.entries(D.rooms), ['cars', '🚗 רכבים']]);
    if (tab === 'cars') {
      const cur = car();
      h += `<div class="note">${cur ? `יש לך <b>${cur.name}</b> (${cur.seats} מקומות). קונים רכב חדש — הישן נמכר בחצי מחיר.` : 'אין לך רכב עדיין. בלי רכב נוסעים לעבודה באוטובוס 🚌'}<br>👨‍👩‍👧 במשפחה שלך ${famSize()} אנשים.</div>`;
      for (const c of D.cars) h += item(c.icon, c.name, `💰 ${fmt(c.cost)} · 💺 ${c.seats} מקומות${c.seats < famSize() ? ' <span style="color:#c8553d">(קטן מדי לכל המשפחה)</span>' : ''}${c.electric ? ' · ⚡ חשמלי ומהיר' : ''}`,
        S.car === c.id ? '<span class="owned">✓ שלך</span>' : `<button data-a="car:${c.id}" ${S.money < c.cost - (cur ? cur.cost / 2 : 0) ? 'disabled' : ''}>לקנות</button>`);
    } else {
      for (const it of D.shop.filter(i => i.room === tab)) h += item(it.icon, it.name, `💰 ${fmt(it.cost)} · 😊 +${it.happy}${it.shabbat ? ' · 🕯️ משפר את השבת' : ''}${it.saves ? ` · חוסך ${fmt(it.saves)} בשבוע` : ''}`,
        S.items.includes(it.id) ? '<span class="owned">✓ יש</span>' : `<button data-a="buy:${it.id}" ${S.money < it.cost ? 'disabled' : ''}>לקנות</button>`);
    }
    return { title: `🏠 הבית של ${esc(S.name)}`, html: h };
  },
  family() {
    const j = job();
    let h = `<div class="note">❤️ שמחת המשפחה: <b>${famHappy()}%</b>${bar(famHappy())}<small>טיולים, משחקים עם הילדים, דברים לבית ושבת טובה משמחים את כולם.</small></div>`;
    h += item(g('👨', '👩'), `${esc(S.name)} — ${g('אבא', 'אמא')} ו${g('ראש', 'ראשת')} היישוב`, `${j.icon} ${j.name} · ${j.place}<br>💼 ${S.stats.workdays} ימי עבודה · 🙏 ${S.stats.prayers} תפילות`);
    h += item(g('👩', '👨'), `${esc(S.spouse)} — ${g('אמא', 'אבא')}`, `שמחה ${S.fh}%${bar(S.fh)}`);
    h += `<div class="sect">הילדים</div>`;
    if (!S.kids.length) h += '<div class="note">עוד אין ילדים...</div>';
    S.kids.forEach((k, i) => {
      const a = Math.floor(k.age), boy = k.g === 'b';
      let status;
      if (k.age >= 18) status = boy ? 'בצבא 🪖' : 'בשירות 🇮🇱';
      else if (k.age < 3) status = 'תינוק/ת בבית 🍼';
      else if (k.age < 6) status = has('kindergarten') ? 'בגן ביישוב 🧸' : 'בגן בצור הדסה 🧸';
      else status = `כיתה ${'אבגדהוזחטיאיב'.split('')[clamp(a - 6, 0, 11)] || ''}׳ ${has('school') && k.age < 12 ? 'בבית הספר ביישוב' : 'בצור הדסה'} 🎒`;
      if (has('bneiakiva') && k.age >= 9 && k.age < 15) status += ` · 🔵 ${boy ? 'חניך' : 'חניכה'} בבני עקיבא`;
      if (has('bneiakiva') && k.age >= 15 && k.age < 18) status += ` · 🔵 ${boy ? 'מדריך' : 'מדריכה'} בבני עקיבא`;
      h += item(kidIcon(k), `${esc(k.name)} · גיל ${a}`, `${status}${k.age < 18 ? `<br>שמחה ${k.h}%${bar(k.h)}` : ''}`,
        k.age < 18 && k.age >= 1 ? `<button data-a="play:${i}" ${k.played === today() ? 'disabled' : ''}>${k.played === today() ? '✓ שיחקתם' : '🎲 לשחק'}</button>` : '');
    });
    h += S.babyDue ? `<div class="note">🤰 תינוק/ת בדרך! עוד ${Math.ceil((S.babyDue - S.t) / DAY)} ימים</div>` : `<button class="btn" style="width:100%;padding:12px" data-a="baby">👶 רוצים עוד ילד/ה</button>`;
    return { title: '👨‍👩‍👧 המשפחה שלי', html: h };
  },
  drive() {
    const j = job(), sh = isShabbat(S.t), why = canWork(), c = car();
    let h = sh ? '<div class="note" style="background:#efe6ff;border-color:#cdb4f0">🕯️ <b>שבת!</b> בשבת לא נוסעים. אפשר ללכת ברגל לבית הכנסת, לגן השעשועים ולבני עקיבא.</div>' : '';
    h += `<div class="note">${c ? `${c.icon} יש לך ${c.name} (${c.seats} מקומות)` : '🚌 אין לך רכב — נוסעים באוטובוס מהתחנה בכניסה ליישוב. (רכב קונים ב🏠 הבית)'}</div>`;
    h += `<div class="sect">💼 עבודה</div>`;
    h += item(j.icon, `לנסוע לעבודה — ${j.name}`, `${j.place} · ${fmt(j.pay)} ליום${j.perk ? `<br>✨ ${j.perk}` : ''}${why ? `<br><span style="color:#c8553d">${why}</span>` : ''}`, `<button data-a="work" ${why ? 'disabled' : ''}>לצאת</button>`);
    h += `<div class="sect">🙏 תפילה</div>`;
    h += item('🕍', `ללכת ל${prayerName()}`, has('synagogue') ? 'בבית הכנסת של היישוב' : 'אין עדיין בית כנסת — מתפללים בקרוואן בפארק', '<button data-a="pray">ללכת</button>');
    h += `<div class="sect">🗺️ טיולים מחוץ ליישוב</div>`;
    for (const t of D.trips) {
      const w = canTrip(t);
      h += item(t.icon, t.name, `💰 ${t.cost ? fmt(t.cost) : 'חינם'} · ⏱️ ${t.hours >= 24 ? Math.round(t.hours / 24) + ' ימים' : t.hours + ' שעות'} · 😊 +${t.happy}${t.needCar === false ? ' · 🥾 ברגל' : !c && t.bus ? ' · 🚌 אפשר באוטובוס' : ''}${w ? `<br><span style="color:#c8553d">${w}</span>` : ''}`, `<button data-a="trip:${t.id}" ${w ? 'disabled' : ''}>לצאת</button>`);
    }
    return { title: '🚗 לצאת מהבית', html: h };
  },
  town() {
    const h0 = happy(), cap = capacity();
    const keys = ['synagogue', 'grocery', 'playground', 'kindergarten', 'school', 'bneiakiva', 'clinic', 'mikveh'];
    const missing = keys.filter(k => !has(k));
    let h = `<div class="note">${'⭐'.repeat(stars())} <b>גבעות עדן</b> — ${g('ראש', 'ראשת')} היישוב: ${esc(S.name)}</div>`;
    h += `<div class="stat"><span>👨‍👩‍👧 משפחות</span><b>${S.families} / ${cap}</b></div>
      <div class="stat"><span>🧍 תושבים (בערך)</span><b>${S.families * 5}</b></div>
      <div class="stat"><span>😊 שמחה ביישוב</span><b>${h0}%</b></div>${bar(h0)}
      <div class="stat"><span>🏛️ קופת היישוב</span><b>${fmt(S.budget)}</b></div>
      <div class="stat"><span>📈 הכנסה צפויה בשבוע</span><b>${fmt(S.families * TAX[S.tax].rate + S.built.filter(b => b.done).reduce((s, b) => s + (D.facilities[b.type].income || 0) - (D.facilities[b.type].upkeep || 0), 0))}</b></div>`;
    if (S.families >= cap) h += '<div class="note red">🏘️ כל הבתים מלאים! כדי שעוד משפחות יגיעו — לבנות <b>שכונה חדשה</b>.</div>';
    else if (h0 < 55) h += '<div class="note">💡 משפחות חדשות מגיעות רק כשהשמחה ביישוב 55% ומעלה.</div>';
    if (missing.length) h += `<div class="sect">❗ מה חסר ביישוב</div><div class="note">${missing.map(k => `${D.facilities[k].icon} ${D.facilities[k].name}`).join(' · ')}</div>`;
    h += `<div class="sect">💸 ארנונה (מס שכל משפחה משלמת)</div><div class="tabs">${TAX.map((t, i) => `<button data-a="tax:${i}" class="${S.tax === i ? 'on' : ''}">${t.name} (${fmt(t.rate)})</button>`).join('')}</div><small style="color:#6f6a60">ארנונה נמוכה = תושבים שמחים יותר אבל פחות כסף בקופה.</small>`;
    h += `<div class="sect">🎉 אירוע קהילתי</div>` + item('🎪', 'יום כיף ליישוב', 'מתנפחים, דוכנים והופעה! 💰 ₪30,000 מהקופה · 😊 +6 · פעם בשבוע', `<button data-a="fun" ${S.funWeek === weekNo() ? 'disabled' : ''}>${S.funWeek === weekNo() ? '✓ היה השבוע' : 'לארגן'}</button>`);
    const list = S.built.map(b => item(D.facilities[b.type].icon, D.facilities[b.type].name, b.done ? '✅ פתוח' : `🏗️ בבנייה — ${Math.floor((100 * b.prog) / b.need)}%`, `<button class="btn sec" data-a="fac:${b.id}">פרטים</button>`)).join('');
    h += `<div class="sect">🏢 מבנים שבנית (${S.built.length})</div>${list || '<div class="note">עוד לא בנית כלום. לחץ 🏗️ לבנות!</div>'}`;
    return { title: '🏛️ היישוב', html: h };
  },
  missions() {
    const done = D.missions.filter(m => S.done.includes(m.id)).length;
    let h = `<div class="note">🏆 השלמת <b>${done}</b> מתוך ${D.missions.length} משימות</div>`;
    for (const m of D.missions) {
      const ok = S.done.includes(m.id);
      h += item(ok ? '✅' : m.icon, `<span style="${ok ? 'text-decoration:line-through;color:#6f6a60' : ''}">${m.text}</span>`, `פרס: ${m.reward.budget ? `🏛️ ${fmt(m.reward.budget)} לקופה` : `💰 ${fmt(m.reward.money)} לך`}`);
    }
    return { title: '📋 משימות', html: h };
  },
  menu() {
    return {
      title: '⚙️ תפריט',
      html: `<div class="note"><b>איך משחקים?</b><br>
        🏗️ <b>לבנות</b> — בוחרים מבנה ואז מגרש כחול במפה.<br>
        🏠 <b>הבית</b> — קונים רהיטים ורכב (מהכסף שלך).<br>
        🚗 <b>לצאת</b> — עבודה, תפילה וטיולים.<br>
        👨‍👩‍👧 <b>משפחה</b> — משחקים עם הילדים ומביאים עוד ילדים.<br>
        ⏸ ▶ ⏩ ⏭ — מהירות הזמן. גוררים את המפה ומגדילים עם הגלגלת / שתי אצבעות.<br>
        🕯️ ביום שישי ב-17:30 נכנסת שבת — לא נוסעים, לא עובדים ולא בונים עד מוצאי שבת.</div>
        <div class="note">🗺️ המפה אמיתית — מ-OpenStreetMap (© OpenStreetMap contributors). מספרי הבתים לא רשומים במפה, אז מספרנו אותם לפי הסדר ברחוב.</div>
        <button class="btn" style="width:100%;padding:12px;margin-bottom:8px" data-a="save">💾 לשמור</button>
        <button class="btn sec" style="width:100%;padding:12px;margin-bottom:8px" data-a="home0">🎯 להראות את הבית שלי במפה</button>
        <button class="btn sec" style="width:100%;padding:12px;background:#fde8e2" data-a="reset">🔄 להתחיל משחק חדש</button>`,
    };
  },
  facility() {
    const b = S.built.find(x => x.id === ui.facId);
    if (!b) return { title: '', html: '' };
    const f = D.facilities[b.type];
    let h = `<div class="note">${f.desc}</div>`;
    if (!b.done) {
      h += `<div class="stat"><span>🏗️ בבנייה</span><b>${Math.floor((100 * b.prog) / b.need)}%</b></div>${bar((100 * b.prog) / b.need)}`;
      h += `<div class="note" style="margin-top:10px">⏱️ עוד בערך ${Math.ceil((b.need - b.prog) / DAY)} ימי עבודה${isShabbat(S.t) ? '<br>🛑 שבת — העבודות מושבתות' : ''}</div>`;
      return { title: `${f.icon} ${f.name}`, html: h };
    }
    if (f.income) h += `<div class="stat"><span>📈 מכניס לקופה</span><b>${fmt(f.income)}/שבוע</b></div>`;
    if (f.upkeep) h += `<div class="stat"><span>🔧 אחזקה</span><b>${fmt(f.upkeep)}/שבוע</b></div>`;
    h += '<div style="height:10px"></div>';
    if (b.type === 'synagogue') h += item('🙏', `להתפלל ${prayerName()}`, `התפללת ${S.stats.prayers} פעמים`, '<button data-a="pray">ללכת</button>');
    if (b.type === 'grocery') h += item('🛒', 'קניות לשבת', '₪600 · חלות, יין, דגים ועוף', `<button data-a="shop" ${S.shopWeek === weekNo() ? 'disabled' : ''}>${S.shopWeek === weekNo() ? '✓ קניתם' : 'לקנות'}</button>`);
    if (OUTINGS[b.type]) { const o = OUTINGS[b.type]; h += item(f.icon, { playground: 'לקחת את הילדים לשחק', garden: 'פיקניק משפחתי', pizzeria: 'ארוחה משפחתית', pool: 'לשחות עם המשפחה', football: 'לשחק כדורגל עם הילדים', library: 'לקחת ספרים', community: 'חוג לילדים', clinic: 'בדיקה אצל הרופא', grocery: 'גלידה לילדים' }[b.type], `${o.cost ? fmt(o.cost) : 'חינם'} · 😊 +${o.h}`, `<button data-a="out:${b.type}">יאללה</button>`); }
    if (b.type === 'school') h += `<div class="stat"><span>🎒 תלמידים</span><b>${Math.round(S.families * 1.6)}</b></div>`;
    if (b.type === 'houses') h += `<div class="stat"><span>🏠 בתים</span><b>4</b></div>`;
    if (b.type === 'bneiakiva') return PANELS.ba();
    return { title: `${f.icon} ${f.name}`, html: h };
  },
  ba() {
    const n = Math.round(S.families * 1.1), mine = kidsHome().filter(k => k.age >= 9), camp = today() - S.ba.camp < 14;
    let h = `<div class="note">💙 <b>סניף בני עקיבא גבעות עדן</b><br>"תורה ועבודה" — פעולות בכל שבת בשעה 16:00!</div>
      <div class="stat"><span>🧒 חניכים (ד׳–ט׳)</span><b>${n}</b></div>
      <div class="stat"><span>🧑 מדריכים (י׳–י״ב)</span><b>${Math.round(n / 8)}</b></div>
      <div class="stat"><span>👨‍👩‍👧 הילדים שלך בסניף</span><b>${mine.length ? mine.map(k => esc(k.name)).join(', ') : '—'}</b></div>
      <div class="sect">🎯 פעילויות ושדרוגים (מקופת היישוב)</div>`;
    h += item('🔥', 'קומזיץ', '₪2,000 · שירים סביב המדורה (לא בשבת)', '<button data-a="kumzitz">לארגן</button>');
    h += item('⛺', 'מחנה קיץ', `₪40,000 · 😊 +6 ליישוב, הילדים +15${camp ? '<br>היה מחנה לפני פחות משבועיים' : ''}`, `<button data-a="camp" ${camp ? 'disabled' : ''}>לצאת למחנה</button>`);
    h += item('🏠', 'מועדון חדש לסניף', '₪100,000 · הפעולות בשבת משמחות פי 2', S.ba.club ? '<span class="owned">✓ יש</span>' : '<button data-a="club">לבנות</button>');
    h += item('🎨', 'לצבוע את הסניף בכחול-לבן', '₪15,000 · 😊 +2', S.ba.painted ? '<span class="owned">✓ צבוע</span>' : '<button data-a="paint">לצבוע</button>');
    return { title: '🔵⚪ בני עקיבא', html: h };
  },
};

const ACT = {
  tab(arg) { const [p, id] = arg.split('.'); ui.tab[p] = id; refreshPanel(); },
  build: startPlacing,
  buy(id) {
    const it = D.shop.find(i => i.id === id);
    if (isShabbat(S.t)) return toast('🕯️ שבת — החנויות סגורות!', 'red');
    if (S.money < it.cost) return toast('אין לך מספיק כסף 😬', 'red');
    S.money -= it.cost; S.items.push(id); boostFam(it.happy);
    toast(`🛍️ ${g('קנית', 'קנית')} ${it.name}! ${it.icon}`, 'gold');
    checkMissions(); save(); refreshPanel();
  },
  car(id) {
    const c = D.cars.find(x => x.id === id), old = car(), price = c.cost - (old ? Math.round(old.cost / 2) : 0);
    if (isShabbat(S.t)) return toast('🕯️ שבת — הסוכנות סגורה!', 'red');
    if (S.money < price) return toast('אין לך מספיק כסף 😬', 'red');
    S.money -= price; S.car = id; boostFam(6);
    toast(`🔑 מזל טוב על ה${c.name} החדש! ${c.icon}${old ? `<br>מכרת את ה${old.name} ב-${fmt(old.cost / 2)}` : ''}`, 'gold');
    checkMissions(); save(); refreshPanel();
  },
  play(i) {
    const k = S.kids[+i];
    if (busyCheck()) return;
    k.played = today(); k.h = clamp(k.h + 12, 0, 100); S.fh = clamp(S.fh + 3, 0, 100);
    advanceSilent(45); flushLater();
    toast(`🎲 ${g('שיחקת', 'שיחקת')} עם ${k.name} ב${pick(k.age < 6 ? ['מחבואים', 'לגו', 'קוביות', 'תופסת'] : ['כדורגל בחצר', 'מונופול', 'קלפים', 'שחמט', 'תופסת', 'פלייסטיישן'])}! ${k.name} ${k.g === 'b' ? 'מאושר' : 'מאושרת'} 😄`, 'gold');
    save(); refreshPanel();
  },
  baby() { if (S.kids.length >= 12) return toast('וואו, כבר 12 ילדים! 😅', 'blue'); S.babyDue = S.t + 5 * DAY; toast('🤰 בשעה טובה! עוד 5 ימים התינוק/ת יגיעו 💕', 'gold'); save(); refreshPanel(); },
  work: () => goWork(),
  pray: () => goPray(),
  trip: id => goTrip(id),
  shop: () => shopForShabbat(),
  out: t => outing(t),
  fac(id) { ui.facId = +id; openPanel('facility'); },
  tax(i) { S.tax = +i; toast(`💸 ארנונה ${TAX[i].name} — ${fmt(TAX[i].rate)} למשפחה בשבוע`, 'blue'); save(); refreshPanel(); },
  fun() {
    if (isShabbat(S.t)) return toast('🕯️ לא בשבת!', 'red');
    if (S.budget < 30000) return toast('אין מספיק כסף בקופה', 'red');
    S.budget -= 30000; S.funWeek = weekNo(); boostTown(6); boostFam(5);
    modal({ icon: '🎪', title: 'יום כיף בגבעות עדן!', text: 'מתנפחים, צמר גפן מתוק, הופעה של זמר ומטווח מים. כל היישוב בחוץ! 🎈', buttons: [{ t: 'איזה כיף! 🎉' }] });
    refreshPanel();
  },
  kumzitz: () => kumzitz(),
  camp() {
    if (isShabbat(S.t)) return toast('🕯️ לא בשבת!', 'red');
    if (S.budget < 40000) return toast('אין מספיק כסף בקופה', 'red');
    S.budget -= 40000; S.ba.camp = today(); boostTown(6); kidsHome().filter(k => k.age >= 9).forEach(k => (k.h = clamp(k.h + 15, 0, 100)));
    modal({ icon: '⛺', title: 'מחנה קיץ של בני עקיבא!', text: 'שלושה ימים באוהלים: מסע לילה, בניית מגדל מחנאות, משחק לילה ושירה עד מאוחר. הילדים חזרו מלוכלכים ומאושרים! 🏕️', buttons: [{ t: 'מחנה אגדי! 💙' }] });
    refreshPanel();
  },
  club() { if (S.budget < 100000) return toast('אין מספיק כסף בקופה', 'red'); S.budget -= 100000; S.ba.club = true; toast('🏠 לסניף יש מועדון חדש!', 'gold'); refreshPanel(); },
  paint() { if (S.budget < 15000) return toast('אין מספיק כסף בקופה', 'red'); S.budget -= 15000; S.ba.painted = true; toast('🎨 הסניף צבוע בכחול-לבן!', 'gold'); refreshPanel(); },
  save() { save(); toast('💾 נשמר!', 'gold'); },
  home0() { closePanel(); const c = homeXY(); centerOn(c[0], c[1], 180); },
  reset() { if (confirm('בטוח? כל המשחק יימחק ונתחיל מההתחלה')) { localStorage.removeItem(SAVE_KEY); location.reload(); } },
};

// ===================== setup (new game) =====================
const setupData = { gender: 'm', name: '', spouse: '', kids: [], job: 'hitech', house: null };
function randKid() { const b = Math.random() < 0.5; return { name: pick(b ? D.boys : D.girls), g: b ? 'b' : 'g', age: 3 + Math.floor(Math.random() * 10) }; }
function renderSetup(step) {
  const w = $('#setupWrap'), steps = `<div class="steps">${[1, 2, 3, 4].map(i => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>`;
  const sd = setupData;
  if (step === 1) {
    w.innerHTML = `${steps}<h2>מי ${sd.gender === 'f' ? 'את' : 'אתה'} ביישוב?</h2><p class="sub">${sd.gender === 'f' ? 'את אמא, ואת גם ראשת היישוב!' : 'אתה אבא, ואתה גם ראש היישוב!'}</p>
      <div class="choices"><button class="choice ${sd.gender === 'm' ? 'sel' : ''}" data-g="m"><span class="e">👨</span>אבא</button><button class="choice ${sd.gender === 'f' ? 'sel' : ''}" data-g="f"><span class="e">👩</span>אמא</button></div>
      <label class="f">איך קוראים ${sd.gender === 'f' ? 'לך? (את)' : 'לך?'}</label><input class="t" id="inName" maxlength="20" value="${esc(sd.name)}" placeholder="השם שלך">
      <label class="f">ואיך קוראים ${sd.gender === 'f' ? 'לבעל שלך?' : 'לאשתך?'}</label><input class="t" id="inSpouse" maxlength="20" value="${esc(sd.spouse)}" placeholder="${sd.gender === 'f' ? 'למשל: יוסי' : 'למשל: מיכל'}">
      <button class="big" id="next">המשך ←</button>`;
    w.querySelectorAll('[data-g]').forEach(b => (b.onclick = () => { sd.name = $('#inName').value; sd.spouse = $('#inSpouse').value; sd.gender = b.dataset.g; renderSetup(1); }));
    $('#next').onclick = () => {
      sd.name = $('#inName').value.trim(); sd.spouse = $('#inSpouse').value.trim();
      if (!sd.name) return $('#inName').focus();
      if (!sd.spouse) sd.spouse = sd.gender === 'f' ? 'יוסי' : 'מיכל';
      if (!sd.kids.length) sd.kids = [randKid(), randKid()];
      renderSetup(2);
    };
  } else if (step === 2) {
    w.innerHTML = `${steps}<h2>הילדים 👨‍👩‍👧‍👦</h2><p class="sub">כמה ילדים יש לכם בהתחלה? (אפשר להביא עוד במשחק)</p>
      <div class="choices" style="grid-template-columns:repeat(6,1fr)">${[0, 1, 2, 3, 4, 5].map(n => `<button class="choice ${sd.kids.length === n ? 'sel' : ''}" data-n="${n}" style="padding:10px 4px;font-size:20px;font-weight:700">${n}</button>`).join('')}</div>
      <div id="kidRows">${sd.kids.map((k, i) => `<div class="kidrow"><input class="t" data-k="${i}" value="${esc(k.name)}" maxlength="20"><select class="t" data-kg="${i}"><option value="b" ${k.g === 'b' ? 'selected' : ''}>👦 בן</option><option value="g" ${k.g === 'g' ? 'selected' : ''}>👧 בת</option></select><select class="t" data-ka="${i}">${Array.from({ length: 16 }, (_, a) => `<option value="${a}" ${k.age === a ? 'selected' : ''}>גיל ${a}</option>`).join('')}</select></div>`).join('')}</div>
      <button class="big" id="next">המשך ←</button><button class="big alt" id="back">→ חזרה</button>`;
    const read = () => sd.kids.forEach((k, i) => { k.name = w.querySelector(`[data-k="${i}"]`).value.trim() || k.name; k.g = w.querySelector(`[data-kg="${i}"]`).value; k.age = +w.querySelector(`[data-ka="${i}"]`).value; });
    w.querySelectorAll('[data-n]').forEach(b => (b.onclick = () => { read(); const n = +b.dataset.n; while (sd.kids.length < n) sd.kids.push(randKid()); sd.kids.length = n; renderSetup(2); }));
    $('#next').onclick = () => { read(); renderSetup(3); };
    $('#back').onclick = () => { read(); renderSetup(1); };
  } else if (step === 3) {
    w.innerHTML = `${steps}<h2>במה ${sd.gender === 'f' ? 'את עובדת' : 'אתה עובד'}? 💼</h2><p class="sub">מהעבודה מרוויחים כסף לבית, לרכב ולטיולים</p>
      <div class="choices">${D.jobs.map(j => `<button class="choice ${sd.job === j.id ? 'sel' : ''}" data-j="${j.id}"><span class="e">${j.icon}</span>${j.name}<small>${j.place}<br>${fmt(j.pay)} ליום${j.perk ? `<br>✨ ${j.perk}` : ''}</small></button>`).join('')}</div>
      <button class="big" id="next">עכשיו לבחור בית ←</button><button class="big alt" id="back">→ חזרה</button>`;
    w.querySelectorAll('[data-j]').forEach(b => (b.onclick = () => { sd.job = b.dataset.j; renderSetup(3); }));
    $('#next').onclick = startPicking;
    $('#back').onclick = () => renderSetup(2);
  }
}
const streets = [...new Set(M.buildings.map(b => b.st).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he'));
function startPicking() {
  if (ui.picking) return;
  ui.picking = true;
  show('game');
  $('#hud').innerHTML = ''; $('#nav').classList.add('hidden');
  fitView(); paintHouses();
  const p = document.createElement('div');
  p.id = 'pick';
  p.innerHTML = `<div style="font-weight:800;font-size:18px;color:#2f6b3f;text-align:center">🏠 איפה ${setupData.gender === 'f' ? 'את גרה' : 'אתה גר'}?</div>
    <div style="text-align:center;color:#6f6a60;font-size:13px;margin:2px 0 8px">לחץ על הבית שלך במפה — או בחר רחוב ומספר</div>
    <div class="row"><select class="t" id="pSt"><option value="">רחוב...</option>${streets.map(s => `<option>${s}</option>`).join('')}</select><select class="t" id="pNum"><option value="">מספר...</option></select></div>
    <div class="chosen" id="pChosen"></div>
    <button class="big" id="pOk" disabled>🏠 זה הבית שלי!</button>
    <div style="font-size:11px;color:#6f6a60;margin-top:8px;text-align:center">💡 מספרי הבתים לא רשומים במפה הרשמית, אז מספרנו לפי הסדר ברחוב. אם המספר לא מדויק — פשוט לחץ על הבית שלך במפה!</div>`;
  $('#game').appendChild(p);
  const fillNums = st => { $('#pNum').innerHTML = '<option value="">מספר...</option>' + M.buildings.filter(b => b.st === st).sort((a, b) => a.n - b.n).map(b => `<option value="${b.id}">${b.n}</option>`).join(''); };
  $('#pSt').onchange = e => fillNums(e.target.value);
  $('#pNum').onchange = e => e.target.value && pickHouse(+e.target.value, true);
  $('#pOk').onclick = startGame;
}
function pickHouse(id, fromList) {
  setupData.house = id;
  const b = bById[id];
  paintHouses();
  $('#pChosen').textContent = `📍 ${addr(b)}`;
  $('#pOk').disabled = false;
  if (!fromList) { $('#pSt').value = b.st; $('#pSt').onchange({ target: $('#pSt') }); $('#pNum').value = id; }
  centerOn(b.c[0], b.c[1], Math.min(vb.w, 260));
}

// ===================== start =====================
function show(id) { ['start', 'setup', 'game'].forEach(s => $('#' + s).classList.toggle('hidden', s !== id)); }
function startGame() {
  S = newState(setupData);
  ui.picking = false;
  const p = $('#pick'); if (p) p.remove();
  enterGame();
  const c = homeXY();
  centerOn(c[0], c[1], 300);
  modal({
    icon: '🎉🏡', title: `${g('ברוך הבא', 'ברוכה הבאה')} לגבעות עדן!`,
    text: `${esc(S.name)}, מהיום ${g('אתה ראש', 'את ראשת')} היישוב! 🏛️<br><br>💰 יש לך <b>₪500,000</b> בכיס (לבית, לרכב ולטיולים)<br>🏛️ ובקופת היישוב <b>₪1,500,000</b> (לבנות ביישוב)<br><br>המטרה: לפתח את גבעות עדן! אולי להתחיל מ<b>בית כנסת</b> ו<b>מכולת</b>? 😉<br><small>הבית שלך מסומן בצהוב במפה.</small>`,
    buttons: [{ t: 'יאללה, מתחילים! 🚀' }],
  });
  save();
}
function enterGame() {
  show('game');
  $('#nav').classList.remove('hidden');
  initHud(); paintHouses(); renderFacilities(); renderMarker(); renderHud(); updateNight();
}

buildMap();
requestAnimationFrame(ambLoop);
setInterval(tick, 250);
const saved = load();
if (saved && saved.v === 1) $('#btnCont').classList.remove('hidden');
$('#btnCont').onclick = () => {
  S = load();
  enterGame();
  const c = homeXY();
  centerOn(c[0], c[1], 320);
  toast(`👋 ${g('ברוך השב', 'ברוכה השבה')}, ${esc(S.name)}!`, 'gold');
};
$('#btnNew').onclick = () => {
  if (saved && !confirm('יש משחק שמור. להתחיל משחק חדש? (השמור יימחק)')) return;
  show('setup'); renderSetup(1);
};

// ===================== install as an app =====================
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
let installEvt = null;
const standalone = matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone;
if (!standalone && location.protocol.startsWith('http')) $('#btnInstall').classList.remove('hidden');
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
$('#btnInstall').onclick = async () => {
  if (installEvt) { installEvt.prompt(); await installEvt.userChoice; installEvt = null; return; }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  modal({
    icon: '📲', title: 'להתקין את המשחק',
    text: ios ? 'בספארי: לוחצים על כפתור השיתוף <b>⬆️</b> למטה, ואז על <b>"הוסף למסך הבית"</b>.' : 'בכרום: לוחצים על <b>⋮</b> (שלוש הנקודות למעלה), ואז על <b>"התקנת אפליקציה"</b> או <b>"הוספה למסך הבית"</b>.',
    buttons: [{ t: 'הבנתי 👍' }],
  });
};
