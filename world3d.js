// The 3D world of Givot Eden: real terrain, real houses and streets, people, cars, controls and camera.
// Map coordinates: x = east (m), y = south (m). In 3D: X = x, Z = y, Y = height.
import * as THREE from './vendor/three.module.min.js';

const M = window.MAP, T = window.TERRAIN, D = window.DATA;
const MOBILE = matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad/i.test(navigator.userAgent);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
let seed = 20261001;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const rpick = a => a[Math.floor(rnd() * a.length)];

// ===================== terrain height =====================
const HB = (() => {
  const bin = atob(T.h), out = new Int16Array(bin.length / 2);
  for (let i = 0; i < out.length; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v & 0x8000) v -= 0x10000; out[i] = v; }
  return out;
})();
export function heightAt(x, z) {
  const gx = (x - T.x0) / T.step, gz = (z - T.y0) / T.step;
  const i = clamp(Math.floor(gx), 0, T.nx - 2), j = clamp(Math.floor(gz), 0, T.ny - 2);
  const fx = clamp(gx - i, 0, 1), fz = clamp(gz - j, 0, 1), h = (a, b) => HB[b * T.nx + a] / 10;
  return h(i, j) * (1 - fx) * (1 - fz) + h(i + 1, j) * fx * (1 - fz) + h(i, j + 1) * (1 - fx) * fz + h(i + 1, j + 1) * fx * fz;
}

// ===================== geometry helpers =====================
const inPoly = (x, y, p) => { let ins = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, yi] = p[i], [xj, yj] = p[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
const ring = p => (p.length > 2 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1] ? p.slice(0, -1) : p);
function segPoint(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? clamp(((px - a[0]) * dx + (py - a[1]) * dy) / L, 0, 1) : 0;
  const x = a[0] + t * dx, y = a[1] + t * dy;
  return { x, y, d: Math.hypot(px - x, py - y), dx, dy };
}
const CAR_ROADS = M.roads.filter(r => !['track', 'footway', 'steps', 'path'].includes(r.k) && !/גדר/.test(r.name));
function nearestRoad(x, y) {
  let best = { d: Infinity };
  for (const r of CAR_ROADS) for (let i = 1; i < r.p.length; i++) { const s = segPoint(x, y, r.p[i - 1], r.p[i]); if (s.d < best.d) best = { ...s, road: r }; }
  return best;
}
function minRect(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), c = Math.cos(ang), s = Math.sin(ang);
    let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
    for (const p of pts) { const u = p[0] * c + p[1] * s, v = -p[0] * s + p[1] * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, c, s, u0, u1, v0, v1 };
  }
  return best;
}
// pushes triangles of a hip roof over a rotated rectangle into arr (x,y,z triples)
function hipRoof(arr, R, y0, over, rhMax) {
  const { c, s } = R; let { u0, u1, v0, v1 } = R;
  u0 -= over; u1 += over; v0 -= over; v1 += over;
  const L = u1 - u0, W = v1 - v0, rh = Math.min(rhMax, Math.min(L, W) * 0.36);
  const P = (u, v, y) => [u * c - v * s, y, u * s + v * c];
  let A, B, C, Dd, R0, R1;
  A = P(u0, v0, y0); B = P(u1, v0, y0); C = P(u1, v1, y0); Dd = P(u0, v1, y0);
  if (L >= W) { const vm = (v0 + v1) / 2; R0 = P(u0 + W / 2, vm, y0 + rh); R1 = P(u1 - W / 2, vm, y0 + rh); }
  else { const um = (u0 + u1) / 2; R0 = P(um, v0 + L / 2, y0 + rh); R1 = P(um, v1 - L / 2, y0 + rh); }
  const tri = (a, b, d) => arr.push(...a, ...b, ...d);
  if (L >= W) { tri(A, B, R1); tri(A, R1, R0); tri(C, Dd, R0); tri(C, R0, R1); tri(Dd, A, R0); tri(B, C, R1); }
  else { tri(B, C, R1); tri(B, R1, R0); tri(Dd, A, R0); tri(Dd, R0, R1); tri(A, B, R0); tri(C, Dd, R1); }
  return 18;
}

// ===================== canvas textures =====================
function canvasTex(w, h, draw, opts = {}) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); draw(ctx, w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  return t;
}
const FONT = 'Rubik, "Segoe UI", Arial, sans-serif';
function signTex(lines, { bg = '#1f5fa8', fg = '#fff', w = 512, h = 256, icon = '', border = '#fff' } = {}) {
  return canvasTex(w, h, (x, W, H) => {
    x.fillStyle = border; roundRect(x, 0, 0, W, H, 26); x.fill();
    x.fillStyle = bg; roundRect(x, 8, 8, W - 16, H - 16, 20); x.fill();
    x.fillStyle = fg; x.textAlign = 'center'; x.textBaseline = 'middle'; x.direction = 'rtl';
    const n = lines.length, fs = Math.min(H / (n + (icon ? 1.2 : 0.4)), W / 6.2);
    let y = H / 2 - ((n - 1) * fs * 1.08 + (icon ? fs * 1.15 : 0)) / 2;
    if (icon) { x.font = `${fs * 1.05}px ${FONT}`; x.fillText(icon, W / 2, y); y += fs * 1.15; }
    lines.forEach((l, i) => { x.font = `${i ? 600 : 800} ${fs * (i ? 0.72 : 1)}px ${FONT}`; x.fillText(l, W / 2, y); y += fs * 1.08; });
  });
}
function roundRect(x, a, b, w, h, r) { x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
// a sign readable from both sides (two back-to-back planes)
function makeSign(lines, w, h, opts, backLines) {
  const g = new THREE.Group(), geo = new THREE.PlaneGeometry(w, h);
  const front = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: signTex(lines, opts), toneMapped: false }));
  const back = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: backLines ? signTex(backLines, opts) : front.material.map, toneMapped: false }));
  back.rotation.y = Math.PI; back.position.z = -0.01;
  g.add(front, back); g.material = front.material;
  return g;
}

// ===================== renderer / scene =====================
const canvas = document.getElementById('c3d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !MOBILE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, MOBILE ? 1.3 : 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = !MOBILE;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 3200);
scene.fog = new THREE.Fog(0xcfe6f7, 260, 1500);
const hemi = new THREE.HemisphereLight(0xeef5ff, 0xb59f74, 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3dd, 2.3);
sun.castShadow = !MOBILE;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 400 });
sun.shadow.bias = -0.0008;
scene.add(sun, sun.target);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

// sky dome with vertex colours
const skyGeo = new THREE.SphereGeometry(2800, 24, 12);
const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
skyGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
const sky = new THREE.Mesh(skyGeo, skyMat);
scene.add(sky);
const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(60, 24), new THREE.MeshBasicMaterial({ color: 0xfff1b8, fog: false, toneMapped: false }));
scene.add(sunDisc);

// ===================== ground =====================
const IN = { x0: -450, x1: 460, z0: -500, z1: 470 };
const OUT = { x0: -1300, x1: 1300, z0: -1500, z1: 1100 };
const AREA_COL = { forest: '#6f8c4c', farmland: '#cdbb7e', scrub: '#a3ad6c', residential: '#d7ccb0', construction: '#c7b48a', park: '#7cae55' };
function paintGround(x, X0, Z0, S, W, H, detail) {
  x.setTransform(S, 0, 0, S, -X0 * S, -Z0 * S);
  x.fillStyle = '#b4b07c'; x.fillRect(X0 - 5, Z0 - 5, W / S + 10, H / S + 10);
  const speck = ['#a7a572', '#c2bc88', '#9ca468', '#b3a676', '#8f9b5d', '#c9c29a'];
  const n = detail ? 90000 : 30000;
  for (let i = 0; i < n; i++) {
    x.fillStyle = speck[i % speck.length]; x.globalAlpha = 0.55;
    const s = (detail ? 0.5 : 2.4) * (0.5 + rnd());
    x.fillRect(X0 + rnd() * (W / S), Z0 + rnd() * (H / S), s, s);
  }
  x.globalAlpha = 1;
  const order = ['forest', 'farmland', 'scrub', 'residential', 'construction', 'park'];
  for (const a of [...M.areas].sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k))) {
    x.beginPath(); a.p.forEach((q, i) => (i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]))); x.closePath();
    x.fillStyle = AREA_COL[a.k]; x.globalAlpha = a.k === 'residential' ? 0.85 : 0.75; x.fill(); x.globalAlpha = 1;
  }
  if (detail) { // garden / grass speckles inside the parks
    for (let i = 0; i < 30000; i++) { const px = X0 + rnd() * (W / S), pz = Z0 + rnd() * (H / S); x.fillStyle = rnd() < 0.5 ? '#6ea24a' : '#8bbd60'; x.globalAlpha = 0.5; x.fillRect(px, pz, 0.4, 0.4); }
    x.globalAlpha = 1;
  }
  const path = p => { x.beginPath(); p.forEach((q, i) => (i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]))); };
  x.lineCap = 'round'; x.lineJoin = 'round';
  // yards around the houses
  for (const b of M.buildings) { path(b.p); x.closePath(); x.lineWidth = 7; x.strokeStyle = '#cbc2a8'; x.stroke(); x.fillStyle = '#cbc2a8'; x.fill(); }
  for (const r of M.roads) if (['track'].includes(r.k)) { path(r.p); x.lineWidth = 3; x.strokeStyle = '#a58d66'; x.stroke(); }
  for (const r of M.roads) if (['footway', 'steps', 'path'].includes(r.k)) { path(r.p); x.lineWidth = 2.2; x.strokeStyle = '#d8cdb9'; x.stroke(); }
  const roads = M.roads.filter(r => !['track', 'footway', 'steps', 'path'].includes(r.k));
  for (const r of roads) { path(r.p); x.lineWidth = r.w + 4.2; x.strokeStyle = '#cdc8be'; x.stroke(); } // sidewalks
  if (detail) {
    for (const r of roads) { path(r.p); x.lineWidth = r.w + 0.6; x.strokeStyle = '#e4e1da'; x.stroke(); } // curbs
  }
  for (const r of roads) { path(r.p); x.lineWidth = r.w; x.strokeStyle = '#55585d'; x.stroke(); }
  if (detail) for (const r of roads) if (r.w >= 7) { path(r.p); x.lineWidth = 0.16; x.strokeStyle = '#e9e6dc'; x.setLineDash([3, 3.5]); x.stroke(); x.setLineDash([]); }
}
const maxTex = renderer.capabilities.maxTextureSize;
function groundTex(R, S, detail) {
  let W = Math.round((R.x1 - R.x0) * S), H = Math.round((R.z1 - R.z0) * S);
  const lim = Math.min(maxTex, 4096);
  if (W > lim || H > lim) { const k = lim / Math.max(W, H); S *= k; W = Math.round(W * k); H = Math.round(H * k); }
  const t = canvasTex(W, H, (x) => paintGround(x, R.x0, R.z0, S, W, H, detail));
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
function terrainMesh(R, step, tex, hole) {
  const nx = Math.round((R.x1 - R.x0) / step) + 1, nz = Math.round((R.z1 - R.z0) / step) + 1;
  const pos = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2), idx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = R.x0 + i * step, z = R.z0 + j * step, k = j * nx + i;
    let y = heightAt(x, z);
    if (hole && x > hole.x0 + 20 && x < hole.x1 - 20 && z > hole.z0 + 20 && z < hole.z1 - 20) y -= 4;
    pos.set([x, y, z], k * 3); uv.set([(x - R.x0) / (R.x1 - R.x0), 1 - (z - R.z0) / (R.z1 - R.z0)], k * 2);
    if (i < nx - 1 && j < nz - 1) idx.push(k, k + nx, k + 1, k + 1, k + nx, k + nx + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, polygonOffset: !!hole, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }));
  m.receiveShadow = true;
  return m;
}

