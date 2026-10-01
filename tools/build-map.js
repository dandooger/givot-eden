// Turns the real OpenStreetMap data (data/map.json) into game data (map-data.js).
// Coordinates become meters around the settlement center (x = east, y = south).
const fs = require('fs');
const path = require('path');

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/map.json'), 'utf8'));
const nodes = {};
raw.elements.filter(e => e.type === 'node').forEach(n => (nodes[n.id] = n));
const ways = raw.elements.filter(e => e.type === 'way' && e.tags);

const LAT0 = 31.66055, LON0 = 35.01595;
const KX = Math.cos((LAT0 * Math.PI) / 180) * 111320, KY = 110540;
const proj = n => [Math.round((n.lon - LON0) * KX * 10) / 10, Math.round(-(n.lat - LAT0) * KY * 10) / 10];
const pts = w => w.nodes.map(id => nodes[id]).filter(Boolean).map(proj);

const HE = {
  Sinai: 'סיני', Nevo: 'נבו', Carmel: 'כרמל', Gilboa: 'גלבוע', Tabor: 'תבור', Barkan: 'ברקן',
  Lotem: 'לוטם', HaKidron: 'הקדרון', Hakidron: 'הקדרון', Hayarden: 'הירדן', Kedem: 'קדם',
  Hayarkon: 'הירקון', Sorek: 'שורק', Katlav: 'קטלב', Lachish: 'לכיש',
};
const heName = t => t['name:he'] || HE[t.name] || t.name || '';

// ---- areas ----
const areas = [];
for (const w of ways) {
  const t = w.tags;
  let kind = null;
  if (t.landuse === 'residential') kind = 'residential';
  else if (t.landuse === 'construction') kind = 'construction';
  else if (t.landuse === 'forest' || t.natural === 'wood') kind = 'forest';
  else if (t.landuse === 'farmland') kind = 'farmland';
  else if (t.natural === 'scrub') kind = 'scrub';
  else if (t.leisure === 'park') kind = 'park';
  if (kind) areas.push({ kind, p: pts(w) });
}
// forest relation (multipolygon) outer rings
for (const r of raw.elements.filter(e => e.type === 'relation' && e.tags && e.tags.landuse === 'forest')) {
  for (const m of r.members.filter(m => m.type === 'way' && m.role === 'outer')) {
    const w = raw.elements.find(e => e.type === 'way' && e.id === m.ref);
    if (w && w.nodes) areas.push({ kind: 'forest', p: pts(w) });
  }
}

// ---- roads ----
const ROADW = { tertiary: 9, unclassified: 7, residential: 7, service: 5, construction: 5, track: 3, footway: 2, steps: 2, path: 2 };
const roads = ways
  .filter(w => w.tags.highway && ROADW[w.tags.highway])
  .map(w => ({ id: w.id, kind: w.tags.highway, w: ROADW[w.tags.highway], name: w.tags.name ? heName(w.tags) : '', p: pts(w), n: w.nodes }));

// ---- road graph (for driving) ----
const drivable = roads.filter(r => !['footway', 'steps', 'path', 'track'].includes(r.kind) && !/גדר/.test(r.name));
const gNodes = {}; // osm node id -> [x,y]
const gEdges = {}; // id -> [[id, dist]]
for (const r of drivable) {
  for (let i = 0; i < r.n.length; i++) {
    const a = r.n[i];
    if (!nodes[a]) continue;
    gNodes[a] = proj(nodes[a]);
    if (i > 0 && nodes[r.n[i - 1]]) {
      const b = r.n[i - 1];
      const d = Math.hypot(gNodes[a][0] - proj(nodes[b])[0], gNodes[a][1] - proj(nodes[b])[1]);
      (gEdges[a] = gEdges[a] || []).push([b, Math.round(d)]);
      (gEdges[b] = gEdges[b] || []).push([a, Math.round(d)]);
    }
  }
}
// re-index graph nodes to small ints
const ids = Object.keys(gNodes);
const idx = {};
ids.forEach((id, i) => (idx[id] = i));
const graph = {
  p: ids.map(id => gNodes[id]),
  e: ids.map(id => (gEdges[id] || []).map(([b, d]) => [idx[b], d])),
};

// ---- buildings + house numbers ----
const area = p => { let s = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; s += x1 * y2 - x2 * y1; } return Math.abs(s / 2); };
const centroid = p => { const q = p.slice(0, -1).length ? p.slice(0, -1) : p; return [q.reduce((s, v) => s + v[0], 0) / q.length, q.reduce((s, v) => s + v[1], 0) / q.length]; };
function segDist(px, py, [x1, y1], [x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
  let t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy)), t };
}
const named = roads.filter(r => r.name && !['footway', 'steps', 'track'].includes(r.kind) && r.name !== 'גבעות עדן');
// the full chain of segments per street name, to measure "position along the street"
const streets = {};
for (const r of named) (streets[r.name] = streets[r.name] || []).push(r);

