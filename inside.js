'use strict';
// Inside buildings: your house (move the furniture, cook), neighbours' houses, the synagogue with a real minyan,
// your work place (a teacher really stands in a classroom with the kids), the tremp station, and the type-anything shop.
// Uses the globals of life.js (S, ui, toast, modal, fade, ...).

// ===================== entering / leaving =====================
function fadeQuick(during, after) {
  const f = $('#fade'); f.textContent = ''; f.classList.add('on');
  setTimeout(() => { during(); setTimeout(() => { f.classList.remove('on'); after && after(); }, 250); }, 320);
}
function enterPlace(kind, spec, opts = {}) {
  if (W3.pos().mode === 'drive') W3.exitCar();
  const L = W3.local(), p = W3.pos();
  const ret = opts.ret || [p.x, p.z, L.heading + Math.PI];
  closePanel();
  fadeQuick(() => {
    W3.enterInterior(spec);
    const [sx, sz, sh] = spec.spawn;
    W3.teleport(W3.IO.x + sx, W3.IO.z + sz, sh);
    ui.inside = { kind, name: opts.name || '', ret, spots: opts.spots || (() => []), data: opts.data || {} };
    document.body.classList.add('inside');
    lastActs = '';
  }, opts.after);
}
function leavePlace(after) {
  const r = ui.inside; if (!r) return;
  if (W3.isCarrying()) dropFurniture();
  fadeQuick(() => {
    W3.exitInterior(); ui.inside = null; document.body.classList.remove('inside'); lastActs = '';
    if (r.ret) W3.teleport(r.ret[0], r.ret[1], r.ret[2]);
    if (typeof after === 'function') after();
  });
}
const nearL = (x, z, r) => { const L = W3.local(); return Math.hypot(L.x - x, L.z - z) < r; };
const male = o => ({ kippah: true, kippahColor: pick(['#1d3f7a', '#222', '#ffffff', '#3a6ea5', '#7a1f2b']), hair: pick(['#2a2a2a', '#5a3a22', '#8a6a45']), ...o });
const female = o => ({ skirt: true, hair: pick(['#3a2a1a', '#6b4423', '#c9a36a', '#1a1a1a']), long: true, shirt: pick(['#b35c7a', '#5b7c99', '#9b6fd6', '#f2a03d', '#ffffff']), ...o });
const kidLook = k => (k.g === 'b' ? { scale: clamp(0.35 + k.age * 0.045, 0.38, 0.95), kippah: k.age >= 3, shirt: pick(['#e04e39', '#3b8fd6', '#2f9e5b', '#f2c200']), hair: '#4a3020' } : { scale: clamp(0.35 + k.age * 0.045, 0.38, 0.95), skirt: true, hair: pick(['#6b4423', '#c9a36a', '#3a2a1a']), long: true, shirt: pick(['#e86fa0', '#9b6fd6', '#f2a03d']) });