// ===================== houses =====================
const wallTex = canvasTex(256, 256, (x, W, H) => {
  x.fillStyle = '#fbf6ea'; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#ebe2d0'; x.lineWidth = 1.5; // stone courses
  for (let r = 0; r < 10; r++) { const y = r * 25.6; x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); for (let c = 0; c < 5; c++) { const xx = c * 51 + (r % 2) * 25; x.beginPath(); x.moveTo(xx, y); x.lineTo(xx, y + 25.6); x.stroke(); } }
  const wy0 = H * (1 - 2.25 / 3.1), wy1 = H * (1 - 0.95 / 3.1), wx0 = W * (1.5 / 4.4), wx1 = W * (2.9 / 4.4);
  x.fillStyle = '#9a9a96'; x.fillRect(wx0 - 6, wy0 - 22, wx1 - wx0 + 12, 18); // shutter box
  x.fillStyle = '#d9d6cf'; x.fillRect(wx0 - 5, wy0 - 4, wx1 - wx0 + 10, wy1 - wy0 + 9);
  const g = x.createLinearGradient(0, wy0, 0, wy1); g.addColorStop(0, '#6f8aa3'); g.addColorStop(1, '#2f4558');
  x.fillStyle = g; x.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
  x.fillStyle = '#d9d6cf'; x.fillRect((wx0 + wx1) / 2 - 2, wy0, 4, wy1 - wy0);
  x.fillStyle = '#c9c2b2'; x.fillRect(wx0 - 8, wy1 + 4, wx1 - wx0 + 16, 6); // sill
}, { repeat: true });
const wallLit = canvasTex(256, 256, (x, W, H) => {
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  const wy0 = H * (1 - 2.25 / 3.1), wy1 = H * (1 - 0.95 / 3.1), wx0 = W * (1.5 / 4.4), wx1 = W * (2.9 / 4.4);
  x.fillStyle = '#ffcf7a'; x.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
}, { repeat: true });
const wallMat = new THREE.MeshLambertMaterial({ map: wallTex, vertexColors: true, side: THREE.DoubleSide, emissiveMap: wallLit, emissive: 0xffd28a, emissiveIntensity: 0 });
const roofMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true });
const WALL_TINTS = ['#ffffff', '#f3ead8', '#efe3cc', '#fbf6ec', '#e8dcc6'].map(c => new THREE.Color(c));
const ROOF_COLS = ['#b5442e', '#c4553a', '#a83f2b', '#bf4b32', '#b9563e'].map(c => new THREE.Color(c));