const buildings = ways.filter(w => w.tags.building).map(w => {
  const p = pts(w);
  const c = centroid(p);
  let best = { d: 1e9 };
  for (const r of named) {
    for (let i = 1; i < r.p.length; i++) {
      const s = segDist(c[0], c[1], r.p[i - 1], r.p[i]);
      if (s.d < best.d) {
        // side of street (cross product) -> odd/even like real streets
        const [x1, y1] = r.p[i - 1], [x2, y2] = r.p[i];
        const side = (x2 - x1) * (c[1] - y1) - (y2 - y1) * (c[0] - x1) > 0 ? 1 : 0;
        best = { d: s.d, street: r.name, along: 0, side, road: r, seg: i, t: s.t };
      }
    }
  }
  return { id: w.id, p, c: c.map(v => Math.round(v * 10) / 10), a: Math.round(area(p)), street: best.street, side: best.side, best, realNum: w.tags['addr:housenumber'] || null, realStreet: w.tags['addr:street'] ? heName({ name: w.tags['addr:street'] }) : null };
});
// position along street: project centroid on the street's main direction (first->last point of its longest way)
for (const [name, rs] of Object.entries(streets)) {
  const all = rs.flatMap(r => r.p);
  // direction = the two farthest points
  let A = all[0], B = all[0], far = 0;
  for (const p of all) for (const q of all) { const d = Math.hypot(p[0] - q[0], p[1] - q[1]); if (d > far) { far = d; A = p; B = q; } }
  // start numbering from the end closest to the entrance road (Sinai bus stop is north-west)
  const dir = [B[0] - A[0], B[1] - A[1]];
  const hs = buildings.filter(b => b.street === name);
  hs.forEach(b => (b.along = (b.c[0] - A[0]) * dir[0] + (b.c[1] - A[1]) * dir[1]));
  hs.sort((a, b) => a.along - b.along);
  let odd = 1, even = 2;
  for (const b of hs) { if (b.side) { b.num = odd; odd += 2; } else { b.num = even; even += 2; } }
}
// keep the one real address from the map
for (const b of buildings) if (b.realNum && b.realStreet) { b.street = b.realStreet; b.num = Number(b.realNum); }
// fix collisions after forcing the real number
const seen = {};
for (const b of buildings.sort((a, b) => (b.realNum ? 1 : 0) - (a.realNum ? 1 : 0))) {
  const key = b.street + b.num;
  if (seen[key]) { let n = b.num + 2; while (seen[b.street + n]) n += 2; b.num = n; }
  seen[b.street + b.num] = 1;
}

// ---- free plots for new buildings ----
const inPoly = (x, y, p) => { let ins = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
const buildable = areas.filter(a => a.kind === 'residential' || a.kind === 'construction' || a.kind === 'park');
const res = areas.find(a => a.kind === 'residential');
const cand = [];
for (let x = -400; x <= 400; x += 6) for (let y = -400; y <= 400; y += 6) {
  if (!buildable.some(a => inPoly(x, y, a.p))) continue;
  if (!inPoly(x, y, res.p) && !areas.some(a => a.kind === 'construction' && inPoly(x, y, a.p))) continue;
  let dB = 1e9;
  for (const b of buildings) for (const q of b.p) dB = Math.min(dB, Math.hypot(q[0] - x, q[1] - y));
  for (const b of buildings) if (inPoly(x, y, b.p)) dB = 0;
  if (dB < 17) continue;
  let dR = 1e9;
  for (const r of roads) for (let i = 1; i < r.p.length; i++) dR = Math.min(dR, segDist(x, y, r.p[i - 1], r.p[i]).d - r.w / 2);
  if (dR < 11 || dR > 45) continue; // next to a road, but not on it
  cand.push({ x, y, dR, dB });
}
// greedy: prefer spots close to roads, keep them apart
cand.sort((a, b) => a.dR - b.dR);
const plots = [];
for (const c of cand) {
  if (plots.every(p => Math.hypot(p.x - c.x, p.y - c.y) > 30)) plots.push({ x: c.x, y: c.y });
}

// bounds
const allP = [...buildings.flatMap(b => b.p), ...res.p];
const bounds = [Math.min(...allP.map(p => p[0])), Math.min(...allP.map(p => p[1])), Math.max(...allP.map(p => p[0])), Math.max(...allP.map(p => p[1]))];

// entrance: the bus stop "גבעות עדן כניסה"
const stopNode = raw.elements.find(e => e.type === 'node' && e.tags && e.tags.highway === 'bus_stop' && /כניסה/.test(e.tags.name || ''));
const stops = raw.elements.filter(e => e.type === 'node' && e.tags && e.tags.highway === 'bus_stop').map(n => ({ name: n.tags.name, p: proj(n) }));
const entrance = stopNode ? proj(stopNode) : null;

// exit: the far end of Sinai road, towards Tzur Hadassah
let exitNode = 0, exD = 1e9;
graph.p.forEach((p, i) => { const d = Math.hypot(p[0] + 300, p[1] + 988); if (d < exD) { exD = d; exitNode = i; } });

const out = {
  exitNode,
  source: '© OpenStreetMap contributors (ODbL)',
  bounds,
  areas: areas.map(a => ({ k: a.kind, p: a.p })),
  roads: roads.map(r => ({ k: r.kind, w: r.w, name: r.name, p: r.p })),
  buildings: buildings.map(b => ({ id: b.id, p: b.p, c: b.c, a: b.a, st: b.street || '', n: b.num || 0, real: !!b.realNum })),
  plots,
  graph,
  stops,
  entrance,
};
fs.writeFileSync(path.join(__dirname, '../map-data.js'), 'window.MAP=' + JSON.stringify(out) + ';\n');
console.log('areas', areas.length, 'roads', roads.length, 'buildings', buildings.length, 'plots', plots.length, 'graph nodes', graph.p.length, 'bounds', bounds.map(Math.round));
const byStreet = {};
buildings.forEach(b => (byStreet[b.street] = (byStreet[b.street] || 0) + 1));
console.log(byStreet, 'entrance', entrance, stops);