// ===================== a house (yours or a neighbour's) =====================
const HOUSE_WALLS = [
  [-8, 5.5, -0.7, 5.5], [0.7, 5.5, 8, 5.5], // front, with the door in the middle
  [-8, -5.5, -4.6, -5.5], [-3.4, -5.5, 8, -5.5], // back, door to the yard
  [-8, -5.5, -8, 5.5], [8, -5.5, 8, 5.5],
  [-8, -0.5, -4.6, -0.5], [-3.4, -0.5, 3.4, -0.5], [4.6, -0.5, 8, -0.5], // rooms
  [0, -5.5, 0, -0.5],
  [-8, -5.5, -8, -11.5, 1.1, '#a8865a'], [8, -5.5, 8, -11.5, 1.1, '#a8865a'], [-8, -11.5, 8, -11.5, 1.1, '#a8865a'], // yard fence
];
const HOUSE_FIXED = [
  { m: 'counter', x: 7.62, z: 3.3, r: -Math.PI / 2, o: { w: 3 } },
  { m: 'stove', x: 7.62, z: 1.1, r: -Math.PI / 2 },
  { m: 'exit', x: 0, z: 4.9, r: 0 },
];
const SLOTS = {
  sofa: [-4.5, 1.6, 0], tv: [-4.5, 5.05, Math.PI], console: [-3.6, 5.0, Math.PI], table: [4.3, 2.6, Math.PI / 2], books: [-7.6, 2.6, Math.PI / 2], piano: [-1.4, 4.95, Math.PI],
  fridge: [6.3, 5.0, Math.PI], plata: [7.62, 2.6, -Math.PI / 2], oven: [7.62, 3.9, -Math.PI / 2], dishwasher: [7.62, 0.2, -Math.PI / 2],
  bed: [-4, -3.4, 0], closet: [-7.5, -2.6, Math.PI / 2], ac: [-4, -5.25, 0], bunk: [6.6, -3.2, 0], toys: [2.2, -4.7, 0], desk: [3.8, -1.3, Math.PI],
  swing: [5.8, -8.8, 0], tramp: [1.8, -9.3, 0], bbq: [-1.8, -10.9, 0], sukkah: [-5, -8.6, 0], pergola: [-1, -7.4, 0], dog: [3, -6.6, 0.5],
};
const FREE_IN = [[-1.6, 0.8], [-2.6, 2.8], [-6.8, 4.6], [-6.8, 0.4], [1.4, 4.6], [2.6, 0.6], [-6.4, -1.4], [-1.6, -1.6], [1.4, -2.2], [5, -1.4], [-0.8, 2.6], [3, 4.6]];
const FREE_OUT = [[-6, -6.6], [6.5, -6.4], [-3, -10.6], [4.5, -10.6], [0, -8.6], [-6.8, -10.8]];
const ITEM_OY = { oven: 0.72 };
function furnitureList() { // everything you own that stands in the house: [key, model, opts, defaultSlot]
  const list = [];
  for (const id of S.items) { const it = D.shop.find(i => i.id === id); if (it && SLOTS[id]) list.push([id, id === 'console' ? 'console' : id, {}, SLOTS[id], it.name]); }
  let a = 0, b = 0;
  for (const it of S.inv) if (it.place) {
    const outside = it.t === 'garden' || it.t === 'pet';
    const slot = outside ? FREE_OUT[b++ % FREE_OUT.length] : FREE_IN[a++ % FREE_IN.length];
    list.push([it.key, /כלב|כלבלב|גור/.test(it.n) ? 'dog' : 'generic', { icon: it.i }, [slot[0], slot[1], 0], it.n]);
  }
  return list;
}
function houseSpec(own, seedId) {
  const props = [...HOUSE_FIXED];
  if (own) {
    if (!S.items.includes('fridge')) props.push({ m: 'fridge', x: 6.3, z: 5.0, r: Math.PI, o: { } }); // a small old fridge until you buy one
    for (const [key, m, o, slot] of furnitureList()) {
      const p = S.furn[key] || { x: slot[0], z: slot[1], r: slot[2] };
      props.push({ m, x: p.x, z: p.z, r: p.r, key, o, y: ITEM_OY[key] || 0 });
    }
  } else { // a neighbour's furniture, always the same for the same house
    let s = seedId; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (const id of ['sofa', 'tv', 'table', 'books', 'fridge', 'bed', 'closet', 'bunk', 'toys', 'desk', 'swing', 'tramp', 'bbq', 'sukkah', 'dog', 'piano']) if (rnd() < 0.65) { const sl = SLOTS[id]; props.push({ m: id, x: sl[0], z: sl[1], r: sl[2], o: { color: pick(['#5b7c99', '#8a6a45', '#6b8e5a', '#9b5b5b', '#c9b48a']) } }); }
    props.push({ m: 'rug', x: -4.5, z: 3, o: { color: pick(['#a8442e', '#2f5f9a', '#6b8e5a']) } });
  }
  return { size: [16, 11], floor: 'wood', areas: [{ x0: 2, z0: -0.5, x1: 8, z1: 5.5, floor: 'tile' }, { x0: -8, z0: -11.5, x1: 8, z1: -5.5, floor: 'grass' }], walls: HOUSE_WALLS, wallColor: own ? '#f6f0e2' : pick(['#f3ead8', '#eef3f6', '#f6efe0']), props, people: [], spawn: [0, 4.2, Math.PI] };
}
function enterHome() {
  const spec = houseSpec(true);
  const m = minOf(S.t), night = m < 6 * 60 || m >= 21 * 60, sh = isShabbat(S.t);
  const kidsAtHome = kidsHome().filter(k => k !== ui.kidRide && k !== ui.kidWalk && !(dayOf(S.t) <= 5 && !sh && m >= 7 * 60 + 25 && m < 14 * 60 && k.age >= 3));
  const spouseLook = S.gender === 'f' ? male({ shirt: sh ? '#ffffff' : '#5b7c99' }) : female({ shirt: sh ? '#ffffff' : '#b35c7a' });
  spec.people.push({ o: spouseLook, x: night ? -3.2 : 5.4, z: night ? -3.3 : 1.6, r: night ? 0 : -Math.PI / 2, label: S.spouse });
  const kidSpots = [[-5.5, 0.4], [3, -3.6], [5, -2], [-2.5, 2.4], [1.5, -8], [-3.5, -8.8], [2.8, 1.2]];
  kidsAtHome.forEach((k, i) => { const [x, z] = kidSpots[i % kidSpots.length]; spec.people.push({ o: kidLook(k), x, z, r: Math.random() * 6, label: k.name, kid: k }); });
  ui.homeKids = kidsAtHome.map((k, i) => ({ k, x: kidSpots[i % kidSpots.length][0], z: kidSpots[i % kidSpots.length][1] }));
  const h = home();
  enterPlace('home', spec, { name: `🏠 הבית שלך — ${addr(bById[S.house])}`, ret: [h.door[0], h.door[1], Math.atan2(h.dir[0], h.dir[1])], spots: homeSpots,
    after: () => { if (!S.seenHome) { S.seenHome = 1; toast('🏠 ברוך הבא הביתה! לך ליד רהיט ולחץ "להזיז" כדי לשים אותו איפה שאתה רוצה. במטבח אפשר לבשל 🍳', 'gold', [], 9000); } } });
}
function homeSpots() {
  if (W3.isCarrying()) return [['📍 להניח כאן', dropFurniture], ['🔄 לסובב', () => W3.rotateCarried()]];
  const acts = [], m = minOf(S.t), night = m >= 20 * 60 || m < 5 * 60;
  if (nearL(0, 4.9, 1.6)) acts.push(['🚪 לצאת מהבית', () => leavePlace()]);
  if (nearL(7, 1.1, 1.7)) acts.push(['🍳 לבשל', cookMenu]);
  const fr = S.furn.fridge || { x: 6.3, z: 5 };
  if (nearL(fr.x, fr.z - 0.6, 1.6)) acts.push(['🧊 לפתוח את המקרר', fridgeMenu]);
  const bd = S.items.includes('bed') ? S.furn.bed || { x: -4, z: -3.4 } : { x: -4, z: -3.4 };
  if (nearL(bd.x, bd.z, 2.2)) acts.push([night ? '😴 ללכת לישון' : '😴 לישון (רק בלילה)', sleepAtHome]);
  for (const hk of ui.homeKids || []) if (nearL(hk.x, hk.z, 1.6)) { acts.push([`🎲 לשחק עם ${hk.k.name}`, () => ACT.play(S.kids.indexOf(hk.k))]); break; }
  // the closest furniture you can move
  let best = null, bdist = 1.9; const L = W3.local();
  for (const [key, , , slot, name] of furnitureList()) { const p = S.furn[key] || { x: slot[0], z: slot[1] }; const d = Math.hypot(L.x - p.x, L.z - p.z); if (d < bdist) { bdist = d; best = [key, name]; } }
  if (best) acts.push([`✋ להזיז: ${best[1]}`, () => { if (W3.carry(best[0])) { ui.carryKey = best[0]; toast(`✋ ה${best[1]} אצלך! לך למקום החדש ולחץ "להניח כאן"`, 'blue'); } }]);
  return acts;
}
function dropFurniture() {
  const r = W3.drop();
  if (r && r.key) { S.furn[r.key] = { x: +r.x.toFixed(2), z: +r.z.toFixed(2), r: +r.r.toFixed(3) }; save(); toast('📍 הונח! איזה בית יפה 🏡', 'gold', [], 2500); }
  ui.carryKey = null;
}
function sleepAtHome() {
  const m = minOf(S.t);
  if (!(m >= 20 * 60 || m < 5 * 60)) return toast('עוד לא לילה! 😄 הולכים לישון אחרי 20:00', 'blue');
  sleep();
}
const RECIPES = [
  { id: 'salad', n: 'סלט ישראלי', i: '🥗', min: 10, h: 3, need: ['עגבניה', 'מלפפון'], cost: 10 },
  { id: 'shakshuka', n: 'שקשוקה', i: '🍳', min: 20, h: 5, need: ['ביצה', 'עגבניה'], cost: 20 },
  { id: 'pasta', n: 'פסטה ברוטב עגבניות', i: '🍝', min: 25, h: 5, need: ['פסטה', 'עגבניה'], cost: 15 },
  { id: 'schnitzel', n: 'שניצל וצ׳יפס', i: '🍗', min: 45, h: 7, need: ['עוף', 'תפוח אדמה'], cost: 45 },
  { id: 'cake', n: 'עוגת שוקולד', i: '🎂', min: 50, h: 8, need: ['קמח', 'ביצה', 'שוקולד'], cost: 30 },
  { id: 'challah', n: 'חלות לשבת', i: '🥖', min: 90, h: 6, need: ['קמח'], cost: 15, shabbat: true },
  { id: 'chamin', n: 'חמין לשבת', i: '🍲', min: 60, h: 6, need: ['תפוח אדמה', 'בשר'], cost: 60, shabbat: true },
];
const invHas = n => S.inv.find(it => it.n === n && it.qty > 0);
function cookMenu() {
  if (isShabbat(S.t)) return toast('🕯️ בשבת לא מבשלים — אוכלים את מה שחם על הפלטה', 'red');
  modal({
    icon: '🍳', title: 'מה מבשלים?', list: true,
    text: 'אם יש לך את המצרכים במקרר (קונים בחנות 🛒) — זה בחינם. אם לא, קונים אותם עכשיו.',
    buttons: [...RECIPES.map(r => { const missing = r.need.filter(n => !invHas(n)); return { t: `${r.i} ${r.n} · ${r.min} דק׳`, fn: () => cook(r), disabled: null, sub: missing.length ? `חסר: ${missing.join(', ')} (₪${r.cost})` : '✓ יש הכול' }; }), { t: 'ביטול', cls: 'sec' }],
  });
}
function cook(r) {
  const missing = r.need.filter(n => !invHas(n));
  if (missing.length && S.money < r.cost) return toast('אין לך מספיק כסף למצרכים 😬', 'red');
  r.need.forEach(n => { const it = invHas(n); if (it) it.qty--; });
  S.inv = S.inv.filter(it => it.qty > 0);
  if (missing.length) S.money -= r.cost;
  fade(`${r.i} מבשלים ${r.n}...`, () => { advanceSilent(r.min); boostFam(r.h); if (r.shabbat && dayOf(S.t) >= 4) S.shabbatFood = weekNo(); },
    () => modal({ icon: `${r.i}😋`, title: `${r.n} מוכן!`, text: `${missing.length ? `קנית את המצרכים החסרים (₪${r.cost}). ` : ''}כל המשפחה ישבה לאכול ואמרה שזה הכי טעים שיש! 😊 +${r.h}${r.shabbat ? (dayOf(S.t) >= 4 ? '<br>🕯️ האוכל לשבת מוכן — הסעודה תהיה מעולה!' : '<br>(אוכל לשבת עדיף לבשל ביום חמישי או שישי 😉)') : ''}`, buttons: [{ t: 'בתיאבון! 🍽️' }] }));
}
function fridgeMenu() {
  const food = S.inv.filter(it => (it.t === 'food' || it.t === 'drink') && it.qty > 0);
  if (!food.length) return modal({ icon: '🧊', title: 'המקרר ריק!', text: 'אין כלום במקרר... אפשר לקנות אוכל בחנות 🛒 (כפתור העגלה למטה).', buttons: [{ t: '🛒 לחנות', fn: () => openPanel('shop') }, { t: 'סגור', cls: 'sec' }] });
  modal({ icon: '🧊', title: 'מה יש במקרר?', list: true, buttons: [...food.map(it => ({ t: `${it.i} ${it.n} ×${it.qty}`, fn: () => useItem(it.key) })), { t: 'סגור', cls: 'sec' }] });
}