const houses = []; // per building: info for game use
const wallTriB = [], roofTriB = [];
function buildHouses() {
  const wp = [], wu = [], wc = [], rp = [], rc = [];
  for (const b of M.buildings) {
    const poly = ring(b.p), hs = poly.map(q => heightAt(q[0], q[1]));
    const g0 = Math.max(...hs), base = Math.min(...hs) - 0.6;
    const floors = b.a < 45 ? 1 : 2, top = g0 + floors * 3.1 + 0.25;
    const tint = WALL_TINTS[b.id % WALL_TINTS.length];
    let cum = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], c = poly[(i + 1) % poly.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const u0 = cum / 4.4, u1 = (cum + len) / 4.4; cum += len;
      const v = y => (y - g0) / 3.1;
      const A0 = [a[0], base, a[1]], C0 = [c[0], base, c[1]], C1 = [c[0], top, c[1]], A1 = [a[0], top, a[1]];
      wp.push(...A0, ...C0, ...C1, ...A0, ...C1, ...A1);
      wu.push(u0, v(base), u1, v(base), u1, v(top), u0, v(base), u1, v(top), u0, v(top));
      for (let k = 0; k < 6; k++) wc.push(tint.r, tint.g, tint.b);
      wallTriB.push(b.id, b.id);
    }
    const R = minRect(poly);
    hipRoof(rp, R, top, 0.45, 3.2);
    const rcol = ROOF_COLS[b.id % ROOF_COLS.length];
    for (let k = 0; k < 18; k++) rc.push(rcol.r, rcol.g, rcol.b);
    for (let k = 0; k < 6; k++) roofTriB.push(b.id);
    // front: the wall facing the nearest street
    const nr = nearestRoad(b.c[0], b.c[1]);
    const dir = [nr.x - b.c[0], nr.y - b.c[1]], dl = Math.hypot(...dir) || 1;
    dir[0] /= dl; dir[1] /= dl;
    let exitD = 2; // distance from the centre to the wall in the street direction
    while (exitD < 40 && inPoly(b.c[0] + dir[0] * exitD, b.c[1] + dir[1] * exitD, poly)) exitD += 0.5;
    const roadW = nr.road ? nr.road.w : 6, rl = Math.hypot(nr.dx, nr.dy) || 1;
    let door = [nr.x - dir[0] * (roadW / 2 + 1.6), nr.y - dir[1] * (roadW / 2 + 1.6)];
    if (collide(door[0], door[1], 0.5)[2] || Math.hypot(nr.x - b.c[0], nr.y - b.c[1]) < exitD + 2) door = [b.c[0] + dir[0] * (exitD + 1.8), b.c[1] + dir[1] * (exitD + 1.8)];
    const park = [nr.x - dir[0] * (roadW / 2 - 1.4), nr.y - dir[1] * (roadW / 2 - 1.4)];
    houses.push({ id: b.id, b, poly, g0, top, door, dir, wallPt: [b.c[0] + dir[0] * exitD, b.c[1] + dir[1] * exitD], park, parkHeading: Math.atan2(nr.dx / rl, nr.dy / rl) });
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.setAttribute('uv', new THREE.Float32BufferAttribute(wu, 2)); wg.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3));
  wg.computeVertexNormals();
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
  rg.computeVertexNormals();
  const walls = new THREE.Mesh(wg, wallMat), roofs = new THREE.Mesh(rg, roofMat);
  walls.castShadow = roofs.castShadow = true; walls.receiveShadow = roofs.receiveShadow = true;
  scene.add(walls, roofs);
  W3.pickables = [walls, roofs];
  walls.userData.tri = wallTriB; roofs.userData.tri = roofTriB;
  buildNumberPlates();
}
const houseById = {};
// Blue house-number plates on the wall facing the street (one atlas texture).
function buildNumberPlates() {
  const maxN = Math.max(...M.buildings.map(b => b.n)), cols = 10, rows = Math.ceil(maxN / cols), CW = 128, CH = 72;
  const tex = canvasTex(cols * CW, rows * CH, (x) => {
    for (let n = 1; n <= maxN; n++) {
      const cx = ((n - 1) % cols) * CW, cy = Math.floor((n - 1) / cols) * CH;
      x.fillStyle = '#fff'; roundRect(x, cx + 3, cy + 3, CW - 6, CH - 6, 10); x.fill();
      x.fillStyle = '#1d4f91'; roundRect(x, cx + 8, cy + 8, CW - 16, CH - 16, 7); x.fill();
      x.fillStyle = '#fff'; x.font = `800 42px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(n, cx + CW / 2, cy + CH / 2 + 2);
    }
  });
  const p = [], uv = [];
  for (const h of houses) {
    houseById[h.id] = h;
    const n = h.b.n; if (!n) continue;
    const u0 = ((n - 1) % cols) / cols, u1 = u0 + 1 / cols, v1 = 1 - Math.floor((n - 1) / cols) / rows, v0 = v1 - 1 / rows;
    const [wx, wz] = h.wallPt, side = [-h.dir[1], h.dir[0]], y = heightAt(wx, wz) + 2.1, o = 0.08, hw = 0.32, hh = 0.18;
    const cx = wx + h.dir[0] * o, cz = wz + h.dir[1] * o;
    const L = [cx - side[0] * hw, cz - side[1] * hw], Rr = [cx + side[0] * hw, cz + side[1] * hw];
    // viewer stands on the street side looking back at the wall: left/right swap so the text reads correctly
    p.push(Rr[0], y - hh, Rr[1], L[0], y - hh, L[1], L[0], y + hh, L[1], Rr[0], y - hh, Rr[1], L[0], y + hh, L[1], Rr[0], y + hh, Rr[1]);
    uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })));
}

// collision grid for houses (and built facilities)
const CELL = 20, grid = new Map();
const cellKey = (i, j) => i * 10007 + j;
function addCollider(poly) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const q of poly) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
  const c = { poly, x0, x1, z0, z1 };
  for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) {
    const k = cellKey(i, j); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(c);
  }
  return c;
}
function removeCollider(c) { for (const list of grid.values()) { const i = list.indexOf(c); if (i >= 0) list.splice(i, 1); } }
// moves the point out of any collider (radius r); returns [x,z,hit]
function collide(x, z, r) {
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    const list = grid.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) || [];
    for (const c of list) {
      if (x < c.x0 - r || x > c.x1 + r || z < c.z0 - r || z > c.z1 + r) continue;
      const inside = inPoly(x, z, c.poly);
      let best = { d: Infinity };
      for (let i = 0; i < c.poly.length; i++) { const s = segPoint(x, z, c.poly[i], c.poly[(i + 1) % c.poly.length]); if (s.d < best.d) best = s; }
      if (inside || best.d < r) {
        hit = true;
        let nx = x - best.x, nz = z - best.y, nl = Math.hypot(nx, nz) || 1;
        if (inside) { nx = -nx; nz = -nz; }
        x = best.x + (nx / nl) * (r + 0.01); z = best.y + (nz / nl) * (r + 0.01);
      }
    }
  }
  return [x, z, hit];
}

// ===================== nature, lamps =====================
function buildTrees() {
  const pts = [];
  const sample = (poly, dens, kind, maxN) => {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const q of poly) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
    x0 = Math.max(x0, OUT.x0 + 50); x1 = Math.min(x1, OUT.x1 - 50); z0 = Math.max(z0, OUT.z0 + 50); z1 = Math.min(z1, OUT.z1 - 50);
    const n = Math.min(maxN, Math.round(((x1 - x0) * (z1 - z0)) / dens));
    for (let i = 0; i < n * 2 && i < 20000; i++) {
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
      if (!inPoly(x, z, poly)) continue;
      if (Math.hypot(x, z) > 1100) continue;
      if (collide(x, z, 2)[2]) continue;
      if (nearestRoad(x, z).d < 6) continue;
      pts.push({ x, z, kind, s: 0.7 + rnd() * 0.7 });
    }
  };
  for (const a of M.areas) {
    if (a.k === 'forest') sample(a.p, MOBILE ? 260 : 150, 'pine', MOBILE ? 1200 : 2200);
    if (a.k === 'park') sample(a.p, 180, 'round', 80);
    if (a.k === 'scrub') sample(a.p, 220, 'bush', 400);
  }
  for (const h of houses) if (rnd() < 0.7) { // a tree in each yard
    const ang = rnd() * Math.PI * 2, d = 7 + rnd() * 3, x = h.b.c[0] + Math.cos(ang) * d, z = h.b.c[1] + Math.sin(ang) * d;
    if (!collide(x, z, 1.5)[2] && nearestRoad(x, z).d > 6) pts.push({ x, z, kind: rnd() < 0.5 ? 'round' : 'olive', s: 0.6 + rnd() * 0.4 });
  }
  const trunkG = new THREE.CylinderGeometry(0.18, 0.28, 1, 6).translate(0, 0.5, 0);
  const pineG = new THREE.ConeGeometry(1.8, 5.5, 7).translate(0, 4.6, 0);
  const roundG = new THREE.IcosahedronGeometry(2.2, 1).translate(0, 3.6, 0);
  const bushG = new THREE.IcosahedronGeometry(1.1, 0).translate(0, 0.7, 0);
  const mk = (geo, color, list, sy) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }), list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    list.forEach((t, i) => { e.set(0, t.x * 13.1, 0); q.setFromEuler(e); m.compose(new THREE.Vector3(t.x, heightAt(t.x, t.z) - 0.2, t.z), q, new THREE.Vector3(t.s, t.s * (sy || 1), t.s)); im.setMatrixAt(i, m); });
    im.castShadow = !MOBILE; scene.add(im);
  };
  const trunks = pts.filter(t => t.kind !== 'bush');
  mk(trunkG, '#6b4f35', trunks, 2.6);
  mk(pineG, '#3f6b35', pts.filter(t => t.kind === 'pine'));
  mk(roundG, '#5d8a3f', pts.filter(t => t.kind === 'round'));
  mk(roundG, '#8a9a6a', pts.filter(t => t.kind === 'olive'));
  mk(bushG, '#7d8f4f', pts.filter(t => t.kind === 'bush'));
}
let lampMat;
function buildLamps() {
  const spots = [];
  for (const r of CAR_ROADS) {
    if (r.p.every(q => Math.abs(q[0]) > 500 || Math.abs(q[1]) > 520)) continue;
    let acc = 14;
    for (let i = 1; i < r.p.length; i++) {
      const a = r.p[i - 1], b = r.p[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      while (acc < L) {
        const x = a[0] + dx * acc + -dz * (r.w / 2 + 1.3), z = a[1] + dz * acc + dx * (r.w / 2 + 1.3);
        if (Math.abs(x) < 520 && Math.abs(z) < 540 && !collide(x, z, 0.6)[2]) spots.push([x, z, Math.atan2(dz, -dx)]);
        acc += 34;
      }
      acc -= L;
    }
  }
  const poleG = new THREE.CylinderGeometry(0.07, 0.1, 6.2, 5).translate(0, 3.1, 0);
  const headG = new THREE.BoxGeometry(0.7, 0.18, 0.3).translate(0, 6.2, 0.25);
  const poles = new THREE.InstancedMesh(poleG, new THREE.MeshLambertMaterial({ color: '#5a5f66' }), spots.length);
  lampMat = new THREE.MeshLambertMaterial({ color: '#dddddd', emissive: 0xffe0a0, emissiveIntensity: 0 });
  const heads = new THREE.InstancedMesh(headG, lampMat, spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, z, a], i) => { m.makeRotationY(a); m.setPosition(x, heightAt(x, z), z); poles.setMatrixAt(i, m); heads.setMatrixAt(i, m); });
  scene.add(poles, heads);
}

// ===================== road graph =====================
const G = M.graph;
const mainSet = (() => { const seen = new Uint8Array(G.p.length), q = [M.exitNode]; seen[M.exitNode] = 1; while (q.length) { const a = q.pop(); for (const [b] of G.e[a]) if (!seen[b]) { seen[b] = 1; q.push(b); } } return seen; })();
const [BX0, BY0, BX1, BY1] = M.bounds;
const townNodes = G.p.map((p, i) => i).filter(i => mainSet[i] && G.p[i][0] > BX0 && G.p[i][0] < BX1 && G.p[i][1] > BY0 && G.p[i][1] < BY1);
function nearestNode(x, y) { let best = townNodes[0], bd = Infinity; for (const i of townNodes) { const d = (G.p[i][0] - x) ** 2 + (G.p[i][1] - y) ** 2; if (d < bd) { bd = d; best = i; } } return best; }
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
  const path = []; for (let u = b; u >= 0; u = prev[u]) { path.push(u); if (u === a) break; }
  return path.reverse();
}

// ===================== entrance gate =====================
const gate = {};
function buildGate() {
  const st = M.entrance, a = nearestNode(st[0], st[1]);
  const pts = dijkstra(a, M.exitNode).map(i => G.p[i]);
  const along = d => { // point + direction at distance d along the road out
    for (let i = 1; i < pts.length; i++) { const L = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (d <= L) { const t = d / L; return { x: lerp(pts[i - 1][0], pts[i][0], t), z: lerp(pts[i - 1][1], pts[i][1], t), dx: (pts[i][0] - pts[i - 1][0]) / L, dz: (pts[i][1] - pts[i - 1][1]) / L }; } d -= L; }
    const l = pts[pts.length - 1]; return { x: l[0], z: l[1], dx: 0, dz: -1 };
  };
  const g = along(22), t = along(80), back = along(52);
  Object.assign(gate, { x: g.x, z: g.z, trigger: [t.x, t.z], back: [back.x, back.z, Math.atan2(-back.dx, -back.dz)] });
  const grp = new THREE.Group(), y = heightAt(g.x, g.z);
  grp.position.set(g.x, y, g.z); grp.rotation.y = Math.atan2(g.dx, g.dz);
  const yellow = new THREE.MeshLambertMaterial({ color: '#f2c200' }), grey = new THREE.MeshLambertMaterial({ color: '#6b6f75' });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.2, 0.5), grey); post.position.set(-5.2, 0.6, 0);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 7.5, 0.15), yellow); arm.position.set(-5.2, 4.8, 0); // raised (open)
  const booth = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.6, 2.4), new THREE.MeshLambertMaterial({ color: '#e9e4d8' })); booth.position.set(-7.6, 1.3, 2.5);
  const broof = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.25, 2.9), grey); broof.position.set(-7.6, 2.7, 2.5);
  grp.add(post, arm, booth, broof);
  const sign = makeSign(['ברוכים הבאים', 'גבעות עדן'], 7, 3.2, { bg: '#2f6b3f', icon: '🌿' }, ['להתראות!', 'סעו בזהירות']);
  sign.position.set(6.5, 3.4, 4); // the front faces cars coming in
  const legs = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.2, 0.2), grey); legs.position.set(6.5, 1.7, 4.05);
  const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 3.6, 0.2), grey); l1.position.set(3.6, 1.8, 4.1);
  const l2 = l1.clone(); l2.position.x = 9.4;
  grp.add(sign, legs, l1, l2);
  scene.add(grp);
}
function buildBusStops() {
  for (const s of M.stops) {
    const nr = nearestRoad(s.p[0], s.p[1]), grp = new THREE.Group();
    const x = s.p[0], z = s.p[1];
    grp.position.set(x, heightAt(x, z), z); grp.rotation.y = Math.atan2(nr.x - x, nr.y - z);
    const mat = new THREE.MeshLambertMaterial({ color: '#3a7d44' }), glass = new THREE.MeshLambertMaterial({ color: '#bcd7e6', transparent: true, opacity: 0.6 });
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4, 0.15, 1.8), mat); roof.position.y = 2.5;
    const back = new THREE.Mesh(new THREE.BoxGeometry(4, 2.2, 0.08), glass); back.position.set(0, 1.25, -0.8);
    const bench = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 0.5), new THREE.MeshLambertMaterial({ color: '#8a6a45' })); bench.position.set(0, 0.5, -0.5);
    const sign = makeSign(['🚌', s.name], 1.6, 0.8, { bg: '#2f6b3f' }); sign.position.set(1.6, 2.2, 0.95);
    grp.add(roof, back, bench, sign);
    scene.add(grp);
  }
}
function buildStreetSigns() {
  const done = new Set();
  for (let i = 0; i < G.p.length; i++) {
    if (!mainSet[i] || G.e[i].length < 3) continue;
    const [x, z] = G.p[i];
    if (x < BX0 || x > BX1 || z < BY0 || z > BY1) continue;
    const names = new Set();
    for (const r of CAR_ROADS) if (r.name && r.name !== 'גבעות עדן' && r.p.some(q => Math.hypot(q[0] - x, q[1] - z) < 1)) names.add(r.name);
    if (!names.size) continue;
    const key = [...names].sort().join('|');
    if (done.has(key + Math.round(x / 60) + Math.round(z / 60))) continue;
    done.add(key + Math.round(x / 60) + Math.round(z / 60));
    const grp = new THREE.Group(), px = x + 5, pz = z + 5;
    grp.position.set(px, heightAt(px, pz), pz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.8, 5), new THREE.MeshLambertMaterial({ color: '#555' })); pole.position.y = 1.4;
    grp.add(pole);
    [...names].slice(0, 2).forEach((n, k) => {
      const s = makeSign([n], 1.5, 0.42, { bg: '#f4f1e8', fg: '#1d4f91', border: '#1d4f91', w: 384, h: 108 });
      s.position.y = 2.65 - k * 0.5; s.rotation.y = k * Math.PI / 2 + 0.6;
      grp.add(s);
    });
    scene.add(grp);
  }
}

// ===================== people & cars =====================
const SKIN = ['#f1c9a5', '#e0ac85', '#c68b62', '#a8704a', '#f6d7bb'];
const SHIRTS = ['#3b6ea8', '#e9e9e9', '#2f6b3f', '#c8553d', '#6c5b9e', '#d9a441', '#4c4c4c', '#7fb2d9'];
const PANTS = ['#2c3e50', '#3d3d3d', '#5b4636', '#1f2a44', '#6b6b6b'];
export function makePerson(o = {}) {
  const g = new THREE.Group(), L = c => new THREE.MeshLambertMaterial({ color: c });
  const skin = L(o.skin || rpick(SKIN)), shirt = L(o.shirt || rpick(SHIRTS)), pants = L(o.pants || rpick(PANTS));
  const legG = new THREE.BoxGeometry(0.17, 0.85, 0.2).translate(0, -0.42, 0);
  const armG = new THREE.BoxGeometry(0.13, 0.7, 0.15).translate(0, -0.35, 0);
  const legL = new THREE.Mesh(legG, pants), legR = new THREE.Mesh(legG, pants);
  legL.position.set(-0.12, 0.88, 0); legR.position.set(0.12, 0.88, 0);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.62, 0.26), shirt); body.position.y = 1.2;
  const armL = new THREE.Mesh(armG, shirt), armR = new THREE.Mesh(armG, shirt);
  armL.position.set(-0.31, 1.48, 0); armR.position.set(0.31, 1.48, 0);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skin); head.position.y = 1.68;
  g.add(legL, legR, body, armL, armR, head);
  if (o.skirt) { const sk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.34, 0.6, 10), L(o.skirtColor || '#2c3e66')); sk.position.y = 0.68; g.add(sk); }
  if (o.hair) { const h = new THREE.Mesh(new THREE.SphereGeometry(0.185, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), L(o.hair)); h.position.y = 1.7; h.rotation.x = 0.25; g.add(h); if (o.long) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.38, 0.1), L(o.hair)); t.position.set(0, 1.52, -0.14); g.add(t); } }
  if (o.kippah) { const k = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.35), L(o.kippahColor || '#1d3f7a')); k.position.y = 1.78; k.rotation.x = -0.35; g.add(k); }
  g.userData = { legL, legR, armL, armR, phase: rnd() * 6, shirtMat: shirt };
  if (o.scale) g.scale.setScalar(o.scale);
  g.traverse(m => { if (m.isMesh) m.castShadow = !MOBILE; });
  return g;
}
export function animatePerson(g, speed, dt) {
  const u = g.userData;
  u.phase += dt * (speed > 0.1 ? 4 + speed * 1.3 : 0);
  const sw = speed > 0.1 ? Math.min(0.8, 0.25 + speed * 0.07) : 0, s = Math.sin(u.phase) * sw;
  u.legL.rotation.x = s; u.legR.rotation.x = -s; u.armL.rotation.x = -s * 0.9; u.armR.rotation.x = s * 0.9;
}
const CAR_STYLE = {
  i10: { color: '#d64545', len: 3.7, w: 1.65, h: 1.45 },
  octavia: { color: '#3b5f8f', len: 4.6, w: 1.8, h: 1.45 },
  tesla: { color: '#f2f2f2', len: 4.7, w: 1.85, h: 1.4 },
  carnival: { color: '#9aa3ab', len: 5.1, w: 1.95, h: 1.8 },
  jeep: { color: '#3d5a3a', len: 4.4, w: 1.9, h: 1.85 },
  bike: { color: '#e07b28', len: 1.8, w: 0.6, h: 1.1, bike: true },
  bus: { color: '#2f7d4f', len: 11, w: 2.5, h: 3.1 },
};
export function makeCar(type = 'octavia', color) {
  const st = CAR_STYLE[type] || CAR_STYLE.octavia, g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: color || st.color }), dark = new THREE.MeshLambertMaterial({ color: '#22262b' }), glass = new THREE.MeshLambertMaterial({ color: '#36495a' });
  if (st.bike) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 1.4), body); b.position.y = 0.55; g.add(b);
    for (const z of [-0.6, 0.6]) { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 12).rotateZ(Math.PI / 2), dark); w.position.set(0, 0.3, z); g.add(w); }
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.06), dark); hb.position.set(0, 1.05, 0.55); g.add(hb);
  } else {
    const lower = new THREE.Mesh(new THREE.BoxGeometry(st.w, st.h * 0.45, st.len), body); lower.position.y = 0.32 + st.h * 0.22;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(st.w * 0.9, st.h * 0.42, st.len * (type === 'bus' || type === 'carnival' ? 0.85 : 0.55)), glass);
    cab.position.set(0, 0.32 + st.h * 0.45 + st.h * 0.2, type === 'bus' ? 0 : -st.len * 0.05);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(st.w * 0.92, 0.06, cab.geometry.parameters.depth * 0.98), body); roof.position.set(0, cab.position.y + st.h * 0.21, cab.position.z);
    g.add(lower, cab, roof);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 12).rotateZ(Math.PI / 2), dark);
      w.position.set(sx * (st.w / 2 - 0.08), 0.34, sz * (st.len / 2 - 0.75)); g.add(w);
    }
    const lightM = new THREE.MeshBasicMaterial({ color: '#fff6d0' }), tailM = new THREE.MeshBasicMaterial({ color: '#c0262a' });
    for (const sx of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.14, 0.05), lightM); hl.position.set(sx * st.w * 0.32, 0.32 + st.h * 0.3, st.len / 2 + 0.01); g.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.05), tailM); tl.position.set(sx * st.w * 0.34, 0.32 + st.h * 0.3, -st.len / 2 - 0.01); g.add(tl);
    }
  }
  g.traverse(m => { if (m.isMesh) m.castShadow = !MOBILE; });
  g.userData.len = st.len;
  return g;
}

// ===================== facilities (things the player builds) =====================
const facGroup = new THREE.Group();
scene.add(facGroup);
const facColliders = [];
function facBase(type, plot) {
  const x = plot.x, z = plot.y, nr = nearestRoad(x, z), rot = Math.atan2(nr.x - x, nr.y - z);
  const corners = [[-10, -10], [10, -10], [10, 10], [-10, 10]].map(([a, b]) => heightAt(x + a, z + b));
  const top = Math.max(...corners) + 0.15, bottom = Math.min(...corners) - 1;
  const g = new THREE.Group(); g.position.set(x, top, z); g.rotation.y = rot;
  const pad = new THREE.Mesh(new THREE.BoxGeometry(20, top - bottom, 20), new THREE.MeshLambertMaterial({ color: type === 'football' || type === 'garden' ? '#77a94f' : '#d8d2c4' }));
  pad.position.y = -(top - bottom) / 2; pad.receiveShadow = true; g.add(pad);
  return { g, rot };
}
const box = (w, h, d, color, x = 0, y = 0, z = 0, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || new THREE.MeshLambertMaterial({ color })); m.position.set(x, y + h / 2, z); m.castShadow = m.receiveShadow = !MOBILE; return m; };
function building(g, w, h, d, color, name, icon, z = 0) {
  const mat = new THREE.MeshLambertMaterial({ map: wallTex.clone(), color });
  mat.map.repeat.set(w / 4.4, h / 3.1); mat.map.needsUpdate = true;
  g.add(box(w, h, d, null, 0, 0, z, mat));
  g.add(box(w + 0.8, 0.35, d + 0.8, '#d6d0c2', 0, h, z));
  g.add(box(1.4, 2.3, 0.1, '#5a3d2b', 0, 0, z + d / 2 + 0.03));
  const s = makeSign([name], Math.min(w * 0.8, 7), 1.5, { icon, bg: '#ffffff', fg: '#2b2a27', border: '#2f6b3f' });
  s.position.set(0, h - 1.1, z + d / 2 + 0.06); g.add(s);
}
function makeFacility(b) {
  const f = D.facilities[b.type], plot = M.plots[b.plot], { g } = facBase(b.type, plot);
  const L = c => new THREE.MeshLambertMaterial({ color: c });
  if (!b.done) {
    const p = b.prog / b.need, h = Math.max(0.5, 7 * p);
    g.add(box(12, h, 10, '#c9c2b3', 0, 0, -1));
    const sc = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(13, 8, 11, 3, 3, 3)), new THREE.LineBasicMaterial({ color: '#8a8f96' })); sc.position.set(0, 4, -1); g.add(sc);
    g.add(box(0.6, 18, 0.6, '#f2c200', 7, 0, -6), box(14, 0.5, 0.5, '#f2c200', 2, 17.5, -6));
    const s = makeSign([f.name, `🚧 בבנייה ${Math.floor(p * 100)}%`], 4, 2, { bg: '#f2c200', fg: '#222', border: '#222' }); s.position.set(0, 1.6, 9.5); g.add(s);
    return g;
  }
  switch (b.type) {
    case 'synagogue': {
      building(g, 14, 8, 12, '#f8f4ea', 'בית כנסת', '🕍', -1);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(4.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), L('#d4a937')); dome.position.set(0, 8.3, -1); g.add(dome);
      const star = makeSign(['✡'], 1.8, 1.8, { bg: '#1d4f91', fg: '#fff', w: 256, h: 256 }); star.position.set(0, 13.6, -1); g.add(star);
      break;
    }
    case 'playground': {
      g.add(box(16, 0.08, 14, '#c0563f', 0, 0, 0));
      g.add(box(1.2, 2.6, 1.2, '#f2c200', -4, 0, -3), box(1.2, 0.2, 4.5, '#3b8fd6', -4, 1.6, 0.2));
      g.children[g.children.length - 1].rotation.x = 0.55;
      for (const x of [2, 6]) g.add(box(0.15, 3, 0.15, '#2f6b3f', x, 0, -4), box(0.15, 3, 0.15, '#2f6b3f', x, 0, 0));
      g.add(box(4.3, 0.15, 0.15, '#2f6b3f', 4, 3, -4), box(4.3, 0.15, 0.15, '#2f6b3f', 4, 3, 0));
      g.add(box(0.6, 0.08, 0.4, '#e04e39', 3, 0.8, -2), box(0.6, 0.08, 0.4, '#e04e39', 5, 0.8, -2));
      g.add(box(4, 0.3, 4, '#e8d8a8', -2, 0, 5));
      break;
    }
    case 'garden': {
      for (const [x, z] of [[-6, -6], [6, -5], [-5, 6], [6, 6], [0, 0]]) { g.add(box(0.4, 2, 0.4, '#6b4f35', x, 0, z)); const c = new THREE.Mesh(new THREE.IcosahedronGeometry(2, 1), L('#4f8a3a')); c.position.set(x, 3.4, z); g.add(c); }
      g.add(box(2, 0.45, 0.6, '#8a6a45', 0, 0, 4), box(2, 0.45, 0.6, '#8a6a45', 0, 0, -4));
      break;
    }
    case 'football': {
      const t = canvasTex(256, 256, (x, W, H) => { x.fillStyle = '#3f8f3f'; x.fillRect(0, 0, W, H); x.strokeStyle = '#fff'; x.lineWidth = 3; x.strokeRect(10, 10, W - 20, H - 20); x.beginPath(); x.moveTo(10, H / 2); x.lineTo(W - 10, H / 2); x.stroke(); x.beginPath(); x.arc(W / 2, H / 2, 28, 0, 7); x.stroke(); });
      const fld = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), new THREE.MeshLambertMaterial({ map: t })); fld.rotation.x = -Math.PI / 2; fld.position.y = 0.05; g.add(fld);
      for (const z of [-8.6, 8.6]) { g.add(box(0.12, 2, 0.12, '#fff', -2.5, 0, z), box(0.12, 2, 0.12, '#fff', 2.5, 0, z), box(5.1, 0.12, 0.12, '#fff', 0, 2, z)); }
      break;
    }
    case 'pool': {
      g.add(box(16, 0.1, 14, '#f1efe8', 0, 0, 0));
      const w = new THREE.Mesh(new THREE.PlaneGeometry(11, 7), new THREE.MeshLambertMaterial({ color: '#38b6e0', emissive: 0x0a3d55, emissiveIntensity: 0.5 })); w.rotation.x = -Math.PI / 2; w.position.set(0, 0.16, 1); g.add(w);
      building(g, 8, 3.2, 3, '#eef6fb', 'בריכה', '🏊', -7.5);
      break;
    }
    case 'houses': {
      for (const [x, z] of [[-5, -5], [5, -5], [-5, 5], [5, 5]]) {
        const h = box(7, 6.4, 7, null, x, 0, z, wallMat.clone()); h.material.vertexColors = false; h.material.map = wallTex; g.add(h);
        const rp = []; hipRoof(rp, { c: 1, s: 0, u0: -3.5, u1: 3.5, v0: -3.5, v1: 3.5 }, 0, 0.4, 2.6);
        const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3)); rg.computeVertexNormals();
        const r = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ color: '#b5442e', side: THREE.DoubleSide, flatShading: true })); r.position.set(x, 6.4, z); g.add(r);
      }
      break;
    }
    case 'bneiakiva': {
      building(g, 12, 4.5, 9, '#e6eef8', 'בני עקיבא', '💙', -2);
      g.add(box(0.15, 9, 0.15, '#888', 5, 0, 5));
      const flag = makeSign([''], 3, 2, { bg: '#ffffff', border: '#ffffff' });
      const flagTex = canvasTex(192, 128, (x, W, H) => { x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.fillStyle = '#1d4f91'; x.fillRect(0, 14, W, 16); x.fillRect(0, H - 30, W, 16); x.font = `700 40px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('בנ"ע', W / 2, H / 2 + 2); });
      flag.children.forEach(c => (c.material.map = flagTex));
      flag.position.set(6.5, 7.8, 5); g.add(flag); g.userData.flag = flag;
      break;
    }
    case 'gas': {
      g.add(box(12, 0.5, 8, '#d23b2e', 0, 5, 2));
      for (const [x, z] of [[-5, -1], [5, -1], [-5, 5], [5, 5]]) g.add(box(0.3, 5, 0.3, '#ddd', x, 0, z));
      g.add(box(0.8, 1.6, 0.6, '#f2c200', -2, 0, 2), box(0.8, 1.6, 0.6, '#f2c200', 2, 0, 2));
      building(g, 8, 3.5, 4, '#f6f1e6', 'תחנת דלק', '⛽', -7);
      break;
    }
    case 'busstop': {
      g.add(box(4, 0.15, 1.8, '#3a7d44', 0, 2.5, 3), box(4, 2.2, 0.08, '#bcd7e6', 0, 0.2, 2.2), box(3, 0.1, 0.5, '#8a6a45', 0, 0.5, 2.5));
      break;
    }
    case 'school': building(g, 17, 7, 9, '#f6e7b8', 'בית ספר', '🏫', -2); g.add(box(4, 0.1, 5, '#c0563f', 6, 0, 6.5)); break;
    case 'kindergarten': building(g, 12, 3.6, 8, '#ffd8e4', 'גן ילדים', '🧸', -3); g.add(box(1, 1.8, 1, '#f2c200', -4, 0, 5), box(3, 0.4, 3, '#e8d8a8', 3, 0, 5)); break;
    case 'grocery': building(g, 12, 4, 9, '#fde3c8', 'מכולת', '🛒', -2); g.add(box(12, 0.15, 3, '#e07b28', 0, 3.2, 3.6)); break;
    case 'pizzeria': building(g, 10, 4, 8, '#fbe0d6', 'פיצריה', '🍕', -2); g.add(box(10, 0.15, 2.5, '#2f6b3f', 0, 3.2, 3.2)); break;
    default: {
      const H = { clinic: 4.5, mikveh: 4, library: 5, community: 7, yeshiva: 9 }[b.type] || 4.5;
      const Wd = { community: 15, yeshiva: 16 }[b.type] || 12;
      building(g, Wd, H, 9, f.color, f.name, f.icon, -2);
    }
  }
  return g;
}
function setFacilities(built) {
  facGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map && o.material.map !== wallTex) o.material.map.dispose(); o.material.dispose(); } });
  facGroup.clear();
  facColliders.forEach(removeCollider); facColliders.length = 0;
  for (const b of built) {
    facGroup.add(makeFacility(b));
    const p = M.plots[b.plot];
    if (b.done && !['playground', 'garden', 'football', 'pool', 'busstop'].includes(b.type)) facColliders.push(addCollider([[p.x - 7, p.y - 7], [p.x + 7, p.y - 7], [p.x + 7, p.y + 7], [p.x - 7, p.y + 7]]));
  }
}

// plot markers (top-down placement)
const plotGroup = new THREE.Group(); scene.add(plotGroup);
function showPlots(list) {
  plotGroup.clear();
  if (!list) return;
  const mat = new THREE.MeshBasicMaterial({ color: '#3d8bff', transparent: true, opacity: 0.55, depthWrite: false });
  for (const i of list) {
    const p = M.plots[i], m = new THREE.Mesh(new THREE.BoxGeometry(18, 1.5, 18), mat);
    m.position.set(p.x, Math.max(...[[-9, -9], [9, -9], [9, 9], [-9, 9]].map(([a, b]) => heightAt(p.x + a, p.y + b))) + 0.8, p.y);
    m.userData.plot = i; plotGroup.add(m);
  }
}

// ===================== player, car, camera =====================
const player = { x: 0, z: 0, y: 0, heading: 0, speed: 0, mode: 'walk', model: null, gender: 'm' };
const myCar = { model: null, type: null, x: 0, z: 0, heading: 0, speed: 0, pitch: 0 };
const cam = { yaw: 0, pitch: 0.32, dist: 7, view: 'third', top: null };
const input = { jx: 0, jy: 0, run: false, keys: {} };
let frozen = true, shabbatLook = false;
function setPlayerLook(gender, shabbat) {
  if (player.model) scene.remove(player.model);
  player.gender = gender;
  player.model = makePerson(gender === 'f'
    ? { skin: '#f1c9a5', shirt: shabbat ? '#ffffff' : '#7a4f9e', skirt: true, skirtColor: shabbat ? '#1f2a44' : '#2c3e66', hair: '#5a3a22', long: true }
    : { skin: '#f1c9a5', shirt: shabbat ? '#ffffff' : '#3b6ea8', pants: shabbat ? '#1a1a1a' : '#2c3e50', kippah: true, kippahColor: shabbat ? '#ffffff' : '#1d3f7a', hair: '#3a2a1a' });
  scene.add(player.model);
  player.model.position.set(player.x, player.y, player.z); player.model.rotation.y = player.heading;
  player.model.visible = player.mode === 'walk';
}
function setCar(type) {
  if (myCar.model) scene.remove(myCar.model);
  myCar.model = null; myCar.type = type;
  if (!type) return;
  myCar.model = makeCar(type); scene.add(myCar.model);
  placeCarModel();
}
function placeCarModel() {
  if (!myCar.model) return;
  const y = heightAt(myCar.x, myCar.z), half = (myCar.model.userData.len || 4) / 2.4;
  const yf = heightAt(myCar.x + Math.sin(myCar.heading) * half, myCar.z + Math.cos(myCar.heading) * half);
  const yb = heightAt(myCar.x - Math.sin(myCar.heading) * half, myCar.z - Math.cos(myCar.heading) * half);
  myCar.model.position.set(myCar.x, (yf + yb) / 2, myCar.z);
  myCar.model.rotation.set(0, 0, 0); myCar.model.rotateY(myCar.heading); myCar.model.rotateX(-Math.atan2(yf - yb, half * 2));
}
const WALK = 4.2, RUN = 8.5;
function updatePlayer(dt) {
  let jx = input.jx, jy = input.jy;
  if (input.keys.KeyW || input.keys.ArrowUp) jy = 1;
  if (input.keys.KeyS || input.keys.ArrowDown) jy = -1;
  if (input.keys.KeyA || input.keys.ArrowLeft) jx = -1;
  if (input.keys.KeyD || input.keys.ArrowRight) jx = 1;
  const mag = Math.min(1, Math.hypot(jx, jy));
  if (player.mode === 'walk') {
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw), rx = -fz, rz = fx;
    let mx = fx * jy + rx * jx, mz = fz * jy + rz * jx;
    const ml = Math.hypot(mx, mz);
    const sp = mag > 0.05 ? (input.run || input.keys.ShiftLeft ? RUN : WALK) * mag : 0;
    if (ml > 0.01) { mx /= ml; mz /= ml; player.heading = Math.atan2(mx, mz); }
    let nx = player.x + mx * sp * dt, nz = player.z + mz * sp * dt;
    [nx, nz] = collide(nx, nz, 0.4);
    nx = clamp(nx, OUT.x0 + 120, OUT.x1 - 120); nz = clamp(nz, OUT.z0 + 120, OUT.z1 - 120);
    player.x = nx; player.z = nz; player.speed = sp;
    player.y = heightAt(nx, nz);
    player.model.position.set(nx, player.y, nz);
    const cur = player.model.rotation.y; let d = player.heading - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
    player.model.rotation.y = cur + d * Math.min(1, dt * 12);
    animatePerson(player.model, sp, dt);
    player.model.visible = cam.view !== 'first';
  } else if (player.mode === 'drive') {
    const maxV = 15 * (myCar.type === 'tesla' ? 1.3 : myCar.type === 'bike' ? 0.8 : 1);
    if (jy > 0.05) myCar.speed += jy * 7 * dt;
    else if (jy < -0.05) myCar.speed += jy * (myCar.speed > 0 ? 14 : 5) * dt;
    else myCar.speed *= 1 - Math.min(1, dt * 0.9);
    myCar.speed = clamp(myCar.speed, -5, maxV);
    const steer = clamp(jx, -1, 1) * Math.min(1, Math.abs(myCar.speed) / 5) * Math.sign(myCar.speed || 1);
    myCar.heading -= steer * 1.5 * dt;
    let nx = myCar.x + Math.sin(myCar.heading) * myCar.speed * dt, nz = myCar.z + Math.cos(myCar.heading) * myCar.speed * dt;
    const c = collide(nx, nz, 1.3);
    if (c[2]) { myCar.speed *= -0.25; nx = myCar.x; nz = myCar.z; W3.onBump && W3.onBump(); }
    myCar.x = clamp(nx, OUT.x0 + 120, OUT.x1 - 120); myCar.z = clamp(nz, OUT.z0 + 120, OUT.z1 - 120);
    placeCarModel();
    player.x = myCar.x; player.z = myCar.z; player.y = heightAt(myCar.x, myCar.z); player.speed = Math.abs(myCar.speed);
    if (!cam.dragging) { let d = myCar.heading - cam.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); cam.yaw += d * Math.min(1, dt * 2.2); }
  }
}
function updateCamera(dt) {
  if (W3.attract) { // slow fly-around on the start screen
    const t = performance.now() / 22000;
    camera.position.set(Math.cos(t) * 260, 150, Math.sin(t) * 260 + 20);
    camera.lookAt(0, -10, 20);
    return;
  }
  if (cam.view === 'top') {
    const t = cam.top;
    camera.position.set(t.x, t.h + 40, t.z + t.h * 0.35);
    camera.lookAt(t.x, 0, t.z);
    return;
  }
  const px = player.x, pz = player.z, py = player.y;
  if (cam.view === 'first' && player.mode === 'walk') {
    camera.position.set(px, py + 1.62, pz);
    camera.lookAt(px + Math.sin(cam.yaw) * Math.cos(cam.pitch - 0.3), py + 1.62 - Math.sin(cam.pitch - 0.3), pz + Math.cos(cam.yaw) * Math.cos(cam.pitch - 0.3));
    return;
  }
  const dist = player.mode === 'drive' ? cam.dist + 4 : cam.dist;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  let cx = px - Math.sin(cam.yaw) * cp * dist, cz = pz - Math.cos(cam.yaw) * cp * dist, cy = py + 1.6 + sp * dist;
  cy = Math.max(cy, heightAt(cx, cz) + 0.8);
  camera.position.lerp(new THREE.Vector3(cx, cy, cz), Math.min(1, dt * 10));
  camera.lookAt(px, py + 1.5, pz);
}