// ---- neighbours ----
const NEIGHBOR_LINES = ['איזה כיף שבאת! רוצה קפה?', 'שמענו שאתה ראש היישוב החדש — כל הכבוד!', 'הילדים שלנו בבני עקיבא, הם מתים על המדריכים!', 'צריך פה עוד גן שעשועים, לא?', 'בשבת שעברה היה קידוש מהמם בבית הכנסת', 'יש לנו עוגה טרייה, קח חתיכה!', 'מתי פותחים מכולת ביישוב? 🙏'];
function knock(h) {
  const m = minOf(S.t);
  if (m >= 22 * 60 || m < 7 * 60) return toast('🌙 עכשיו כולם ישנים — לא נעים לדפוק בדלת', 'blue');
  const s = (h.id + today()) % 4;
  if (s === 0) return toast(`🚪 דפקת בדלת של משפחת ${surname(h.b)}... אין אף אחד בבית`, 'blue');
  const fam = surname(h.b), spec = houseSpec(false, h.id), sh = isShabbat(S.t);
  spec.people.push({ o: male({ shirt: sh ? '#ffffff' : undefined }), x: -2, z: 2.8, r: Math.PI / 4, label: `${pick(D.boys)} ${fam}` });
  spec.people.push({ o: female({ shirt: sh ? '#ffffff' : undefined }), x: 4.5, z: 1.6, r: -Math.PI / 2, label: `${pick(D.girls)} ${fam}` });
  const nk = h.id % 5;
  for (let i = 0; i < nk; i++) { const b = (h.id + i) % 2 === 0; spec.people.push({ o: kidLook({ g: b ? 'b' : 'g', age: 4 + ((h.id + i * 3) % 11) }), x: [-5.5, 3, 5.5, -2.5, 1][i], z: [0.4, -3.4, -2.2, -2.6, -8.5][i], r: i, label: pick(b ? D.boys : D.girls) }); }
  enterPlace('neighbor', spec, {
    name: `🏡 אצל משפחת ${fam} — ${addr(h.b)}`, ret: [h.door[0], h.door[1], Math.atan2(h.dir[0], h.dir[1])],
    spots: () => { const a = []; if (nearL(0, 4.9, 1.6)) a.push(['🚪 לצאת', () => leavePlace()]); if (nearL(-2, 2.8, 1.8) || nearL(4.5, 1.6, 1.8)) a.push(['💬 לדבר', () => toast(`💬 "${pick(NEIGHBOR_LINES)}"`, 'blue', [], 5000)]); return a; },
    after: () => modal({
      icon: '🚪😊', title: `משפחת ${fam}`, text: `"${pick(['שלום', 'היי', 'ברוך הבא', 'איזו הפתעה'])}! ${pick(NEIGHBOR_LINES)}"`,
      buttons: [
        { t: '☕ לשבת לקפה ועוגה', fn: () => fade('☕ יושבים לקפה...', () => { advanceSilent(25); boostTown(1); S.fh = clamp(S.fh + 1, 0, 100); }, () => toast(`☕ ישבת עם משפחת ${fam} — הם ממש נחמדים!`, 'gold')) },
        { t: '🍷 להזמין אותם לסעודת שבת', fn: () => { if (S.inviteWeek === weekNo()) return toast('כבר הזמנת אורחים השבוע 🙂', 'blue'); S.inviteWeek = weekNo(); boostTown(2); toast(`🍷 משפחת ${fam} תבוא אליכם לסעודת שבת!`, 'gold'); } },
        { t: '👋 רק באתי להגיד שלום', cls: 'sec' },
      ],
    }),
  });
}