// ===================== neighbours =====================
const npcs = [];
function npcRoute(n, from) {
  let to = townNodes[Math.floor(Math.random() * townNodes.length)];
  for (let k = 0; k < 4 && Math.hypot(G.p[to][0] - G.p[from][0], G.p[to][1] - G.p[from][1]) > 260; k++) to = townNodes[Math.floor(Math.random() * townNodes.length)];
  const raw = dijkstra(from, to).map(i => G.p[i]);
  const off = n.car ? 1.8 : 4.6;
  n.pts = raw.map((p, i) => {
    const a = raw[Math.max(0, i - 1)], b = raw[Math.min(raw.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [p[0] + (-dz / l) * off, p[1] + (dx / l) * off]; // keep right, like in Israel
  });
  if (n.pts.length < 2) n.pts = [raw[0] || G.p[from], raw[0] || G.p[from]];
  n.seg = n.pts.slice(1).map((p, i) => Math.hypot(p[0] - n.pts[i][0], p[1] - n.pts[i][1]));
  n.total = n.seg.reduce((s, v) => s + v, 0) || 1; n.d = 0; n.end = to;
}
let npcTarget = { w: 8, c: 3 }, npcShabbat = false;
function updateNPCs(dt) {
  const w = npcs.filter(n => !n.car).length, c = npcs.filter(n => n.car).length;
  if (w < npcTarget.w || c < npcTarget.c) {
    const car = c < npcTarget.c && (w >= npcTarget.w || Math.random() < 0.4);
    const kid = !car && Math.random() < 0.3, female = Math.random() < 0.5;
    const model = car ? makeCar(rpick(['i10', 'octavia', 'carnival', 'jeep', 'tesla']), rpick(['#d64545', '#3b5f8f', '#eeeeee', '#9aa3ab', '#222222', '#3d5a3a'])) :
      makePerson({ scale: kid ? 0.62 : 1, skirt: female, hair: female ? rpick(['#3a2a1a', '#6b4423', '#c9a36a', '#1a1a1a']) : '#2a2a2a', long: female, kippah: !female && Math.random() < 0.8, shirt: npcShabbat ? '#ffffff' : undefined });
    const n = { car, model, speed: car ? 7 + Math.random() * 2 : 1.3 + Math.random() * 0.5 };
    scene.add(model);
    npcRoute(n, townNodes[Math.floor(Math.random() * townNodes.length)]);
    npcs.push(n);
  }
  for (const n of [...npcs]) {
    if (n.car && npcShabbat) { scene.remove(n.model); npcs.splice(npcs.indexOf(n), 1); continue; }
    // cars slow down near the player
    let sp = n.speed;
    if (n.car) { const dd = Math.hypot(n.model.position.x - player.x, n.model.position.z - player.z); if (dd < 9) sp *= 0.15; }
    n.d += sp * dt;
    let i = 0, acc = 0; while (i < n.seg.length - 1 && acc + n.seg[i] < n.d) { acc += n.seg[i]; i++; }
    const a = n.pts[i], b = n.pts[i + 1] || a, t = n.seg[i] ? clamp((n.d - acc) / n.seg[i], 0, 1) : 1;
    const x = lerp(a[0], b[0], t), z = lerp(a[1], b[1], t);
    n.model.position.set(x, heightAt(x, z), z);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.1) n.model.rotation.y = Math.atan2(b[0] - a[0], b[1] - a[1]);
    if (!n.car) animatePerson(n.model, sp * 2.2, dt);
    if (n.d >= n.total) {
      const over = n.car ? c > npcTarget.c : w > npcTarget.w;
      if (over) { scene.remove(n.model); npcs.splice(npcs.indexOf(n), 1); } else npcRoute(n, n.end);
    }
  }
}

// family members standing in the yard
const family = [];
function setFamily(list, houseId) {
  family.forEach(f => scene.remove(f.model)); family.length = 0;
  const h = houseById[houseId]; if (!h) return;
  list.forEach((m, i) => {
    const model = makePerson(m);
    const side = [-h.dir[1], h.dir[0]], k = (i - (list.length - 1) / 2) * 1.4;
    let x = h.door[0] - h.dir[0] * 2.2 + side[0] * (k + 2.2), z = h.door[1] - h.dir[1] * 2.2 + side[1] * (k + 2.2);
    [x, z] = collide(x, z, 0.4);
    model.position.set(x, heightAt(x, z), z); model.rotation.y = Math.atan2(h.dir[0], h.dir[1]);
    scene.add(model); family.push({ model, kid: m.scale < 1, t: Math.random() * 6 });
  });
}

// markers: home diamond + guide beam + arrow
const homeMark = new THREE.Mesh(new THREE.OctahedronGeometry(1.1, 0), new THREE.MeshBasicMaterial({ color: '#f2c14e', toneMapped: false }));
scene.add(homeMark); homeMark.visible = false;
const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 70, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#59b6ff', transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false, fog: false }));
scene.add(beam); beam.visible = false;
let guide = null, homeId = null;

// ===================== sky & time =====================
const C = (h) => new THREE.Color(h);
const SKY = {
  day: [C('#4f93db'), C('#cfe6f7')], dusk: [C('#3a4f86'), C('#f2a76b')], night: [C('#050b1f'), C('#16233f')],
};
let nightK = 0;
function setTime(m, shabbat) {
  const dayStart = 5.5 * 60, dayEnd = 18.75 * 60;
  const t = (m - dayStart) / (dayEnd - dayStart);
  const elev = Math.sin(clamp(t, 0, 1) * Math.PI);
  const az = -Math.PI / 2 + t * Math.PI;
  const night = m < dayStart - 30 || m > dayEnd + 40 ? 1 : m < dayStart ? (dayStart - m) / 30 : m > dayEnd ? (m - dayEnd) / 40 : 0;
  const dusk = clamp(1 - elev * 4, 0, 1) * (1 - night);
  nightK = night;
  const top = SKY.day[0].clone().lerp(SKY.dusk[0], dusk).lerp(SKY.night[0], night);
  const hor = SKY.day[1].clone().lerp(SKY.dusk[1], dusk).lerp(SKY.night[1], night);
  const col = skyGeo.attributes.color, pos = skyGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) { const k = clamp(pos.getY(i) / 2800, 0, 1) ** 0.6; const c = hor.clone().lerp(top, k); col.setXYZ(i, c.r, c.g, c.b); }
  col.needsUpdate = true;
  scene.fog.color.copy(hor);
  sun.intensity = Math.max(0.05, elev) * 2.4 * (1 - night);
  sun.color.set(dusk > 0.3 ? '#ffc58a' : '#fff3dd');
  hemi.intensity = lerp(1.6, 0.3, night) - dusk * 0.25;
  hemi.color.set(night > 0.5 ? '#8fa6d6' : '#e3f0ff');
  W3._sunDir = new THREE.Vector3(Math.cos(az) * Math.cos(Math.asin(elev * 0.9)), Math.max(0.08, elev * 0.9), Math.sin(az) * 0.4 + 0.3).normalize();
  wallMat.emissiveIntensity = night * 0.9;
  if (lampMat) lampMat.emissiveIntensity = night * 1.6;
  sunDisc.visible = night < 0.5;
  if (shabbat !== shabbatLook) { shabbatLook = shabbat; npcShabbat = shabbat; setPlayerLook(player.gender, shabbat); npcs.forEach(n => { if (!n.car && n.model.userData.shirtMat) n.model.userData.shirtMat.color.set(shabbat ? '#ffffff' : rpick(SHIRTS)); }); }
  const hour = m / 60;
  npcTarget = shabbat ? { w: MOBILE ? 12 : 18, c: 0 } : hour < 6 || hour > 22 ? { w: 1, c: 1 } : { w: MOBILE ? 7 : 12, c: MOBILE ? 3 : 5 };
}