// ===================== synagogue + minyan =====================
function prayerNow() {
  const m = minOf(S.t), d = dayOf(S.t);
  if (d === 5 && m >= 17 * 60 + 15 && m < 19 * 60) return 'קבלת שבת';
  if (d === 6) { if (m >= 8 * 60 && m < 11 * 60 + 30) return 'שחרית של שבת'; if (m >= 17 * 60 && m < 19 * 60) return 'מנחה וערבית'; return null; }
  if (m >= 6 * 60 && m < 8 * 60 + 30) return 'שחרית';
  if ((m >= 13 * 60 && m < 14 * 60 + 30) || (m >= 17 * 60 && m < 18 * 60 + 30)) return 'מנחה';
  if (m >= 19 * 60 && m < 21 * 60 + 30) return 'ערבית';
  return null;
}
function enterSynagogue() {
  const real = has('synagogue'), pr = prayerNow(), sh = isShabbat(S.t), morning = pr && /שחרית/.test(pr);
  const count = pr ? clamp(10 + Math.floor(S.families / 9) + (sh ? 14 : 0), 10, real ? 40 : 14) : 3;
  const spec = real
    ? { size: [18, 14], floor: 'stone', wallColor: '#f4eedf', walls: [[-9, 7, -2.7, 7], [-1.3, 7, 9, 7], [-9, -7, 9, -7], [-9, -7, -9, 7], [9, -7, 9, 7], [-4.5, -7, -4.5, 3.5, 1.7, '#c9b48a']], props: [], people: [], labels: [], spawn: S.gender === 'f' ? [-6.8, 5.5, -Math.PI / 2] : [-2, 5.8, Math.PI / 2 + 0.6] }
    : { size: [11, 6], floor: 'tile', wallColor: '#eef1f2', walls: [[-5.5, 3, -0.7, 3], [0.7, 3, 5.5, 3], [-5.5, -3, 5.5, -3], [-5.5, -3, -5.5, 3], [5.5, -3, 5.5, 3]], props: [], people: [], labels: [], spawn: [0, 2.3, Math.PI] };
  const seats = [];
  if (real) {
    spec.props.push({ m: 'aron', x: 8.5, z: 0, r: -Math.PI / 2 }, { m: 'bima', x: 1.2, z: 0, r: Math.PI / 2 }, { m: 'exit', x: -2, z: 6.4, r: 0 });
    for (const x of [-3.2, -1.8, 4.2, 5.6]) for (const z of [-4.3, 4.3]) { spec.props.push({ m: 'bench', x, z, r: Math.PI / 2, o: { w: 3 } }); for (const k of [-1, 0, 1]) seats.push([x + 0.45, z + k]); }
    for (const z of [-4.3, 4.3]) { spec.props.push({ m: 'bench', x: -7.5, z, r: Math.PI / 2, o: { w: 2.6 } }); }
    for (const x of [-0.6, 3]) for (const z of [-2.2, 2.2]) seats.push([x, z]);
    spec.labels.push({ text: 'שִׁוִּיתִי ה׳ לְנֶגְדִּי תָמִיד', x: 8.6, y: 3.6, z: 0, size: 0.4, bg: '#7a1f2bdd', fg: '#ffe9a8' });
    spec.labels.push({ text: pr ? `🙏 ${pr} — ${count} מתפללים (מניין!)` : '📖 עכשיו אין תפילה — כמה אנשים לומדים', x: -2, y: 2.6, z: 5.4, size: 0.34 });
    spec.labels.push({ text: 'עזרת נשים', x: -6.8, y: 2.2, z: 0, size: 0.3 });
  } else {
    spec.props.push({ m: 'aron', x: 0, z: -2.6, r: 0 }, { m: 'exit', x: 0, z: 2.5, r: 0 });
    for (const z of [-0.8, 0.9]) for (const x of [-3, 3]) { spec.props.push({ m: 'bench', x, z, r: Math.PI, o: { w: 3 } }); for (const k of [-1, 0, 1]) seats.push([x + k, z - 0.45]); }
    spec.labels.push({ text: pr ? `🙏 ${pr} בקרוואן — ${count} מתפללים` : 'קרוואן בית הכנסת הזמני', x: 0, y: 2.5, z: 1.8, size: 0.32 });
  }
  for (let i = 0; i < count && i < seats.length; i++) {
    const [x, z] = seats[i];
    spec.people.push({ o: male({ shirt: sh ? '#ffffff' : pick(['#ffffff', '#dfe8f2', '#3b6ea8', '#4c4c4c']), tallit: morning }), x, z, r: real ? Math.PI / 2 : Math.PI, sway: !!pr });
  }
  if (pr && real) spec.people.push({ o: male({ shirt: '#ffffff', tallit: true, kippahColor: '#ffffff' }), x: 1.2, z: 0.6, r: Math.PI / 2, sway: true, label: 'החזן' });
  if (real && (sh || S.gender === 'f')) for (let i = 0; i < (sh ? 7 : 2); i++) spec.people.push({ o: female({ shirt: sh ? '#ffffff' : undefined }), x: -7.5 + (i % 2) * 0.6, z: -5 + i * 1.3, r: Math.PI / 2, sway: !!pr });
  const ret = (() => { const b = findBuilt('synagogue'); if (b) { const [x, z] = plotXY(b), nr = W3.nearestRoad(x, z); const dx = nr.x - x, dz = nr.y - z, l = Math.hypot(dx, dz) || 1; return [x + (dx / l) * 11, z + (dz / l) * 11, Math.atan2(dx, dz)]; } return [CARAVAN[0], CARAVAN[1] + 6, 0]; })();
  enterPlace('synagogue', spec, {
    name: real ? '🕍 בית הכנסת של גבעות עדן' : '🕍 המניין בקרוואן', ret,
    spots: () => {
      const a = [], L = W3.local();
      if (real ? nearL(-2, 6.3, 1.6) : nearL(0, 2.4, 1.4)) a.push(['🚪 לצאת', () => leavePlace()]);
      const p2 = prayerNow();
      if (p2) a.push([`🙏 להתפלל ${p2}`, () => { clearGuide(); doPray(); }]);
      else a.push(['📖 ללמוד קצת תורה', () => fade('📖 לומדים...', () => { advanceSilent(30); boostTown(0.5); }, () => toast('📖 למדת דף גמרא עם החברותא. יפה! ✨', 'gold'))]);
      return a;
    },
    after: () => { clearGuide(); toast(pr ? `🙏 ${pr} — יש מניין! ${count} מתפללים (צריך לפחות 10)` : '🕍 כרגע אין תפילה. שחרית 6:00, מנחה 13:00/17:00, ערבית 19:00', 'blue', [], 6000); },
  });
}