// ===================== input =====================
const touch = document.getElementById('touch'), joy = document.getElementById('joy'), knob = document.getElementById('knob');
const ptr = new Map();
let pinchD = 0;
touch.addEventListener('pointerdown', e => {
  touch.setPointerCapture(e.pointerId);
  const isJoy = cam.view !== 'top' && e.clientX < innerWidth * 0.42 && e.clientY > innerHeight * 0.3 && ![...ptr.values()].some(p => p.joy);
  ptr.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, joy: isJoy, t: performance.now(), moved: 0 });
  if (isJoy) { joy.style.display = 'block'; joy.style.left = e.clientX - 60 + 'px'; joy.style.top = e.clientY - 60 + 'px'; knob.style.transform = 'translate(0,0)'; }
  if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinchD = Math.hypot(a.x - b.x, a.y - b.y); }
});
touch.addEventListener('pointermove', e => {
  const p = ptr.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.moved += Math.abs(dx) + Math.abs(dy);
  if (p.joy) {
    let vx = e.clientX - p.sx, vy = e.clientY - p.sy; const l = Math.hypot(vx, vy), R = 50;
    if (l > R) { vx = (vx / l) * R; vy = (vy / l) * R; }
    knob.style.transform = `translate(${vx}px,${vy}px)`;
    input.jx = vx / R; input.jy = -vy / R;
  } else if (cam.view === 'top') {
    if (ptr.size === 2) { const [a, b] = [...ptr.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinchD) cam.top.h = clamp(cam.top.h * (pinchD / d), 60, 900); pinchD = d; }
    else { const k = cam.top.h / innerHeight * 1.1; cam.top.x -= dx * k; cam.top.z -= dy * k; cam.top.x = clamp(cam.top.x, -500, 500); cam.top.z = clamp(cam.top.z, -600, 500); }
  } else {
    cam.dragging = true;
    cam.yaw -= dx * 0.0062; cam.pitch = clamp(cam.pitch + dy * 0.004, -0.25, 1.25);
  }
  p.x = e.clientX; p.y = e.clientY;
});
const ptrEnd = e => {
  const p = ptr.get(e.pointerId); if (!p) return;
  ptr.delete(e.pointerId);
  if (p.joy) { input.jx = input.jy = 0; joy.style.display = 'none'; }
  if (![...ptr.values()].some(q => !q.joy)) cam.dragging = false;
  if (ptr.size < 2) pinchD = 0;
  if (p.moved < 10 && performance.now() - p.t < 400 && e.type === 'pointerup') tap(e.clientX, e.clientY);
};
touch.addEventListener('pointerup', ptrEnd);
touch.addEventListener('pointercancel', ptrEnd);
touch.addEventListener('wheel', e => { e.preventDefault(); if (cam.view === 'top') cam.top.h = clamp(cam.top.h * (e.deltaY > 0 ? 1.12 : 0.89), 60, 900); else cam.dist = clamp(cam.dist * (e.deltaY > 0 ? 1.1 : 0.9), 3, 25); }, { passive: false });
addEventListener('keydown', e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return; input.keys[e.code] = true; if (e.code === 'KeyE' && W3.onKeyAction) W3.onKeyAction(); if (e.code === 'KeyC') toggleView(); });
addEventListener('keyup', e => { input.keys[e.code] = false; });
addEventListener('blur', () => { input.keys = {}; input.jx = input.jy = 0; });
const ray = new THREE.Raycaster();
function tap(cx, cy) {
  if (cam.view !== 'top' || !W3.onTopPick) return;
  ray.setFromCamera(new THREE.Vector2((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1), camera);
  if (cam.topKind === 'plot') {
    const hit = ray.intersectObjects(plotGroup.children)[0];
    if (hit) W3.onTopPick(hit.object.userData.plot);
  } else {
    const hit = ray.intersectObjects(W3.pickables)[0];
    if (hit) W3.onTopPick(hit.object.userData.tri[hit.faceIndex]);
  }
}
function toggleView() { if (cam.view === 'top') return; cam.view = cam.view === 'third' ? 'first' : 'third'; }

// ===================== minimap =====================
const mini = document.getElementById('mini'), mctx = mini.getContext('2d');
const MAPC = document.createElement('canvas'), MR = { x0: -420, z0: -470, x1: 430, z1: 440 }, MS = 1.2;
function buildMinimap() {
  MAPC.width = Math.round((MR.x1 - MR.x0) * MS); MAPC.height = Math.round((MR.z1 - MR.z0) * MS);
  const x = MAPC.getContext('2d');
  paintGround(x, MR.x0, MR.z0, MS, MAPC.width, MAPC.height, false);
  x.setTransform(MS, 0, 0, MS, -MR.x0 * MS, -MR.z0 * MS);
  for (const b of M.buildings) { x.beginPath(); b.p.forEach((q, i) => (i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]))); x.closePath(); x.fillStyle = b.id === homeId ? '#f2c14e' : '#c25a3f'; x.fill(); }
}
function drawMini() {
  const W = mini.width, H = mini.height, s = 1.5;
  mctx.save(); mctx.clearRect(0, 0, W, H);
  mctx.beginPath(); mctx.arc(W / 2, H / 2, W / 2 - 2, 0, 7); mctx.clip();
  mctx.fillStyle = '#b4b07c'; mctx.fillRect(0, 0, W, H);
  mctx.translate(W / 2, H / 2); mctx.rotate(Math.PI + cam.yaw); mctx.scale(s, s);
  mctx.drawImage(MAPC, (MR.x0 - player.x) * 1, (MR.z0 - player.z) * 1, MAPC.width / MS, MAPC.height / MS);
  const dot = (x, z, c, r) => { mctx.beginPath(); mctx.arc(x - player.x, z - player.z, r / s, 0, 7); mctx.fillStyle = c; mctx.fill(); mctx.lineWidth = 1.5 / s; mctx.strokeStyle = '#fff'; mctx.stroke(); };
  for (const g of facGroup.children) dot(g.position.x, g.position.z, '#3d8bff', 3.5);
  if (homeId && houseById[homeId]) dot(houseById[homeId].b.c[0], houseById[homeId].b.c[1], '#f2c14e', 4.5);
  if (myCar.model && player.mode !== 'drive') dot(myCar.x, myCar.z, '#e04e39', 3);
  if (guide) dot(guide.x, guide.z, '#59b6ff', 5);
  mctx.restore();
  mctx.save(); mctx.translate(W / 2, H / 2); // player arrow (always pointing up = camera direction)
  const rel = player.mode === 'drive' ? myCar.heading - cam.yaw : player.heading - cam.yaw;
  mctx.rotate(-rel);
  mctx.beginPath(); mctx.moveTo(0, -8); mctx.lineTo(6, 6); mctx.lineTo(0, 3); mctx.lineTo(-6, 6); mctx.closePath();
  mctx.fillStyle = '#e04e39'; mctx.fill(); mctx.strokeStyle = '#fff'; mctx.lineWidth = 1.5; mctx.stroke();
  mctx.restore();
  mctx.beginPath(); mctx.arc(W / 2, H / 2, W / 2 - 2, 0, 7); mctx.lineWidth = 3; mctx.strokeStyle = '#fffdf8'; mctx.stroke();
}