// ===================== work places =====================
const WORK = {
  teacher: {
    name: 'הכיתה', floor: 'tile', size: [12, 9], wallColor: '#f6f1df',
    build(spec) {
      spec.props.push({ m: 'board', x: 0, z: -4.3, r: 0 }, { m: 'tdesk', x: 2.2, z: -3, r: Math.PI });
      spec.labels.push({ text: `שלום כיתה! היום: ${pick(['חשבון — כפל', 'תורה — פרשת השבוע', 'אנגלית', 'מדעים — מים', 'מולדת — ארץ ישראל'])}`, x: 0, y: 1.75, z: -4.2, size: 0.32, bg: '#2f5a3acc' });
      const mine = kidsHome().filter(k => k.age >= 6 && k.age < 12);
      let i = 0;
      for (const z of [-1.2, 0.5, 2.2]) for (const x of [-4, -2, 0, 2, 4]) {
        spec.props.push({ m: 'sdesk', x, z, r: Math.PI });
        const k = mine[i++];
        spec.people.push(k ? { o: kidLook(k), x, z: z + 0.45, r: Math.PI, sit: true, label: `${k.name} (שלך!)` } : { o: Math.random() < 0.5 ? { scale: 0.62, kippah: true } : { scale: 0.62, skirt: true, hair: pick(['#6b4423', '#3a2a1a']), long: true }, x, z: z + 0.45, r: Math.PI, sit: true });
      }
    },
    tasks: [['📚 ללמד שיעור', 0, -3.4], ['📝 לבדוק מבחנים', 2.2, -2.4], ['🔔 לצלצל להפסקה', -5, -3.5]],
  },
  hitech: {
    name: 'המשרד בהייטק', floor: 'carpet', size: [14, 10], wallColor: '#eef1f4',
    build(spec) {
      for (const x of [-4.5, -1.5, 1.5, 4.5]) for (const z of [-2.5, 0.5]) { spec.props.push({ m: 'pc', x, z, r: Math.PI }); if (Math.random() < 0.8) spec.people.push({ o: Math.random() < 0.5 ? male({}) : female({}), x, z: z + 0.55, r: Math.PI, sit: true }); }
      spec.props.push({ m: 'table', x: 3.5, z: 3, r: 0 }, { m: 'coffee', x: -5.5, z: 3.9, r: Math.PI }, { m: 'plant', x: 6.3, z: -4.3 });
    },
    tasks: [['💻 לכתוב קוד', 0, -0.5], ['🤝 ישיבת צוות', 3.5, 3], ['☕ הפסקת קפה', -5.5, 3.2]],
  },
  doctor: {
    name: 'בית החולים', floor: 'tile', size: [14, 10], wallColor: '#eef6f6',
    build(spec) {
      for (const x of [-5, -2, 1, 4]) { spec.props.push({ m: 'hbed', x, z: -3, r: 0 }); spec.people.push({ o: { shirt: '#9fc5e8' }, x, z: -3.2, r: 0, lie: true }); }
      spec.props.push({ m: 'cabinet', x: 6.4, z: 3.5, r: -Math.PI / 2 }, { m: 'desk', x: -5, z: 3, r: Math.PI });
      spec.people.push({ o: female({ shirt: '#ffffff' }), x: 2, z: 1.5, r: 2, label: 'האחות' });
    },
    tasks: [['🩺 לבדוק את החולים', -0.5, -1.3], ['💊 לרשום תרופות', -5, 2.3], ['📋 לעבור על התיקים', 6, 2.8]],
  },
  builder: {
    name: 'אתר הבנייה', floor: 'dirt', size: [16, 12], wallColor: '#c9c2b3', wallH: 1.4,
    build(spec) {
      spec.props.push({ m: 'bricks', x: -4, z: -3 }, { m: 'bricks', x: -2.5, z: -3.6 }, { m: 'mixer', x: 4, z: -3 }, { m: 'cone', x: 0, z: 2 }, { m: 'cone', x: 1.5, z: 2.4 }, { m: 'crate', x: 5, z: 3 });
      for (let i = 0; i < 4; i++) spec.people.push({ o: male({ shirt: '#f2a03d', kippahColor: '#f2c200' }), x: -5 + i * 3, z: 0, r: i });
    },
    tasks: [['🧱 לבנות קיר', -3.3, -2.2], ['📐 לבדוק את התוכניות', 5, 2.3], ['👷 לחלק עבודה לפועלים', 0, 0.8]],
  },
  driver: {
    name: 'האוטובוס', floor: 'tile', size: [3.2, 12], wallColor: '#2f7d4f', wallH: 2.4,
    build(spec) {
      spec.props.push({ m: 'wheel', x: -0.9, z: -5.2, r: Math.PI });
      for (let z = -3.5; z <= 4.5; z += 1.3) for (const x of [-1, 1]) { spec.props.push({ m: 'busseat', x, z, r: Math.PI }); if (Math.random() < 0.55) spec.people.push({ o: Math.random() < 0.5 ? male({}) : female({}), x: x - 0.25, z: z + 0.1, r: Math.PI, sit: true }); }
      spec.spawn = [0, 5.2, Math.PI];
    },
    tasks: [['🚌 לנהוג בקו 415 לירושלים', -0.9, -4.6], ['🎫 לבדוק כרטיסים', 0, 0], ['🧹 לנקות את האוטובוס', 0, 4.2]],
  },
  farmer: {
    name: 'החממה', floor: 'dirt', size: [14, 10], wallColor: '#cfe8c8', wallH: 2.8,
    build(spec) {
      for (const z of [-3.5, -1, 1.5]) spec.props.push({ m: 'plants', x: 0, z, o: { fruit: true } });
      spec.props.push({ m: 'crate', x: 5.5, z: 3.5 }, { m: 'crate', x: 4.8, z: 3.8 });
      spec.people.push({ o: male({ shirt: '#6b8e5a' }), x: -4, z: 3, r: 1, label: 'השכן החקלאי' });
    },
    tasks: [['🌱 לשתול', -3, -2.2], ['💧 להשקות', 2, 0.3], ['🍅 לקטוף עגבניות', 4, 2.8]],
  },
};
function enterWork(how) {
  const j = job(), W = WORK[j.id];
  S.workedDay = today();
  ui.work = { how, start: S.t, late: minOf(S.t) > 9 * 60, done: [] };
  const [w, d] = W.size;
  const spec = { size: W.size, floor: W.floor, wallColor: W.wallColor, wallH: W.wallH, walls: [[-w / 2, d / 2, -0.7, d / 2], [0.7, d / 2, w / 2, d / 2], [-w / 2, -d / 2, w / 2, -d / 2], [-w / 2, -d / 2, -w / 2, d / 2], [w / 2, -d / 2, w / 2, d / 2]], props: [{ m: 'exit', x: 0, z: d / 2 - 0.6, r: 0 }], people: [], labels: [], spawn: [0, d / 2 - 1.3, Math.PI] };
  W.build(spec);
  const school = findBuilt('school');
  const ret = how === 'school' && school ? (() => { const [x, z] = plotXY(school), nr = W3.nearestRoad(x, z), dx = nr.x - x, dz = nr.y - z, l = Math.hypot(dx, dz) || 1; return [x + (dx / l) * 11, z + (dz / l) * 11, Math.atan2(dx, dz)]; })() : null;
  ui.work.ret = ret;
  enterPlace('work', spec, {
    name: `${j.icon} ${W.name}${how === 'school' ? ' — בית הספר של גבעות עדן' : how === 'fields' ? ' ליד היישוב' : ` — ${j.place}`}`, ret,
    spots: () => {
      const a = [];
      for (const [label, x, z] of W.tasks) if (!ui.work.done.includes(label) && nearL(x, z, 1.9)) a.push([label, () => workTask(label)]);
      if (nearL(0, d / 2 - 0.6, 1.6)) a.push(['🏁 לסיים את יום העבודה', finishWork]);
      return a;
    },
    after: () => toast(`${j.icon} הגעת לעבודה${ui.work.late ? ' (באיחור 😬)' : ''}! יש ${W.tasks.length} משימות — לך אליהן ולחץ. כשמסיימים, לך לדלת.`, 'blue', [], 8000),
  });
}
const TASK_TEXT = {
  '📚 ללמד שיעור': () => { const subj = pick(['חשבון', 'תורה', 'אנגלית', 'מדעים', 'היסטוריה']); kidsHome().filter(k => k.age >= 6 && k.age < 12).forEach(k => (k.h = clamp(k.h + 5, 0, 100))); return `לימדת שיעור ${subj} — הילדים הצביעו ושאלו שאלות! 🙋`; },
  '📝 לבדוק מבחנים': () => `בדקת 25 מבחנים. הממוצע: ${80 + Math.floor(Math.random() * 15)}! 📈`,
  '🔔 לצלצל להפסקה': () => 'צלצלת! כל הילדים רצו לחצר לשחק 🏃‍♂️',
  '💻 לכתוב קוד': () => 'כתבת קוד לאפליקציה חדשה — ובלי באגים! 🐛❌',
  '🤝 ישיבת צוות': () => 'בישיבה הבוס אמר שאתה עובד מצוין 👏',
  '☕ הפסקת קפה': () => 'שתית קפה ודיברת עם החברים לעבודה ☕',
  '🩺 לבדוק את החולים': () => 'בדקת 4 חולים — כולם מרגישים יותר טוב 💪',
  '💊 לרשום תרופות': () => 'רשמת תרופות וחתמת על המרשמים ✍️',
  '📋 לעבור על התיקים': () => 'עברת על כל התיקים הרפואיים 📋',
  '🧱 לבנות קיר': () => 'בנית קיר ישר לגמרי! 🧱',
  '📐 לבדוק את התוכניות': () => 'בדקת את התוכניות ומצאת טעות לפני שהיה מאוחר 📐',
  '👷 לחלק עבודה לפועלים': () => 'חילקת לכל פועל משימה 👷',
  '🚌 לנהוג בקו 415 לירושלים': () => 'נהגת לירושלים וחזרה — כל הנוסעים הגיעו בזמן 🚌',
  '🎫 לבדוק כרטיסים': () => 'בדקת כרטיסים — כולם שילמו 👍',
  '🧹 לנקות את האוטובוס': () => 'האוטובוס מבריק! ✨',
  '🌱 לשתול': () => 'שתלת שורה חדשה של עגבניות 🌱',
  '💧 להשקות': () => 'השקית את כל החממה 💧',
  '🍅 לקטוף עגבניות': () => { addInv(CATALOG.find(c => c.n[0] === 'עגבניה'), 6); return 'קטפת עגבניות — ולקחת 6 הביתה! 🍅'; },
};
function workTask(label) {
  ui.work.done.push(label);
  const msg = TASK_TEXT[label] ? TASK_TEXT[label]() : 'עבודה טובה!';
  fade(`${label}...`, () => advanceSilent(90), () => toast(`${msg}<br><small>✅ ${ui.work.done.length} משימות</small>`, 'gold'));
}
function finishWork() {
  const j = job(), w = ui.work, end = Math.floor(S.t / DAY) * DAY + 17 * 60;
  fade('🏁 מסיימים את יום העבודה...', () => {
    if (S.t < end) advanceSilent(end - S.t);
    S.stats.workdays++;
    const raise = 1 + 0.05 * Math.floor((S.stats.workdays - 1) / 5);
    const bonus = 1 + 0.1 * w.done.length;
    w.pay = Math.round(j.pay * raise * bonus * (w.late ? 0.75 : 1)) - (w.how === 'bus' ? 12 : 0);
    S.money += w.pay; S.fh = clamp(S.fh - 2, 0, 100);
    W3.exitInterior(); ui.inside = null; document.body.classList.remove('inside'); lastActs = '';
    if (w.how === 'car') returnByCar();
    else if (w.how === 'bus') W3.teleport(M.entrance[0] + 3, M.entrance[1] + 3, Math.PI);
    else if (w.how === 'tremp') { const t = W3.gate.tremp; W3.teleport(t[0], t[1], 0); }
    else if (w.ret) W3.teleport(w.ret[0], w.ret[1], w.ret[2]);
    else W3.teleport(FIELDS[0], FIELDS[1], 0);
  }, () => {
    modal({
      icon: j.icon, title: 'יום העבודה נגמר!',
      text: `הרווחת <b>${fmt(w.pay)}</b>${w.done.length ? ` (כולל בונוס על ${w.done.length} משימות 🌟)` : ''}.${w.late ? '<br>😬 איחרת לעבודה, אז קיבלת פחות.' : ''}${w.how === 'bus' ? '<br>🚌 חזרת באוטובוס לתחנה בכניסה (₪12).' : w.how === 'tremp' ? '<br>👍 חזרת בטרמפ לטרמפיאדה.' : w.how === 'car' ? '<br>🚗 חזרת ליישוב — עכשיו סע הביתה!' : ''}${S.stats.workdays % 5 === 0 ? '<br>📈 <b>קיבלת העלאה במשכורת!</b>' : ''}`,
      buttons: [{ t: '🏠 הביתה!', fn: guideHome }],
    });
    ui.work = null; checkMissions(); save();
  });
}
function enterSchoolVisit() {
  const spec = { size: [12, 9], floor: 'tile', wallColor: '#f6f1df', walls: [[-6, 4.5, -0.7, 4.5], [0.7, 4.5, 6, 4.5], [-6, -4.5, 6, -4.5], [-6, -4.5, -6, 4.5], [6, -4.5, 6, 4.5]], props: [{ m: 'exit', x: 0, z: 3.9, r: 0 }], people: [], labels: [], spawn: [0, 3.2, Math.PI] };
  const m = minOf(S.t), hours = dayOf(S.t) <= 5 && !isShabbat(S.t) && m >= 8 * 60 && m < 14 * 60;
  if (hours) { WORK.teacher.build(spec); spec.people.push({ o: female({}), x: 0, z: -3.3, r: 0, label: 'המורה' }); }
  else { spec.props.push({ m: 'board', x: 0, z: -4.3, r: 0 }); for (const z of [-1.2, 0.5, 2.2]) for (const x of [-4, -2, 0, 2, 4]) spec.props.push({ m: 'sdesk', x, z, r: Math.PI }); }
  const [x, z] = plotXY(findBuilt('school')), nr = W3.nearestRoad(x, z), dx = nr.x - x, dz = nr.y - z, l = Math.hypot(dx, dz) || 1;
  enterPlace('school', spec, { name: '🏫 בית הספר של גבעות עדן', ret: [x + (dx / l) * 11, z + (dz / l) * 11, Math.atan2(dx, dz)], spots: () => (nearL(0, 3.9, 1.6) ? [['🚪 לצאת', () => leavePlace()]] : []),
    after: () => toast(hours ? '🏫 עכשיו יש שיעור! הילדים שלך יושבים בכיתה (רואים את השם שלהם מעל הראש).' : '🏫 הכיתה ריקה — הלימודים בין 8:00 ל-14:00', 'blue') });
}