// ===================== main loop =====================
let last = performance.now(), miniT = 0;
function frame(now) {
  W3.frames = (W3.frames || 0) + 1;
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!frozen && cam.view !== 'top') updatePlayer(dt);
  else if (player.model) animatePerson(player.model, 0, dt);
  updateNPCs(dt);
  for (const f of family) { f.t += dt; f.model.position.y = heightAt(f.model.position.x, f.model.position.z) + (f.kid ? Math.max(0, Math.sin(f.t * 5)) * 0.25 : 0); }
  updateCamera(dt);
  // sun & shadow follow the player
  if (W3._sunDir) { sun.position.set(player.x + W3._sunDir.x * 150, player.y + W3._sunDir.y * 150, player.z + W3._sunDir.z * 150); sun.target.position.set(player.x, player.y, player.z); }
  sky.position.copy(camera.position);
  if (W3._sunDir) { sunDisc.position.copy(camera.position).addScaledVector(W3._sunDir, 2500); sunDisc.lookAt(camera.position); }
  if (homeId && houseById[homeId]) { const h = houseById[homeId]; homeMark.visible = cam.view !== 'top'; homeMark.position.set(h.b.c[0], h.top + 5 + Math.sin(now / 400) * 0.4, h.b.c[1]); homeMark.rotation.y = now / 700; }
  if (guide) { beam.visible = true; beam.position.set(guide.x, heightAt(guide.x, guide.z) + 35, guide.z); beam.material.opacity = 0.2 + Math.sin(now / 300) * 0.08; } else beam.visible = false;
  for (const g of facGroup.children) if (g.userData.flag) g.userData.flag.rotation.y = Math.sin(now / 500) * 0.2;
  renderer.render(scene, camera);
  if (now - miniT > 90) { miniT = now; drawMini(); if (W3.onFrame) W3.onFrame(); }
  requestAnimationFrame(frame);
}

// ===================== public API for the game logic =====================
const W3 = window.W3 = {
  MOBILE, heightAt, houses, houseById, gate,
  get frozen() { return frozen; }, set frozen(v) { frozen = v; if (v) { input.jx = input.jy = 0; joy.style.display = 'none'; } },
  pos: () => ({ x: player.x, z: player.z, mode: player.mode, speed: player.mode === 'drive' ? Math.abs(myCar.speed) : player.speed }),
  car: () => ({ x: myCar.x, z: myCar.z, type: myCar.type, speed: myCar.speed, heading: myCar.heading }),
  attract: true,
  setRun(v) { input.run = v; },
  setPlayer(gender) { setPlayerLook(gender, shabbatLook); },
  setHome(id) { homeId = id; buildMinimap(); },
  setFamily, setFacilities, setTime, setCar,
  teleport(x, z, heading) { player.x = x; player.z = z; player.y = heightAt(x, z); if (heading !== undefined) { player.heading = heading; cam.yaw = heading; } if (player.model) { player.model.position.set(x, player.y, z); player.model.rotation.y = player.heading; } camera.position.set(x - Math.sin(cam.yaw) * 7, player.y + 4, z - Math.cos(cam.yaw) * 7); },
  placeCar(x, z, heading) { myCar.x = x; myCar.z = z; myCar.heading = heading; myCar.speed = 0; placeCarModel(); },
  enterCar() { player.mode = 'drive'; player.model.visible = false; myCar.speed = 0; cam.yaw = myCar.heading; },
  exitCar() {
    player.mode = 'walk'; myCar.speed = 0;
    const sx = Math.cos(myCar.heading), sz = -Math.sin(myCar.heading);
    let [x, z] = collide(myCar.x + sx * 2.2, myCar.z + sz * 2.2, 0.4);
    W3.teleport(x, z, myCar.heading); player.model.visible = true;
  },
  setGuide(g) { guide = g; },
  getGuide: () => guide,
  view: () => cam.view, toggleView,
  topView(kind, list, onPick, center) {
    cam.view = 'top'; cam.topKind = kind; W3.onTopPick = onPick;
    cam.top = { x: center ? center[0] : 0, z: center ? center[1] : -10, h: center ? 160 : 560 };
    showPlots(kind === 'plot' ? list : null);
  },
  topFocus(x, z, h) { if (cam.top) Object.assign(cam.top, { x, z, h: h || cam.top.h }); },
  exitTop() { cam.view = 'third'; W3.onTopPick = null; showPlots(null); },
  cameraYaw: () => cam.yaw,
  nearestRoad,
  start() { requestAnimationFrame(frame); },
};

// ===================== build everything =====================
export async function buildWorld(progress) {
  const step = async (msg, fn) => { progress && progress(msg); await new Promise(r => setTimeout(r, 30)); fn(); };
  await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]);
  await step('מצייר את השטח והגבעות...', () => {
    scene.add(terrainMesh(OUT, MOBILE ? 20 : 14, groundTex(OUT, 0.75, false), IN));
    scene.add(terrainMesh(IN, MOBILE ? 5 : 4, groundTex(IN, MOBILE ? 3.2 : 4.4, true)));
  });
  await step('בונה 144 בתים...', () => { M.buildings.forEach(b => addCollider(ring(b.p))); buildHouses(); });
  await step('שותל עצים...', () => { buildTrees(); buildLamps(); });
  await step('מציב שלטים ושער...', () => { buildGate(); buildBusStops(); buildStreetSigns(); });
  await step('מכין את המפה הקטנה...', () => buildMinimap());
  setPlayerLook('m', false);
  setTime(10 * 60, false);
  W3.teleport(-120, -150, Math.PI);
}