// ===================== tremp =====================
const DRIVERS = ['אבי מצור הדסה', 'רחל מבית שמש', 'נהג משאית חביב', 'יוסי מהשכונה החדשה', 'משפחת לוי מהרחוב שלך', 'שכן שנוסע לירושלים'];
function waitTremp() {
  if (isShabbat(S.t)) return toast('🕯️ בשבת אין טרמפים', 'red');
  const m = minOf(S.t);
  if (m < 6 * 60 || m > 22 * 60) return toast('🌙 בשעה כזאת אף אחד לא נוסע...', 'blue');
  const wait = 5 + Math.floor(Math.random() * 25);
  fade('👍 מחכים לטרמפ...', () => advanceSilent(wait), () => {
    toast(`🚙 אחרי ${wait} דקות — ${pick(DRIVERS)} עצר לך!`, 'gold');
    exitMenu('tremp');
  });
}

// ===================== the shop: type anything =====================
const normHe = s => s.replace(/[׳'"״.,!?]/g, '').replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ').replace(/\s+/g, ' ').trim();
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
function parseBuy(text) {
  let t = normHe(text || ''), qty = 1;
  if (!t) return null;
  const mNum = t.match(/^(\d+)\s*(.*)$/) || t.match(/^(.*?)\s*(\d+)$/);
  if (mNum) { if (/^\d+$/.test(mNum[1])) { qty = +mNum[1]; t = mNum[2]; } else { qty = +mNum[2]; t = mNum[1]; } }
  const first = t.split(' ')[0];
  const words = Object.fromEntries(Object.entries(NUMWORDS).map(([k, v]) => [normHe(k), v]));
  if (words[first] && t.includes(' ')) { qty = words[first]; t = t.slice(first.length).trim(); }
  t = t.replace(/^(לקנות|אני רוצה|רוצה|תביא לי|תן לי)\s+/, '');
  qty = clamp(qty || 1, 1, 99);
  let best = null, bestScore = 0;
  for (const c of CATALOG) for (const name of c.n) {
    const n = normHe(name);
    let score = 0;
    if (t === n || t === 'ה' + n || 'ה' + t === n) score = 100 + n.length;
    else if ((' ' + t + ' ').includes(' ' + n + ' ') || (' ' + t + ' ').includes(' ה' + n + ' ')) score = 50 + n.length;
    else if (n.length >= 4 && lev(t, n) <= 1) score = 30;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (best) return { item: best, qty, known: true };
  const name = (text || '').trim().replace(/^\d+\s*/, '').slice(0, 24);
  return { item: { n: [name], p: 50, i: '📦', t: 'other' }, qty, known: false };
}
function addInv(c, qty) {
  const name = c.n[0];
  const ex = S.inv.find(it => it.n === name && !it.place);
  if (ex && !c.place) { ex.qty += qty; return ex; }
  const it = { key: 'i' + Date.now().toString(36) + Math.floor(Math.random() * 99), n: name, i: c.i, t: c.t, qty, ride: c.ride || null, place: !!c.place };
  S.inv.push(it);
  return it;
}
function buyText(text) {
  const r = parseBuy(text);
  if (!r) return toast('תכתוב מה אתה רוצה לקנות 🙂', 'blue');
  if (isShabbat(S.t)) return toast('🕯️ שבת — החנויות סגורות! מחכים למוצאי שבת.', 'red');
  const cost = r.item.p * r.qty;
  if (S.money < cost) return toast(`אין לך מספיק כסף — זה עולה ${fmt(cost)} 😬`, 'red');
  S.money -= cost;
  addInv(r.item, r.qty);
  const where = has('grocery') && ['food', 'drink'].includes(r.item.t) ? 'במכולת של היישוב' : 'והשליח הביא את זה הביתה 📦';
  toast(`🛍️ קנית ${r.qty > 1 ? r.qty + ' ' : ''}${r.item.n[0]} ${r.item.i} ב-${fmt(cost)} — ${where}${r.known ? '' : '<br><small>(לא הכרתי את זה, אז זה עלה ₪50 😄)</small>'}${r.item.ride ? '<br>🛴 אפשר לרכוב על זה! לחץ "לרכוב" בתיק.' : r.item.place ? '<br>🏠 זה מחכה לך בבית — אפשר להזיז את זה לאן שרוצים.' : ''}`, 'gold', [], 8000);
  if (ui.inside && ui.inside.kind === 'home' && r.item.place) toast('🏠 צא והיכנס הביתה שוב כדי לראות את זה', 'blue', [], 5000);
  checkMissions(); save(); refreshPanel();
}
function useItem(key) {
  const it = S.inv.find(x => x.key === key); if (!it) return;
  const done = () => { S.inv = S.inv.filter(x => x.qty > 0); save(); refreshPanel(); };
  if (it.t === 'food' || it.t === 'drink') { it.qty--; S.fh = clamp(S.fh + 2, 0, 100); toast(`😋 ${it.t === 'drink' ? 'שתית' : 'אכלת'} ${it.n} ${it.i} — טעים!`, 'gold', [], 3000); return done(); }
  if (it.ride) {
    if (W3.pos().mode === 'drive') return toast('קודם צא מהרכב 🙂', 'blue');
    if (isShabbat(S.t)) return toast('🕯️ בשבת לא רוכבים — הולכים ברגל', 'red');
    S.riding = S.riding === it.ride ? null : it.ride; W3.setRide(S.riding);
    toast(S.riding ? `${it.i} עלית על ה${it.n}! עכשיו אתה זז הרבה יותר מהר 💨` : `ירדת מה${it.n}`, 'gold', [], 3000); return done();
  }
  if (it.t === 'toy' || it.t === 'book' && kidsHome().length) {
    const kids = kidsHome(); if (!kids.length) return toast(`${it.i} שיחקת עם ה${it.n} בעצמך 😄`, 'gold');
    return modal({ icon: '🎁', title: `למי לתת את ה${it.n}?`, buttons: [...kids.map(k => ({ t: `${kidIcon(k)} ${k.name}`, fn: () => { k.h = clamp(k.h + 10, 0, 100); it.qty--; toast(`🎁 ${k.name} ${k.g === 'b' ? 'קיבל' : 'קיבלה'} ${it.n} ${it.i} ו${k.g === 'b' ? 'קפץ' : 'קפצה'} משמחה! 🤩`, 'gold'); done(); } })), { t: 'ביטול', cls: 'sec' }] });
  }
  if (it.t === 'clothes') return toast(`${it.i} לבשת ${it.n} — אתה נראה מעולה! 😎`, 'gold', [], 3000);
  if (it.t === 'book') { fade(`${it.i} קוראים...`, () => advanceSilent(30), () => toast(`📖 קראת ב${it.n} — מעניין!`, 'gold')); return; }
  if (it.t === 'pet') return toast(`${it.i} ליטפת את ה${it.n} — הוא שמח! 🐾 (הוא מחכה בחצר של הבית)`, 'gold', [], 3500);
  toast(`${it.i} ${it.n} — שמור אצלך בתיק 🎒`, 'blue', [], 3000);
}
const POPULAR = ['תפוח', 'קורקינט', 'אופניים', 'עוגה', 'פיצה', 'כדורגל', 'ביצים', 'עגבניות', 'קמח', 'שוקולד', 'לגו', 'גלידה', 'כלב', 'סקייטבורד', 'חלה', 'יין'];
PANELS.shop = function () {
  let h = `<div class="note">🛒 <b>כתוב מה שאתה רוצה לקנות — כל דבר!</b><br>למשל: "3 תפוחים", "קורקינט", "עוגה", "כדורסל". יש לך ${fmt(S.money)}${isShabbat(S.t) ? '<br>🕯️ שבת — החנויות סגורות' : ''}</div>
    <div class="shoprow"><input id="shopIn" class="t" placeholder="מה לקנות?" autocomplete="off"><button class="btn" data-a="shopbuy">🛒 לקנות</button></div>
    <div id="shopPrev" class="shopprev"></div>
    <div class="chips">${POPULAR.map(p => `<button data-a="shopq:${p}">${p}</button>`).join('')}</div>
    <div class="sect">🎒 מה יש לי</div>`;
  if (!S.inv.length) h += '<div class="note">התיק ריק. קנה משהו! 🛍️</div>';
  for (const it of S.inv) {
    const btn = it.t === 'food' || it.t === 'drink' ? (it.t === 'drink' ? '🥤 לשתות' : '😋 לאכול') : it.ride ? (S.riding === it.ride ? '⬇️ לרדת' : '🛴 לרכוב') : it.t === 'toy' ? '🎁 לתת' : it.t === 'clothes' ? '👕 ללבוש' : it.t === 'book' ? '📖 לקרוא' : it.t === 'pet' ? '🐾 ללטף' : it.place ? '🏠 בבית' : '👀';
    h += item(it.i, `${esc(it.n)}${it.qty > 1 ? ` ×${it.qty}` : ''}`, { food: 'אוכל', drink: 'שתייה', ride: 'לרכוב', furniture: 'רהיט לבית', electronic: 'מכשיר', toy: 'צעצוע', clothes: 'בגדים', book: 'ספר', pet: 'חיית מחמד', garden: 'לגינה', tool: 'כלי עבודה', other: 'שונות' }[it.t] || '', `<button data-a="use:${it.key}">${btn}</button>`);
  }
  return {
    title: '🛒 חנות + 🎒 תיק', html: h,
    bind() {
      const inp = $('#shopIn'), prev = $('#shopPrev');
      const show = () => { const r = parseBuy(inp.value); prev.innerHTML = r ? `${r.item.i} <b>${r.qty > 1 ? r.qty + ' × ' : ''}${esc(r.item.n[0])}</b> — ${fmt(r.item.p * r.qty)}${r.known ? '' : ' <small>(לא מכיר — מחיר משוער)</small>'}` : ''; };
      inp.oninput = show;
      inp.onkeydown = e => { if (e.key === 'Enter') buyText(inp.value); };
      if (ui.shopDraft) { inp.value = ui.shopDraft; show(); ui.shopDraft = ''; }
    },
  };
};
ACT.shopbuy = () => buyText($('#shopIn').value);
ACT.shopq = q => { ui.shopDraft = q; refreshPanel(); };
ACT.use = key => useItem(key);
