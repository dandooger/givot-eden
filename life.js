'use strict';
// The life of the head of Givot Eden: time, Shabbat, prayers, work, family, building — on top of the 3D world (window.W3).
const M = window.MAP, D = window.DATA;
const $ = s => document.querySelector(s);
const DAY = 1440, WEEK = 7 * DAY;
const SH_IN = 5 * DAY + 17 * 60 + 30;  // Friday 17:30 — candle lighting
const SH_OUT = 6 * DAY + 18 * 60 + 45; // Saturday 18:45 — havdalah
const SPEEDS = [1, 5, 20];            // game minutes per real second
const SAVE_KEY = 'givot-eden-v1';
const TAX = [{ name: 'נמוכה', rate: 700, mood: 5 }, { name: 'רגילה', rate: 900, mood: 0 }, { name: 'גבוהה', rate: 1200, mood: -7 }];

const fmt = n => (n < 0 ? '-' : '') + '₪' + Math.abs(Math.round(n)).toLocaleString('en-US');
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hhmm = t => { const m = ((t % DAY) + DAY) % DAY; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const dayOf = t => Math.floor((t % WEEK) / DAY);
const minOf = t => t % DAY;
const isShabbat = t => { const w = t % WEEK; return w >= SH_IN && w < SH_OUT; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

const bById = {};
M.buildings.forEach(b => (bById[b.id] = b));
const surname = b => D.surnames[b.id % D.surnames.length];
const addr = b => `רחוב ${b.st} ${b.n}`;

let S = null;
const ui = { paused: false, busy: null, placing: null, picking: false, modal: false, mq: [], later: [], panel: null, tab: {}, silent: false, facId: null, acc: 0, gateArmed: true, kidRide: null, kidWalk: null, guide: null, top: false };
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
function save() {
  if (!S) return;
  try {
    const p = W3.pos(), c = W3.car();
    S.pos = W3.inside() && ui.inside && ui.inside.ret ? { x: ui.inside.ret[0], z: ui.inside.ret[1], mode: 'walk' } : { x: p.x, z: p.z, mode: p.mode };
    if (S.car) S.carAt = { x: c.x, z: c.z, h: c.heading };
    localStorage.setItem(SAVE_KEY, JSON.stringify(S));
  } catch (e) {}
}
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
const kidIcon = k => k.age < 3 ? '👶' : k.age >= 18 ? '🪖' : k.g === 'b' ? (k.age < 13 ? '👦' : '🧑') : (k.age < 13 ? '👧' : '👩');
const plotXY = b => [M.plots[b.plot].x, M.plots[b.plot].y];
const home = () => W3.houseById[S.house];
const FIELDS = (() => { let best = [0, 300], bd = Infinity; for (const a of M.areas) if (a.k === 'farmland') for (const p of a.p) { const d = Math.hypot(p[0], p[1]); if (d < bd) { bd = d; best = p; } } return best; })();
const CARAVAN = (() => { let best = [0, 0], bd = Infinity; for (const a of M.areas) if (a.k === 'park') { const c = [a.p.reduce((s, p) => s + p[0], 0) / a.p.length, a.p.reduce((s, p) => s + p[1], 0) / a.p.length]; const d = Math.hypot(c[0], c[1]); if (d < bd) { bd = d; best = c; } } return best; })();

function happy() {
  let h = 36 + TAX[S.tax].mood + S.boost;
  const c = {};
  for (const b of S.built) if (b.done) { const n = (c[b.type] = (c[b.type] || 0) + 1); h += D.facilities[b.type].happy * (n === 1 ? 1 : n === 2 ? 0.4 : 0.15); }
  if (has('bneiakiva')) h += (S.ba.club ? 4 : 0) + (S.ba.painted ? 2 : 0);
  return clamp(Math.round(h), 0, 100);
}
function stars() {
  const f = S.built.filter(b => b.done && b.type !== 'houses').length, p = S.families;
  if (p >= 240 && f >= 18) return 5; if (p >= 200 && f >= 14) return 4; if (p >= 160 && f >= 9) return 3; if (p >= 140 && f >= 4) return 2; return 1;
}
const api = { get S() { return S; }, has, happy };

// ===================== time =====================
function tick() {
  if (!S || ui.picking) return;
  const running = !ui.paused && !ui.modal && !ui.panel && !ui.top && !ui.busy;
  W3.frozen = !!(ui.modal || ui.panel || ui.top || ui.busy);
  if (running) {
    ui.acc += SPEEDS[S.speed] * 0.25;
    while (ui.acc >= 1 && !ui.modal) { ui.acc -= 1; S.t++; minute(); }
    if (ui.modal) ui.acc = 0;
  }
  W3.setTime(minOf(S.t), isShabbat(S.t));
  renderHud();
}
function advanceSilent(n) {
  ui.silent = true;
  for (let i = 0; i < n; i++) { S.t++; minute(); }
  ui.silent = false;
  W3.setFacilities(S.built); placeFamily();
}
const notify = fn => (ui.silent ? ui.later.push(fn) : fn());
function flushLater() { const l = ui.later; ui.later = []; l.forEach(f => f()); }

function minute() {
  const d = dayOf(S.t), m = minOf(S.t), sh = isShabbat(S.t), live = !ui.silent;
  if (!sh) for (const b of S.built) if (!b.done) { b.prog += S.job === 'builder' ? 1.25 : 1; if (b.prog >= b.need) finishBuild(b); }
  if (m === 0) daily();
  if (m % 60 === 0) { if (live && S.built.some(b => !b.done)) W3.setFacilities(S.built); if (live) placeFamily(); save(); }
  if (S.babyDue && S.t >= S.babyDue) birth();
  if (d <= 5) {
    if (m === 6 * 60 + 30 && live) toast('🌅 בוקר טוב! זה זמן <b>תפילת שחרית</b>', 'blue', [['🧭 ללכת להתפלל', () => guidePray()], ['אחר כך', () => {}]]);
    if (m === 7 * 60 + 20 && live) schoolMorning();
    if (m === 9 * 60 && (ui.kidRide || ui.kidWalk)) kidMissed();
  }
  if (d <= 4) {
    if (m === 8 * 60 && live && S.workedDay !== today()) workReminder();
    if (m === 9 * 60 + 30 && Math.random() < 0.3) notify(randomEvent);
    if (m === 13 * 60 + 30 && live) toast('☀️ 13:30 — מניין <b>מנחה</b>', 'blue', [['🧭 ללכת', () => guidePray()]], 6000);
    if (m === 19 * 60 + 30 && live) arvitPrompt();
  }
  if (d === 5) {
    if (m === 10 * 60 && live) fridayShopping();
    if (m === 16 * 60 + 30 && live) toast(`⏰ עוד שעה שבת! מתקלחים, מתלבשים יפה ושמים את האוכל ${S.items.includes('plata') ? 'על הפלטה ♨️' : '... רגע, אין לכם פלטה! (אפשר לקנות ב🏠)'}`, 'gold');
    if (m === 17 * 60 + 30) notify(shabbatIn);
    if (m === 20 * 60) notify(fridayMeal);
  }
  if (d === 6) {
    if (m === 8 * 60 + 30 && live) toast('🕍 שבת בבוקר — <b>תפילת שחרית</b> וקריאת התורה', 'blue', [['🧭 ללכת לבית הכנסת', () => guidePray()]]);
    if (m === 12 * 60) notify(() => { boostFam(3); toast('🍲 סעודת שבת בצהריים — חמין חם עם כל המשפחה! 😊', 'gold'); });
    if (m === 16 * 60) notify(bneiAkivaShabbat);
    if (m === 18 * 60 + 45) notify(havdalah);
  }
  if (d === 0 && m === 6 * 60) weekly();
  if (m === 22 * 60 + 30 && live) toast('🌙 כבר 22:30... הגיע הזמן ללכת הביתה לישון', '', [['🧭 הביתה', () => guideHome()]]);
}
function daily() {
  boostTown(S.boost > 0 ? -1 : S.boost < 0 ? 1 : 0);
  S.fh = clamp(S.fh - 3, 0, 100);
  for (const k of S.kids) {
    const before = Math.floor(k.age);
    k.age += 1 / 14;
    if (k.age < 18) k.h = clamp(k.h - 3, 0, 100);
    const now = Math.floor(k.age);
    if (now > before) notify(() => {
      if (now === 18) modal({ icon: '🪖', title: `${k.name} ${k.g === 'b' ? 'התגייס' : 'התגייסה'}!`, text: `${k.name} ${k.g === 'b' ? 'בן' : 'בת'} 18 ו${k.g === 'b' ? 'מתגייס לצה״ל' : 'מתחילה שירות'}. כל הכבוד! 🇮🇱` });
      else toast(`🎂 יום הולדת ${now} ל${k.name}! מזל טוב!`, 'gold');
    });
  }
  checkMissions();
}
function weekly() {
  const tax = S.families * TAX[S.tax].rate;
  let income = 0, upkeep = 0;
  for (const b of S.built) if (b.done) { income += D.facilities[b.type].income || 0; upkeep += D.facilities[b.type].upkeep || 0; }
  S.budget += tax + income - upkeep;
  let homeCost = 1200 + 450 * kidsHome().length;
  if (has('grocery')) homeCost *= 0.9;
  if (S.items.includes('solar')) homeCost -= 400;
  if (S.car) homeCost += 250;
  S.money -= homeCost;
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
      <div class="stat"><span>הוצאות הבית (אוכל, חשבונות${S.car ? ', דלק' : ''})</span><b>-${fmt(homeCost)}</b></div>
      <div class="stat"><span>יש לך עכשיו</span><b>${fmt(S.money)}</b></div>
      <div class="sect">👨‍👩‍👧 היישוב</div>
      <div class="stat"><span>שמחה ביישוב</span><b>${h}%</b></div>
      <div class="stat"><span>${moved > 0 ? `🎉 ${moved} משפחות חדשות עברו ליישוב!` : moved < 0 ? '😢 משפחה אחת עזבה את היישוב' : S.families >= cap ? '🏘️ אין בתים פנויים — צריך לבנות שכונה חדשה!' : 'אף משפחה חדשה לא הגיעה (צריך יותר שמחה)'}</span><b>${S.families}</b></div>
      ${S.money < 0 ? '<div class="note red">😬 נגמר לך הכסף! צריך ללכת לעבודה.</div>' : ''}
      ${S.budget < 0 ? '<div class="note red">😬 הקופה של היישוב במינוס! אפשר להעלות ארנונה או לבנות עסקים.</div>' : ''}</div>`,
    buttons: [{ t: 'שבוע טוב! 👍' }],
  }));
  checkMissions();
}

// ===================== guide (the blue light that shows where to go) =====================
function setGuide(x, z, label, icon, onArrive, arriveLabel) {
  ui.guide = { x, z, label, icon, onArrive, arriveLabel };
  W3.setGuide({ x, z });
}
function clearGuide() { ui.guide = null; W3.setGuide(null); }
function prayerPlace() { const s = findBuilt('synagogue'); return s ? [...plotXY(s), 'בית הכנסת'] : [...CARAVAN, 'המניין בקרוואן']; }
function prayerName() {
  const m = minOf(S.t), d = dayOf(S.t);
  if (d === 5 && m >= 16 * 60) return 'קבלת שבת';
  if (d === 6 && m < 12 * 60) return 'תפילת שבת';
  if (m < 11 * 60) return 'שחרית';
  if (m < 18 * 60) return 'מנחה';
  return 'ערבית';
}
function guidePray() {
  const [x, z, name] = prayerPlace();
  setGuide(x, z, name, '🙏', enterSynagogue, '🕍 להיכנס לתפילה');
  toast(`🧭 לך אל האור הכחול — ${name}`, 'blue', [], 4000);
}
function guideHome() { const h = home(); setGuide(h.door[0], h.door[1], 'הבית', '🏠', () => openPanel('home'), '🏠 להיכנס הביתה'); }
function doPray() {
  const syn = has('synagogue'), name = prayerName();
  clearGuide();
  fade(`🙏 ${name}...`, () => {
    advanceSilent(30);
    S.stats.prayers++;
    if (name === 'ערבית') S.stats.arvit++;
    boostTown(syn ? 1.5 : 0.7); S.fh = clamp(S.fh + 2, 0, 100);
  }, () => toast(`🙏 התפללת <b>${name}</b> ${syn ? 'בבית הכנסת' : 'במניין בקרוואן'}.${syn ? '' : ' (עם בית כנסת אמיתי זה היה הרבה יותר נעים...)'}`, 'gold'));
}
function fade(text, during, after) {
  const f = $('#fade');
  f.textContent = text; f.classList.add('on'); ui.busy = text;
  setTimeout(() => { during && during(); setTimeout(() => { f.classList.remove('on'); ui.busy = null; flushLater(); checkMissions(); save(); after && after(); }, 900); }, 500);
}

// ===================== events =====================
function workReminder() {
  const j = job();
  toast(`${j.icon} 8:00 — זמן ללכת לעבודה!`, '', [['🧭 איך מגיעים?', guideWork], ['אחר כך', () => {}]]);
}
function guideWork() {
  const j = job(), why = canWork(); if (why) return toast(why, 'red');
  if (j.where === 'fields') return setGuide(FIELDS[0], FIELDS[1], 'השדה', '🚜', () => doWork('fields'), '🚜 להתחיל לעבוד');
  if (j.where === 'school' && has('school')) return setGuide(...plotXY(findBuilt('school')), 'בית הספר', '🏫', () => doWork('school'), '👩‍🏫 להתחיל ללמד');
  if (S.car) { const c = W3.car(); setGuide(c.x, c.z, 'הרכב שלך', '🚗'); toast('🚗 תיכנס לרכב ותיסע אל השער בכניסה ליישוב', 'blue'); }
  else { setGuide(M.entrance[0], M.entrance[1], 'תחנת האוטובוס', '🚌'); toast('🚌 אין לך רכב — לך לתחנת האוטובוס בכניסה ליישוב', 'blue'); }
}
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
        { t: `🚗 להסיע ${boy ? 'אותו' : 'אותה'} ברכב`, fn: () => startKidRide(k), disabled: !S.car || S.car === 'bike' ? 'אין לך רכב' : null },
        ...(inTown ? [{ t: '🚶 ללוות ברגל לבית הספר', fn: () => { ui.kidWalk = k; setGuide(...plotXY(findBuilt('school')), 'בית הספר', '🏫', () => kidArrived(k, 'walk'), `🎒 להיפרד מ${k.name}`); placeFamily(); } }] : []),
        { t: `😴 ${boy ? 'שיישאר' : 'שתישאר'} בבית היום`, cls: 'sec', fn: () => { k.h = clamp(k.h + 3, 0, 100); S.fh = clamp(S.fh - 6, 0, 100); toast(`📞 המורה התקשרה לשאול איפה ${k.name}... 😬`, 'red'); } },
      ],
    });
  } else {
    const gan = kids.filter(k => k.age < 6).length;
    toast(`🎒 ${school.length ? 'הילדים יצאו לבית הספר' : ''}${school.length && gan ? ' ו' : ''}${gan ? 'הקטנים הלכו לגן' : ''} — יום טוב!`, '', [], 4000);
  }
}
function startKidRide(k) {
  ui.kidRide = k; placeFamily();
  const c = W3.car();
  if (W3.pos().mode === 'drive') kidInCar();
  else { setGuide(c.x, c.z, 'הרכב', '🚗'); toast(`🚗 ${k.name} מחכה לך ליד הרכב — תיכנס לרכב!`, 'blue'); }
}
function kidInCar() {
  const k = ui.kidRide; if (!k) return;
  if (has('school')) setGuide(...plotXY(findBuilt('school')), 'בית הספר', '🏫', () => kidArrived(k, 'car'), `🎒 להוריד את ${k.name}`);
  else { const t = W3.gate.trigger; setGuide(t[0], t[1], 'היציאה מהיישוב', '🚧'); toast(`🎒 ${k.name} ברכב! סע אל השער ביציאה מהיישוב — משם לצור הדסה`, 'blue'); }
}
function kidArrived(k, how) {
  clearGuide();
  ui.kidRide = ui.kidWalk = null;
  k.h = clamp(k.h + (how === 'car' ? 8 : 6), 0, 100); S.fh = clamp(S.fh + 2, 0, 100);
  toast(`🎒 ${k.name} ${k.g === 'b' ? 'הגיע' : 'הגיעה'} בזמן לבית הספר! ${k.g === 'b' ? 'הוא אמר' : 'היא אמרה'} תודה ❤️`, 'gold');
  placeFamily(); save();
}
function kidMissed() {
  const k = ui.kidRide || ui.kidWalk;
  ui.kidRide = ui.kidWalk = null; clearGuide();
  if (!k) return;
  k.h = clamp(k.h - 5, 0, 100);
  notify(() => toast(`😕 השעה 9:00 — ${k.name} ${k.g === 'b' ? 'פספס' : 'פספסה'} את הבוקר בבית הספר.`, 'red'));
  placeFamily();
}
function arvitPrompt() {
  const [, , name] = prayerPlace();
  modal({
    icon: '🌙', title: 'השעה כבר 19:30!',
    text: `${g('צריך', 'צריכה')} ללכת לתפילת ערבית ב${name}${has('synagogue') ? ' 🕍' : ' — עוד אין בית כנסת ביישוב, אז מתפללים בקרוואן בפארק'}.`,
    buttons: [{ t: '🧭 ללכת לתפילה', fn: guidePray }, { t: 'הפעם לא', cls: 'sec' }],
  });
}
function fridayShopping() {
  if (S.shopWeek === weekNo()) return;
  if (has('grocery')) toast('🛒 יום שישי! זמן לקנות אוכל לשבת במכולת', 'gold', [['🧭 למכולת', () => setGuide(...plotXY(findBuilt('grocery')), 'המכולת', '🛒', shopForShabbat, '🛒 לקנות לשבת (₪600)')]]);
  else toast('🛒 יום שישי! צריך לקנות אוכל לשבת — אין מכולת ביישוב, אז נוסעים לצור הדסה (דרך השער ביציאה)', 'gold');
}
function shabbatIn() {
  if (S.riding) { S.riding = null; W3.setRide(null); }
  if (W3.pos().mode === 'drive') { W3.exitCar(); toast('🅿️ החנית את הרכב — בשבת לא נוסעים', 'blue'); }
  modal({
    icon: '🕯️🕯️', title: 'יאללה, כניסת שבת!', cls: 'shabbat',
    text: 'השעה 17:30 — מדליקים נרות. <b>שבת שלום!</b><br>בשבת לא נוסעים, לא עובדים, לא קונים ולא בונים — רק נחים, מתפללים ונהנים עם המשפחה. (שים לב: כולם לובשים חולצה לבנה 👔)',
    buttons: [{ t: `🧭 ללכת לקבלת שבת`, fn: guidePray }, { t: '🏠 להישאר', cls: 'sec' }],
  });
}
function fridayMeal() {
  let bonus = 4; const notes = [];
  if (S.items.includes('table')) bonus += 3; else notes.push('שולחן שבת גדול');
  if (S.items.includes('plata')) bonus += 3; else notes.push('פלטה (בלי פלטה האוכל קר 🥶)');
  if (S.shopWeek === weekNo()) bonus += 4; else notes.push('קניות לשבת ביום שישי');
  if (S.shabbatFood === weekNo()) bonus += 5; else notes.push('לבשל חמין או חלות בבית 🍲');
  if (S.inviteWeek === weekNo()) { bonus += 2; boostTown(1); }
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
  mine.forEach(k => (k.h = clamp(k.h + 10, 0, 100)));
  boostTown(S.ba.club ? 3 : 1.5);
  placeFamily();
  const ba = findBuilt('bneiakiva');
  modal({
    icon: '🔵⚪', title: 'זמן בני עקיבא!',
    text: `${Math.round(S.families * 1.1)} חניכים מכל היישוב הגיעו לפעולה בסניף. נושא הפעולה היום: <b>${pick(BA_TOPICS)}</b>!${mine.length ? `<br>${mine.map(k => k.name).join(' ו')} ${mine.length > 1 ? 'רצו' : mine[0].g === 'b' ? 'רץ' : 'רצה'} לסניף עם החולצה הכחולה 💙` : ''}`,
    buttons: [{ t: 'איזה כיף! 💙' }, { t: '🧭 ללכת לראות את הסניף', cls: 'sec', fn: () => setGuide(...plotXY(ba), 'הסניף', '💙', () => { boostFam(2); clearGuide(); toast('💙 הגעת לסניף ושרת עם כולם את ההמנון של בני עקיבא!', 'gold'); }, '🎶 לשיר עם החניכים') }],
  });
}
function havdalah() {
  placeFamily();
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
  () => modal({ icon: '🛝', title: 'בקשה מהתושבים', text: 'התושבים מבקשים לשפץ את השבילים והמדרכות ביישוב. זה יעלה ₪25,000 מהקופה. לאשר?', buttons: [{ t: '✅ לאשר', fn: () => { S.budget -= 25000; boostTown(4); toast('👏 התושבים מרוצים מהשיפוץ!', 'gold'); } }, { t: '❌ לא עכשיו', cls: 'sec', fn: () => boostTown(-2) }] }),
  () => modal({ icon: '🚧', title: 'תלונה על חניה', text: 'תושבים מתלוננים שאין מספיק חניה ליד הבתים. לבנות חניון קטן ב-₪40,000?', buttons: [{ t: '✅ לבנות חניון', fn: () => { S.budget -= 40000; boostTown(4); } }, { t: '❌ לא', cls: 'sec', fn: () => boostTown(-3) }] }),
  () => modal({ icon: '🍲', title: 'חסד ביישוב', text: 'מתנדבים מהיישוב בישלו ארוחות למשפחה שנולד לה תינוק. איזו קהילה!', buttons: [{ t: '❤️', fn: () => boostTown(2) }] }),
  () => has('bneiakiva') ? modal({ icon: '🍋', title: 'דוכן לימונדה', text: 'חניכי בני עקיבא מכרו לימונדה ברחוב כדי לממן את המחנה. הם אספו ₪3,000 לסניף!', buttons: [{ t: 'כל הכבוד! 💙', fn: () => { S.budget += 3000; boostTown(1); } }] }) : null,
];
function randomEvent() { const e = pick(EVENTS); if (e() === null) EVENTS[0](); }
function birth() {
  S.babyDue = 0;
  const boy = Math.random() < 0.5, name = pick(boy ? D.boys : D.girls);
  const k = { name, g: boy ? 'b' : 'g', age: 0, h: 90, played: -1 };
  S.kids.push(k); boostFam(10); boostTown(1);
  notify(() => modal({
    icon: '👶🎉', title: `מזל טוב! ${boy ? 'נולד לכם בן' : 'נולדה לכם בת'}!`,
    text: `קוראים ${boy ? 'לו' : 'לה'} <b>${name}</b>. כל היישוב שולח מזל טוב, והשכנים כבר מביאים עוגות 🍰`,
    buttons: [{ t: 'מזל טוב! 🎉' }, { t: '✏️ לבחור שם אחר', cls: 'sec', fn: () => { const n = prompt('איך קוראים לתינוק/ת?', name); if (n && n.trim()) { k.name = n.trim().slice(0, 20); save(); toast(`👶 ${boy ? 'ברוך הבא' : 'ברוכה הבאה'} ${k.name}!`, 'gold'); } } }],
  }));
}

// ===================== work, trips, the gate =====================
function canWork() {
  const m = minOf(S.t), d = dayOf(S.t);
  if (isShabbat(S.t)) return '🕯️ שבת היום — לא עובדים!';
  if (d >= 5) return 'ביום שישי ובשבת לא עובדים 🙂 העבודה בימים ראשון–חמישי.';
  if (S.workedDay === today()) return 'כבר עבדת היום! מחר בבוקר שוב.';
  if (m < 6 * 60) return 'מוקדם מדי — עוד לילה 🌙';
  if (m > 11 * 60) return 'מאוחר מדי ללכת לעבודה היום. מחר בבוקר!';
  return null;
}
function doWork(how) { // how: 'car' | 'bus' | 'tremp' | 'fields' | 'school' — you walk into your work place
  const why0 = canWork(); if (why0) return toast(why0, 'red');
  clearGuide(); return enterWork(how);
}
function doWorkFade(how) {
  const why = canWork(); if (why) return toast(why, 'red');
  clearGuide();
  const j = job(), late = minOf(S.t) > 9 * 60;
  S.workedDay = today();
  fade(how === 'car' ? '🚗 נוסעים לעבודה...' : how === 'bus' ? '🚌 נוסעים באוטובוס...' : `${j.icon} עובדים...`, () => {
    advanceSilent(9 * 60 + (how === 'bus' ? 60 : 0));
    S.stats.workdays++;
    const raise = 1 + 0.05 * Math.floor((S.stats.workdays - 1) / 5);
    const pay = Math.round(j.pay * raise * (late ? 0.75 : 1)) - (how === 'bus' ? 12 : 0);
    S.money += pay; S.fh = clamp(S.fh - 2, 0, 100);
    if (how === 'car') returnByCar();
    if (how === 'bus') W3.teleport(M.entrance[0] + 3, M.entrance[1] + 3, Math.PI);
    ui.lastPay = { pay, late, how };
  }, () => {
    const { pay, how: hw } = ui.lastPay;
    modal({
      icon: j.icon, title: 'יום העבודה נגמר!',
      text: `עבדת כ${j.name} ב${hw === 'school' ? 'בית הספר של היישוב' : hw === 'fields' ? 'שדה ליד היישוב' : j.place} והרווחת <b>${fmt(pay)}</b>.${late ? '<br>😬 איחרת לעבודה, אז קיבלת פחות.' : ''}${hw === 'bus' ? '<br>🚌 חזרת באוטובוס לתחנה בכניסה (₪12). עם רכב היית חוזר מהר יותר.' : hw === 'car' ? '<br>🚗 חזרת ליישוב — עכשיו סע הביתה!' : ''}${S.stats.workdays % 5 === 0 ? '<br>📈 <b>קיבלת העלאה במשכורת!</b>' : ''}`,
      buttons: [{ t: '🏠 הביתה!', fn: guideHome }],
    });
  });
}
function returnByCar() {
  const [x, z, h] = W3.gate.back;
  W3.placeCar(x, z, h);
  if (W3.pos().mode !== 'drive') W3.enterCar();
  ui.gateArmed = false;
}
function canTrip(tr, how) {
  const m = minOf(S.t);
  if (isShabbat(S.t)) return '🕯️ בשבת לא נוסעים!';
  if (m < 6 * 60) return 'עוד לילה 🌙 — יוצאים בבוקר';
  if (m > 17 * 60 && tr.hours < 30) return 'מאוחר מדי לטיול היום — מחר בבוקר!';
  const dur = Math.round(tr.hours * 60 * (how === 'bus' ? 1.4 : 1));
  for (let x = S.t; x <= S.t + dur; x += 10) if (isShabbat(x)) return '🕯️ לא תספיקו לחזור לפני כניסת שבת!';
  const cost = tr.cost + (how === 'bus' ? 20 * famSize() : 0);
  if (S.money < cost) return 'אין לך מספיק כסף 😬';
  if (how === 'walk' && tr.needCar !== false) return 'רחוק מדי ברגל';
  if (how === 'bus' && !tr.bus) return 'לשם אין אוטובוס — צריך רכב';
  if (how === 'tremp' && !tr.bus) return 'לשם קשה למצוא טרמפ';
  if (how === 'car') { const c = car(); if (c.seats < famSize()) return `לא כולם נכנסים! ב${c.name} יש ${c.seats} מקומות ואתם ${famSize()} 🚐`; }
  return null;
}
function exitMenu(how) { // how: 'car' | 'bus' | 'walk' | 'tremp'
  const j = job(), b = [];
  if (how === 'car' && car().seats > famSize() && S.trempDay !== today() && !isShabbat(S.t)) { S.trempDay = today(); boostTown(0.5); toast('👍 עצרת בטרמפיאדה ולקחת טרמפיסט — הוא אמר תודה רבה!', 'gold'); }
  const workOut = j.where === 'out' || (j.where === 'school' && !has('school'));
  if (workOut && how !== 'walk') { const w = canWork(); b.push({ t: `${j.icon} לנסוע לעבודה (${j.place})`, fn: () => doWork(how), disabled: w }); }
  if (ui.kidRide && how === 'car') { const k = ui.kidRide; b.push({ t: `🎒 להסיע את ${k.name} לבית הספר בצור הדסה`, fn: () => fade('🚗 נוסעים לצור הדסה...', () => { advanceSilent(25); kidArrived(k, 'car'); returnByCar(); }) }); }
  for (const tr of D.trips) {
    if (how === 'walk' && tr.needCar !== false) continue;
    const why = canTrip(tr, how);
    b.push({ t: `${tr.icon} ${tr.name} · ${tr.cost ? fmt(tr.cost) : 'חינם'}`, fn: () => doTrip(tr, how), disabled: why });
  }
  b.push({ t: '↩️ חזרה ליישוב', cls: 'sec', fn: () => { if (how === 'tremp') { const t = W3.gate.tremp; W3.teleport(t[0], t[1], 0); } else if (how === 'car') returnByCar(); else if (how === 'walk') { const [x, z, h] = W3.gate.back; W3.teleport(x, z, h); ui.gateArmed = false; } } });
  modal({ icon: how === 'bus' ? '🚌' : how === 'car' ? '🚗' : how === 'tremp' ? '🚙👍' : '🥾', title: how === 'bus' ? 'תחנת האוטובוס — לאן נוסעים?' : how === 'tremp' ? 'הנהג שואל: לאן?' : 'יוצאים מגבעות עדן — לאן?', html: '<div class="exitlist"></div>', buttons: b, list: true });
}
function doTrip(tr, how) {
  clearGuide();
  const cost = tr.cost + (how === 'bus' ? 20 * famSize() : 0);
  fade(`${tr.icon} ${tr.name}...`, () => {
    advanceSilent(Math.round(tr.hours * 60 * (how === 'bus' ? 1.4 : 1)));
    S.money -= cost; S.stats.trips++; boostFam(tr.happy);
    if (tr.id === 'tzur') S.shopWeek = weekNo();
    if (how === 'car') returnByCar();
    else if (how === 'bus') W3.teleport(M.entrance[0] + 3, M.entrance[1] + 3, Math.PI);
    else if (how === 'tremp') { const t = W3.gate.tremp; W3.teleport(t[0], t[1], 0); }
    else { const [x, z, h] = W3.gate.back; W3.teleport(x, z, h); ui.gateArmed = false; }
  }, () => modal({ icon: tr.icon, title: tr.name, text: `${tr.text}${tr.id === 'tzur' ? '<br>🛒 וגם קניתם אוכל לשבת!' : ''}<br><br>💰 ${fmt(cost)}${how === 'bus' ? ' (באוטובוס 🚌)' : ''} · 😊 המשפחה +${tr.happy}`, buttons: [{ t: 'היה כיף! 😄' }] }));
}
function sleep() {
  const m = minOf(S.t);
  const wake = dayOf(S.t + (m >= 20 * 60 ? DAY : 0)) === 6 ? 7 * 60 : 6 * 60;
  const add = m >= 20 * 60 ? DAY - m + wake : m < wake ? wake - m : 0;
  if (add <= 0) return toast('עוד לא לילה! 😄', 'blue');
  closePanel();
  fade('😴 לילה טוב...', () => { advanceSilent(add); S.fh = clamp(S.fh + 2, 0, 100); const h = home(); W3.teleport(h.door[0], h.door[1], Math.atan2(h.dir[0], h.dir[1])); },
    () => toast(`☀️ בוקר טוב! השעה ${hhmm(S.t)} — יום ${D.days[dayOf(S.t)]}`, 'gold'));
}
function kumzitz() {
  if (S.budget < 2000) return toast('אין מספיק כסף בקופה', 'red');
  if (isShabbat(S.t)) return toast('🕯️ מחכים לצאת השבת...', 'red');
  S.budget -= 2000; boostTown(2); kidsHome().forEach(k => (k.h = clamp(k.h + 6, 0, 100)));
  modal({ icon: '🔥', title: 'קומזיץ!', text: 'כל הסניף ישב סביב המדורה, שרו שירים עם גיטרה ואפו תפוחי אדמה בגחלים 🥔🎸', buttons: [{ t: 'איזה ערב! 🌟' }] });
}
function shopForShabbat() {
  if (S.shopWeek === weekNo()) return toast('✔️ כבר קניתם אוכל לשבת השבוע', 'blue');
  if (isShabbat(S.t)) return toast('🕯️ שבת! המכולת סגורה', 'red');
  if (S.money < 600) return toast('אין לך מספיק כסף 😬', 'red');
  clearGuide(); closePanel();
  fade('🛒 קונים לשבת...', () => { advanceSilent(20); S.money -= 600; S.shopWeek = weekNo(); }, () => toast('🛒 קנית חלות, יין, דגים, עוף וממתקים לשבת! 🥖🍷', 'gold'));
}
const OUTINGS = {
  playground: { cost: 0, min: 60, h: 10, kids: true, shabbat: true, label: 'לשחק עם הילדים', text: 'הילדים התנדנדו וגלשו עד שנגמר להם הכוח!' },
  garden: { cost: 0, min: 90, h: 7, shabbat: true, label: 'פיקניק משפחתי', text: 'פיקניק על הדשא עם אבטיח ועוגה 🍉' },
  pizzeria: { cost: 250, min: 60, h: 9, label: 'ארוחה משפחתית', text: 'פיצה עם זיתים ותירס — כולם שבעים ושמחים!' },
  pool: { cost: 120, min: 120, h: 11, label: 'לשחות עם המשפחה', text: 'קפצתם למים ועשיתם תחרות שחייה!' },
  football: { cost: 0, min: 60, h: 8, kids: true, label: 'לשחק כדורגל עם הילדים', text: 'משחק כדורגל משפחתי — ניצחתם 5:3! ⚽' },
  library: { cost: 0, min: 45, h: 5, label: 'לקחת ספרים', text: 'כל אחד לקח ספר חדש הביתה 📚' },
  community: { cost: 200, min: 90, h: 7, kids: true, label: 'חוג לילדים', text: 'הילדים נהנו בחוג ציור ותיאטרון' },
  clinic: { cost: 0, min: 30, h: 2, label: 'בדיקה אצל הרופא', text: 'הרופא בדק את כולם — כולם בריאים! 💪' },
  grocery: { cost: 40, min: 20, h: 5, kids: true, label: 'גלידה לילדים', text: 'קנית לילדים ארטיקים 🍦' },
};
function outing(type) {
  const O = OUTINGS[type];
  if (!kidsHome().length && O.kids) return toast('אין ילדים קטנים בבית 🙂', 'blue');
  if (isShabbat(S.t) && !O.shabbat) return toast('🕯️ שבת היום — זה סגור. אפשר לגן שעשועים או לגינה!', 'red');
  if (S.money < O.cost) return toast('אין לך מספיק כסף 😬', 'red');
  closePanel();
  fade(`${D.facilities[type].icon} ${O.label}...`, () => { advanceSilent(O.min); S.money -= O.cost; boostFam(O.h); }, () => toast(`${D.facilities[type].icon} ${O.text} 😊 +${O.h}`, 'gold'));
}

// ---------- building ----------
const freePlots = () => M.plots.map((p, i) => i).filter(i => !S.built.some(b => b.plot === i));
function startPlacing(type) {
  const f = D.facilities[type];
  if (isShabbat(S.t)) return toast('🕯️ בשבת לא בונים! מחכים למוצאי שבת.', 'red');
  if (S.budget < f.cost) return toast(`אין מספיק כסף בקופת היישוב 😬 צריך ${fmt(f.cost)}`, 'red');
  if (!freePlots().length) return toast('אין יותר מגרשים פנויים ביישוב!', 'red');
  closePanel();
  ui.placing = type; ui.top = true;
  const p = W3.pos();
  W3.topView('plot', freePlots(), i => confirmPlace(i), [p.x, p.z]);
  W3.topFocus(p.x, p.z, 420);
  showBanner(`${f.icon} ${g('בחר', 'בחרי')} מגרש כחול ל<b>${f.name}</b> (אפשר להזיז ולהגדיל את המפה)`, cancelPlacing);
}
function cancelPlacing() { ui.placing = null; ui.top = false; W3.exitTop(); hideBanner(); }
function confirmPlace(i) {
  const type = ui.placing, f = D.facilities[type];
  modal({
    icon: f.icon, title: `לבנות ${f.name} כאן?`,
    text: `💰 ${fmt(f.cost)} מקופת היישוב · ⏱️ ${f.days} ימי עבודה${S.job === 'builder' ? ' (מהר יותר כי את/ה קבלן!)' : ''}`,
    buttons: [{ t: '🏗️ כן, לבנות!', fn: () => {
      if (S.budget < f.cost) return toast('אין מספיק כסף בקופה', 'red');
      S.budget -= f.cost;
      S.built.push({ id: Date.now(), type, plot: i, prog: 0, need: f.days * DAY, done: false });
      cancelPlacing(); W3.setFacilities(S.built); save();
      const [x, z] = [M.plots[i].x, M.plots[i].y];
      setGuide(x, z, f.name, '🏗️', () => { clearGuide(); toast('👷 הפועלים עובדים קשה! תחזור לראות כשזה מוכן.', 'blue'); }, '👷 לראות את העבודה');
      toast(`🚧 הפועלים התחילו לבנות ${f.name}! ${f.days} ימים וזה מוכן. האור הכחול מראה איפה.`, 'gold');
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
    W3.setFacilities(S.built);
    if (first && OPENINGS[b.type]) { const [icon, title, text] = OPENINGS[b.type]; modal({ icon, title, text, buttons: [{ t: 'מזל טוב! 🎉' }, { t: '🧭 ללכת לראות', cls: 'sec', fn: () => setGuide(...plotXY(b), f.name, f.icon) }] }); }
    else toast(`🎉 <b>${f.name}</b> נפתח ביישוב!`, 'gold');
    checkMissions();
  });
}
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

// ===================== family in the yard =====================
function placeFamily() {
  if (!S) return;
  const m = minOf(S.t), d = dayOf(S.t), sh = isShabbat(S.t);
  const schoolTime = d <= 5 && !sh && m >= 7 * 60 + 25 && m < 14 * 60;
  const baTime = d === 6 && m >= 16 * 60 && m < 18 * 60 && has('bneiakiva');
  const night = m < 6 * 60 || m >= 21 * 60;
  const list = [];
  if (!night) list.push(S.gender === 'f'
    ? { shirt: sh ? '#ffffff' : '#5b7c99', pants: '#2c3e50', kippah: true, hair: '#2a2a2a', skin: '#f1c9a5' }
    : { shirt: sh ? '#ffffff' : '#b35c7a', skirt: true, hair: '#6b4423', long: true, skin: '#f1c9a5' });
  for (const k of kidsHome()) {
    if (night || k === ui.kidRide || k === ui.kidWalk) continue;
    if (schoolTime && k.age >= 3) continue;
    if (baTime && k.age >= 9) continue;
    const sc = clamp(0.35 + k.age * 0.045, 0.38, 0.95);
    list.push(k.g === 'b' ? { scale: sc, kippah: k.age >= 3, shirt: sh ? '#ffffff' : pick(['#e04e39', '#3b8fd6', '#2f9e5b', '#f2c200']), hair: '#4a3020' } : { scale: sc, skirt: k.age >= 2, hair: pick(['#6b4423', '#c9a36a', '#3a2a1a']), long: true, shirt: sh ? '#ffffff' : pick(['#e86fa0', '#9b6fd6', '#f2a03d']) });
  }
  W3.setFamily(list, S.house);
}

// ===================== nearby actions (buttons that appear when you are close to something) =====================
let lastActs = '';
function nearbyActions() {
  if (!S || ui.picking || ui.top) return [];
  if (W3.inside()) return ui.inside ? ui.inside.spots() : [];
  const p = W3.pos(), here = [p.x, p.z], acts = [], sh = isShabbat(S.t);
  const h = home(), c = W3.car();
  if (p.mode === 'walk') {
    if (ui.guide && ui.guide.onArrive && dist(here, [ui.guide.x, ui.guide.z]) < 14) acts.push([ui.guide.arriveLabel, ui.guide.onArrive]);
    if (dist(here, h.door) < 6 || dist(here, h.b.c) < 12) acts.push(['🏠 להיכנס הביתה', enterHome]);
    else { let nb = null, nd = 4.5; for (const hh of W3.houses) { if (hh.id === S.house) continue; const d = dist(here, hh.door); if (d < nd) { nd = d; nb = hh; } } if (nb) acts.push([`🚪 לדפוק בדלת — משפחת ${surname(nb.b)}`, () => knock(nb)]); }
    if (W3.gate.tremp && dist(here, W3.gate.tremp) < 6) acts.push(['👍 לחכות לטרמפ', waitTremp]);
    if (!has('synagogue') && dist(here, CARAVAN) < 9) acts.push(['🕍 להיכנס לקרוואן (מניין)', enterSynagogue]);
    if (S.car && dist(here, [c.x, c.z]) < 4.5) acts.push([`${car().icon} להיכנס לרכב`, enterCar]);
    for (const b of S.built) if (dist(here, plotXY(b)) < 15) { const f = D.facilities[b.type]; if (b.done && b.type === 'synagogue') acts.push(['🕍 להיכנס לבית הכנסת', enterSynagogue]); if (b.done && b.type === 'school') acts.push(['🏫 להיכנס לבית הספר', () => (S.job === 'teacher' && !canWork() ? doWork('school') : enterSchoolVisit())]); acts.push([`${b.done ? f.icon : '🏗️'} ${f.name}`, () => { ui.facId = b.id; openPanel('facility'); }]); break; }
    if (dist(here, M.entrance) < 7) acts.push(['🚌 לחכות לאוטובוס', () => exitMenu('bus')]);
  } else {
    if (p.speed < 1.5) acts.push(['🚶 לצאת מהרכב', exitCar]);
  }
  // the gate: leaving the settlement
  const gd = dist(here, W3.gate.trigger);
  if (gd > 30) ui.gateArmed = true;
  if (gd < 14 && ui.gateArmed && !ui.modal && !ui.busy) {
    ui.gateArmed = false;
    if (p.mode === 'drive') { if (ui.kidRide && !has('school')) kidInCar(); exitMenu('car'); }
    else exitMenu('walk');
  }
  return acts;
}
function enterCar() {
  if (S.riding) { S.riding = null; W3.setRide(null); }
  if (isShabbat(S.t)) return toast('🕯️ שבת! בשבת לא נוסעים ברכב', 'red');
  W3.enterCar();
  if (ui.kidRide) kidInCar();
  else if (ui.guide && ui.guide.label === 'הרכב שלך') { const t = W3.gate.trigger; setGuide(t[0], t[1], 'היציאה מהיישוב', '🚧'); }
  toast(W3.MOBILE ? '🚗 הג׳ויסטיק: למעלה = גז, למטה = ברקס, ימינה/שמאלה = הגה' : '🚗 W = גז, S = ברקס/רוורס, A/D = הגה', 'blue', [], 5000);
}
function exitCar() { W3.exitCar(); save(); }
function renderActs() {
  const acts = nearbyActions();
  const key = acts.map(a => a[0]).join('|');
  if (key !== lastActs) {
    lastActs = key;
    const box = $('#acts');
    box.innerHTML = acts.map((a, i) => `<button class="act" data-i="${i}">${a[0]}</button>`).join('');
    box.querySelectorAll('button').forEach(b => (b.onclick = () => { const a = nearbyActions()[+b.dataset.i]; if (a) a[1](); }));
  }
  ui.acts = acts;
  renderGuideChip(); renderPlace();
}
function renderGuideChip() {
  const el = $('#guide');
  if (!ui.guide) { el.classList.add('hidden'); return; }
  const p = W3.pos(), dx = ui.guide.x - p.x, dz = ui.guide.z - p.z, d = Math.hypot(dx, dz);
  const ang = Math.atan2(dx, dz) - W3.cameraYaw();
  el.classList.remove('hidden');
  el.innerHTML = `<span class="arrow" style="transform:rotate(${(-ang * 180) / Math.PI}deg)">⬆</span> ${ui.guide.icon} ${ui.guide.label} · ${d < 1000 ? Math.round(d) + ' מ׳' : (d / 1000).toFixed(1) + ' ק״מ'} <button id="gX">✕</button>`;
  $('#gX').onclick = clearGuide;
}
function renderPlace() {
  if (W3.inside()) { $('#place').textContent = ui.inside ? ui.inside.name : ''; return; }
  const p = W3.pos();
  let best = null, bd = 14;
  for (const h of W3.houses) { const d = dist([p.x, p.z], h.door); if (d < bd) { bd = d; best = h; } }
  let txt;
  if (best) txt = best.id === S.house ? `🏠 ${addr(best.b)} — הבית שלך!` : `📍 ${addr(best.b)} · משפחת ${surname(best.b)}`;
  else { const r = W3.nearestRoad(p.x, p.z); txt = r.d < 25 && r.road.name ? `📍 רחוב ${r.road.name}` : '📍 גבעות עדן'; }
  $('#place').textContent = txt;
}

// ===================== UI: toasts, modal, banner, hud =====================
function toast(html, cls = '', acts = [], ttl = 7000) {
  const box = $('#toasts'), t = document.createElement('div');
  t.className = 'toast ' + cls;
  t.innerHTML = html + (acts.length ? `<div class="tacts">${acts.map((a, i) => `<button class="btn ${i ? 'sec' : ''}" data-i="${i}">${a[0]}</button>`).join('')}</div>` : '');
  acts.forEach((a, i) => (t.querySelector(`[data-i="${i}"]`).onclick = () => { t.remove(); a[1](); }));
  box.prepend(t);
  setTimeout(() => t.remove(), acts.length ? ttl * 1.7 : ttl);
  while (box.children.length > 3) box.lastChild.remove();
}
function modal(o) {
  if (ui.modal) { ui.mq.push(o); return; }
  ui.modal = true; W3.frozen = true;
  const c = $('#mcard'), buttons = o.buttons || [{ t: 'סגור' }];
  c.className = 'mcard ' + (o.cls || '') + (o.list ? ' list' : '');
  c.innerHTML = `<div class="e">${o.icon || ''}</div><h3>${o.title}</h3>${o.text ? `<p>${o.text}</p>` : ''}${o.list ? '' : o.html || ''}
    <div class="acts">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}" ${b.disabled ? 'disabled' : ''}>${b.t}${b.disabled ? `<small>${b.disabled}</small>` : b.sub ? `<small>${b.sub}</small>` : ''}</button>`).join('')}</div>`;
  $('#modal').classList.remove('hidden');
  c.querySelectorAll('[data-i]').forEach(btn => (btn.onclick = () => { const b = buttons[+btn.dataset.i]; closeModal(); if (b.fn) b.fn(); }));
}
function closeModal() {
  $('#modal').classList.add('hidden'); ui.modal = false;
  if (ui.mq.length) setTimeout(() => modal(ui.mq.shift()), 180);
}
function showBanner(html, onCancel) {
  hideBanner();
  const b = document.createElement('div'); b.id = 'banner';
  b.innerHTML = `<span>${html}</span>${onCancel ? '<button>ביטול</button>' : ''}`;
  if (onCancel) b.querySelector('button').onclick = onCancel;
  $('#game').appendChild(b);
}
function hideBanner() { const b = $('#banner'); if (b) b.remove(); }

function initHud() {
  $('#hud').innerHTML = `
    <div class="pill" id="clock"><small id="hDay"></small><b id="hTime"></b></div>
    <div class="pill" id="speed"><button data-speed="p" title="עצירה">⏸</button><button data-speed="0" title="רגיל">▶</button><button data-speed="1" title="מהר">⏩</button><button data-speed="2" title="מהר מאוד">⏭</button></div>
    <div class="pill" data-go="town" title="קופת היישוב">🏛️ <span id="hBudget"></span></div>
    <div class="pill" data-go="home" title="הכסף שלך">💰 <span id="hMoney"></span></div>
    <div class="pill" data-go="town">😊 <span id="hHappy"></span></div>
    <div class="pill" data-go="town" id="hStars"></div>`;
  $('#hud').onclick = e => {
    const t = e.target.closest('[data-go],[data-speed]'); if (!t) return;
    if (t.dataset.go) openPanel(t.dataset.go);
    if (t.dataset.speed) { if (t.dataset.speed === 'p') ui.paused = !ui.paused; else { ui.paused = false; S.speed = +t.dataset.speed; } renderHud(); }
  };
}
function renderHud() {
  if (!S || !$('#clock')) return;
  const sh = isShabbat(S.t);
  $('#clock').classList.toggle('shabbat', sh);
  $('#hDay').textContent = `יום ${D.days[dayOf(S.t)]}${sh ? ' · שבת שלום 🕯️' : ''}${ui.paused || ui.panel ? ' · ⏸' : ''}`;
  $('#hTime').textContent = hhmm(S.t);
  $('#hBudget').textContent = fmt(S.budget);
  $('#hMoney').textContent = fmt(S.money);
  $('#hHappy').textContent = happy() + '%';
  $('#hStars').textContent = '⭐'.repeat(stars());
  $('#speed').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.speed === 'p' ? ui.paused : !ui.paused && +b.dataset.speed === S.speed));
  $('#kidchip').classList.toggle('hidden', !ui.kidRide && !ui.kidWalk);
  if (ui.kidRide || ui.kidWalk) $('#kidchip').textContent = `${kidIcon(ui.kidRide || ui.kidWalk)} ${(ui.kidRide || ui.kidWalk).name} איתך`;
}

// ===================== panels =====================
const sheet = $('#sheet');
$('#sheetX').onclick = () => closePanel();
function openPanel(name) {
  if (!S || ui.picking || ui.top) return;
  ui.panel = name; sheet.classList.remove('hidden'); W3.frozen = true;
  refreshPanel();
}
function closePanel() { ui.panel = null; sheet.classList.add('hidden'); }
function refreshPanel() {
  if (!ui.panel) return;
  const p = PANELS[ui.panel]();
  $('#sheetTitle').innerHTML = p.title; $('#sheetBody').innerHTML = p.html;
  if (p.bind) p.bind();
  renderHud();
}
$('#menu').onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; if (b.dataset.p === 'view') return W3.toggleView(); ui.panel === b.dataset.p ? closePanel() : openPanel(b.dataset.p); };
$('#sheetBody').onclick = e => { const b = e.target.closest('[data-a]'); if (!b || b.disabled) return; const [a, arg] = b.dataset.a.split(':'); ACT[a](arg); };
const item = (icon, title, sub, btn) => `<div class="item"><div class="ic">${icon}</div><div class="tx"><b>${title}</b><small>${sub}</small></div>${btn || ''}</div>`;
const tabs = (panel, list) => { const cur = ui.tab[panel] || list[0][0]; return `<div class="tabs">${list.map(([id, t]) => `<button data-a="tab:${panel}.${id}" class="${id === cur ? 'on' : ''}">${t}</button>`).join('')}</div>`; };
const bar = v => `<div class="bar"><i style="width:${clamp(v, 0, 100)}%;background:${v < 35 ? '#c8553d' : v < 60 ? '#e0a526' : '#3f8a52'}"></i></div>`;
const nearHome = () => { const p = W3.pos(), h = home(); return dist([p.x, p.z], h.door) < 8 || dist([p.x, p.z], h.b.c) < 14; };

const PANELS = {
  build() {
    const st = stars();
    let h = `<div class="note">🏛️ הכסף לבנייה יוצא מ<b>קופת היישוב</b>: ${fmt(S.budget)}<br>👷 בוחרים מבנה, ואז מגרש כחול במפה מלמעלה. בשבת העבודות מושבתות 🕯️</div>`;
    for (const [id, f] of Object.entries(D.facilities)) {
      const cnt = S.built.filter(b => b.type === id).length, locked = (f.stars || 1) > st;
      h += item(f.icon, `${f.name}${cnt ? ` <span class="owned">(יש ${cnt})</span>` : ''}`,
        `${f.desc}<br>💰 ${fmt(f.cost)} · ⏱️ ${f.days} ימים${f.happy ? ` · 😊 +${f.happy}` : ''}${f.income ? ` · 📈 ${fmt(f.income)}/שבוע` : ''}${f.families ? ` · 🏠 +${f.families} משפחות` : ''}`,
        `<button data-a="build:${id}" ${locked ? 'disabled' : ''}>${locked ? '🔒 ' + '⭐'.repeat(f.stars) : 'לבנות'}</button>`);
    }
    return { title: '🏗️ לבנות ביישוב', html: h };
  },
  home() {
    const b = bById[S.house], tab = ui.tab.home || 'living', m = minOf(S.t), night = m >= 20 * 60 || m < 5 * 60, near = nearHome();
    let h = `<div class="note">🏠 <b>${addr(b)}</b>, גבעות עדן · 💰 יש לך <b>${fmt(S.money)}</b>${isShabbat(S.t) ? '<br>🕯️ שבת — החנויות סגורות.' : ''}</div>`;
    if (near && night) h += `<button class="btn" style="width:100%;padding:12px;margin-bottom:10px" data-a="sleep">😴 ללכת לישון</button>`;
    else if (!near) h += `<button class="btn sec" style="width:100%;padding:10px;margin-bottom:10px" data-a="gohome">🧭 להראות לי את הדרך הביתה</button>`;
    h += '<div class="rooms">';
    for (const [rid, rname] of Object.entries(D.rooms)) {
      if (rid === 'reno') continue;
      const things = D.shop.filter(i => i.room === rid && S.items.includes(i.id)).map(i => i.icon).join('');
      h += `<div class="room ${things ? '' : 'empty'}"><b>${rname}</b><div class="things">${things || '· · ·'}</div></div>`;
    }
    h += `<div class="room ${S.car ? '' : 'empty'}"><b>חניה</b><div class="things">${S.car ? car().icon : '· · ·'}</div></div></div>`;
    h += tabs('home', [...Object.entries(D.rooms), ['cars', '🚗 רכבים']]);
    if (tab === 'cars') {
      const cur = car();
      h += `<div class="note">${cur ? `יש לך <b>${cur.name}</b> (${cur.seats} מקומות). קונים רכב חדש — הישן נמכר בחצי מחיר.` : 'אין לך רכב עדיין. בלי רכב נוסעים לעבודה באוטובוס 🚌'}<br>👨‍👩‍👧 במשפחה שלך ${famSize()} אנשים. הרכב החדש יחכה לך בחניה ליד הבית.</div>`;
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
    let h = `<div class="note">❤️ שמחת המשפחה: <b>${famHappy()}%</b>${bar(famHappy())}<small>טיולים, משחקים עם הילדים, דברים לבית ושבת טובה משמחים את כולם. המשפחה מחכה לך בחצר ליד הבית!</small></div>`;
    h += item(S.gender === 'f' ? '👩' : '👨', `${esc(S.name)} — ${g('אבא', 'אמא')} ו${g('ראש', 'ראשת')} היישוב`, `${j.icon} ${j.name} · ${j.place}<br>💼 ${S.stats.workdays} ימי עבודה · 🙏 ${S.stats.prayers} תפילות`);
    h += item(S.gender === 'f' ? '👨' : '👩', `${esc(S.spouse)} — ${g('אמא', 'אבא')}`, `שמחה ${S.fh}%${bar(S.fh)}`);
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
  town() {
    const h0 = happy(), cap = capacity();
    const missing = ['synagogue', 'grocery', 'playground', 'kindergarten', 'school', 'bneiakiva', 'clinic', 'mikveh'].filter(k => !has(k));
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
    const list = S.built.map(b => item(D.facilities[b.type].icon, D.facilities[b.type].name, b.done ? '✅ פתוח' : `🏗️ בבנייה — ${Math.floor((100 * b.prog) / b.need)}%`, `<button class="btn sec" data-a="go:${b.id}">🧭 לשם</button>`)).join('');
    h += `<div class="sect">🏢 מבנים שבנית (${S.built.length})</div>${list || '<div class="note">עוד לא בנית כלום. לחץ 🏗️ לבנות!</div>'}`;
    return { title: '🏛️ היישוב', html: h };
  },
  missions() {
    const done = D.missions.filter(m => S.done.includes(m.id)).length;
    let h = `<div class="note">🏆 השלמת <b>${done}</b> מתוך ${D.missions.length} משימות</div>`;
    for (const m of D.missions) { const ok = S.done.includes(m.id); h += item(ok ? '✅' : m.icon, `<span style="${ok ? 'text-decoration:line-through;color:#6f6a60' : ''}">${m.text}</span>`, `פרס: ${m.reward.budget ? `🏛️ ${fmt(m.reward.budget)} לקופה` : `💰 ${fmt(m.reward.money)} לך`}`); }
    return { title: '📋 משימות', html: h };
  },
  menu() {
    return {
      title: '⚙️ תפריט',
      html: `<div class="note"><b>איך משחקים?</b><br>
        🕹️ <b>ללכת:</b> ${W3.MOBILE ? 'גוררים את האצבע בצד שמאל של המסך' : 'W A S D או החצים · Shift = לרוץ'}<br>
        👀 <b>להסתכל מסביב:</b> ${W3.MOBILE ? 'גוררים בצד ימין' : 'גוררים עם העכבר · גלגלת = זום'}<br>
        👁️ מחליף בין מבט מאחורי הדמות למבט מהעיניים.<br>
        🔵 <b>האור הכחול</b> מראה לאן ללכת. החץ למעלה אומר לאיזה כיוון.<br>
        🚗 נכנסים לרכב כשעומדים לידו. יוצאים מהיישוב דרך השער הצהוב בכניסה.<br>
        🕯️ ביום שישי ב-17:30 נכנסת שבת — לא נוסעים, לא עובדים ולא בונים.</div>
        <div class="note">🗺️ הבתים, הרחובות וגובה השטח אמיתיים — מ-OpenStreetMap (© OpenStreetMap contributors) ומנתוני גובה פתוחים. מספרי הבתים לא רשומים במפה, אז מספרנו לפי הסדר ברחוב.</div>
        <button class="btn" style="width:100%;padding:12px;margin-bottom:8px" data-a="save">💾 לשמור</button>
        <button class="btn sec" style="width:100%;padding:12px;margin-bottom:8px" data-a="tohome">🏠 לחזור לבית שלי (קפיצה)</button>
        <button class="btn sec" style="width:100%;padding:12px;background:#fde8e2" data-a="reset">🔄 להתחיל משחק חדש</button>`,
    };
  },
  facility() {
    const b = S.built.find(x => x.id === ui.facId);
    if (!b) return { title: '', html: '' };
    const f = D.facilities[b.type], p = W3.pos(), near = dist([p.x, p.z], plotXY(b)) < 18;
    let h = `<div class="note">${f.desc}</div>`;
    if (!b.done) {
      h += `<div class="stat"><span>🏗️ בבנייה</span><b>${Math.floor((100 * b.prog) / b.need)}%</b></div>${bar((100 * b.prog) / b.need)}`;
      h += `<div class="note" style="margin-top:10px">⏱️ עוד בערך ${Math.ceil((b.need - b.prog) / DAY)} ימי עבודה${isShabbat(S.t) ? '<br>🛑 שבת — העבודות מושבתות' : ''}</div>`;
      return { title: `${f.icon} ${f.name}`, html: h };
    }
    if (b.type === 'bneiakiva') return PANELS.ba(near);
    if (f.income) h += `<div class="stat"><span>📈 מכניס לקופה</span><b>${fmt(f.income)}/שבוע</b></div>`;
    if (f.upkeep) h += `<div class="stat"><span>🔧 אחזקה</span><b>${fmt(f.upkeep)}/שבוע</b></div>`;
    h += '<div style="height:10px"></div>';
    if (!near) return { title: `${f.icon} ${f.name}`, html: h + `<button class="btn" style="width:100%;padding:12px" data-a="go:${b.id}">🧭 להראות לי את הדרך</button>` };
    if (b.type === 'synagogue') h += item('🙏', `להתפלל ${prayerName()}`, `התפללת ${S.stats.prayers} פעמים`, '<button data-a="pray">להתפלל</button>');
    if (b.type === 'grocery') h += item('🛒', 'קניות לשבת', '₪600 · חלות, יין, דגים ועוף', `<button data-a="shop" ${S.shopWeek === weekNo() ? 'disabled' : ''}>${S.shopWeek === weekNo() ? '✓ קניתם' : 'לקנות'}</button>`);
    if (OUTINGS[b.type]) { const o = OUTINGS[b.type]; h += item(f.icon, o.label, `${o.cost ? fmt(o.cost) : 'חינם'} · ${o.min} דק׳ · 😊 +${o.h}`, `<button data-a="out:${b.type}">יאללה</button>`); }
    if (b.type === 'school') h += `<div class="stat"><span>🎒 תלמידים</span><b>${Math.round(S.families * 1.6)}</b></div>`;
    return { title: `${f.icon} ${f.name}`, html: h };
  },
  ba(near) {
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
    toast(`🛍️ קנית ${it.name}! ${it.icon}`, 'gold'); checkMissions(); save(); refreshPanel();
  },
  car(id) {
    const c = D.cars.find(x => x.id === id), old = car(), price = c.cost - (old ? Math.round(old.cost / 2) : 0);
    if (isShabbat(S.t)) return toast('🕯️ שבת — הסוכנות סגורה!', 'red');
    if (S.money < price) return toast('אין לך מספיק כסף 😬', 'red');
    if (W3.pos().mode === 'drive') W3.exitCar();
    S.money -= price; S.car = id; boostFam(6);
    W3.setCar(id); const h = home(); W3.placeCar(h.park[0], h.park[1], h.parkHeading);
    toast(`🔑 מזל טוב על ה${c.name} החדש! ${c.icon} הוא מחכה לך בחניה ליד הבית.${old ? `<br>מכרת את ה${old.name} ב-${fmt(old.cost / 2)}` : ''}`, 'gold');
    checkMissions(); save(); refreshPanel();
  },
  play(i) {
    const k = S.kids[+i];
    k.played = today(); k.h = clamp(k.h + 12, 0, 100); S.fh = clamp(S.fh + 3, 0, 100);
    advanceSilent(45); flushLater();
    toast(`🎲 שיחקת עם ${k.name} ב${pick(k.age < 6 ? ['מחבואים', 'לגו', 'קוביות', 'תופסת'] : ['כדורגל בחצר', 'מונופול', 'קלפים', 'שחמט', 'תופסת', 'פלייסטיישן'])}! ${k.name} ${k.g === 'b' ? 'מאושר' : 'מאושרת'} 😄`, 'gold');
    save(); refreshPanel();
  },
  baby() { if (S.kids.length >= 12) return toast('וואו, כבר 12 ילדים! 😅', 'blue'); S.babyDue = S.t + 5 * DAY; toast('🤰 בשעה טובה! עוד 5 ימים התינוק/ת יגיעו 💕', 'gold'); save(); refreshPanel(); },
  pray() { closePanel(); doPray(); },
  shop: () => shopForShabbat(),
  out: t => outing(t),
  sleep: () => sleep(),
  gohome() { closePanel(); guideHome(); },
  go(id) { const b = S.built.find(x => x.id === +id); closePanel(); const f = D.facilities[b.type]; setGuide(...plotXY(b), f.name, f.icon); toast(`🧭 לך אל האור הכחול — ${f.name}`, 'blue', [], 4000); },
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
  tohome() { closePanel(); if (W3.inside()) { W3.exitInterior(); ui.inside = null; ui.work = null; document.body.classList.remove('inside'); } if (W3.pos().mode === 'drive') W3.exitCar(); const h = home(); W3.teleport(h.door[0], h.door[1], Math.atan2(-h.dir[0], -h.dir[1])); },
  reset() { if (confirm('בטוח? כל המשחק יימחק ונתחיל מההתחלה')) { localStorage.removeItem(SAVE_KEY); location.reload(); } },
};
window.addEventListener('keydown', e => { if (e.code === 'Escape') { if (ui.panel) closePanel(); else if (ui.placing) cancelPlacing(); } });

// ===================== setup (new game) =====================
const setupData = { gender: 'm', name: '', spouse: '', kids: [], job: 'hitech', house: null };
function randKid() { const b = Math.random() < 0.5; return { name: pick(b ? D.boys : D.girls), g: b ? 'b' : 'g', age: 3 + Math.floor(Math.random() * 10) }; }
function renderSetup(step) {
  const w = $('#setupWrap'), steps = `<div class="steps">${[1, 2, 3, 4].map(i => `<i class="${i <= step ? 'on' : ''}"></i>`).join('')}</div>`, sd = setupData;
  if (step === 1) {
    w.innerHTML = `${steps}<h2>מי ${sd.gender === 'f' ? 'את' : 'אתה'} ביישוב?</h2><p class="sub">${sd.gender === 'f' ? 'את אמא, ואת גם ראשת היישוב!' : 'אתה אבא, ואתה גם ראש היישוב!'}</p>
      <div class="choices"><button class="choice ${sd.gender === 'm' ? 'sel' : ''}" data-g="m"><span class="e">👨</span>אבא</button><button class="choice ${sd.gender === 'f' ? 'sel' : ''}" data-g="f"><span class="e">👩</span>אמא</button></div>
      <label class="f">איך קוראים לך?</label><input class="t" id="inName" maxlength="20" value="${esc(sd.name)}" placeholder="השם שלך">
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
  W3.attract = false;
  ui.picking = true; ui.top = true;
  document.body.classList.add('picking');
  show('game');
  $('#hud').innerHTML = ''; $('#menu').classList.add('hidden');
  W3.setPlayer(setupData.gender);
  W3.topView('house', null, id => pickHouse(id));
  const p = document.createElement('div');
  p.id = 'pick';
  p.innerHTML = `<div style="font-weight:800;font-size:17px;color:#2f6b3f;text-align:center">🏠 איפה ${setupData.gender === 'f' ? 'את גרה' : 'אתה גר'}?</div>
    <div style="text-align:center;color:#6f6a60;font-size:12.5px;margin:2px 0 6px">לחץ על הבית שלך במפה (אפשר להזיז ולהגדיל) — או בחר רחוב ומספר</div>
    <div class="row"><select class="t" id="pSt"><option value="">רחוב...</option>${streets.map(s => `<option>${s}</option>`).join('')}</select><select class="t" id="pNum"><option value="">מספר...</option></select></div>
    <div class="chosen" id="pChosen"></div>
    <button class="big" id="pOk" disabled>🏠 זה הבית שלי!</button>`;
  $('#game').appendChild(p);
  const fillNums = st => { $('#pNum').innerHTML = '<option value="">מספר...</option>' + M.buildings.filter(b => b.st === st).sort((a, b) => a.n - b.n).map(b => `<option value="${b.id}">${b.n}</option>`).join(''); };
  $('#pSt').onchange = e => fillNums(e.target.value);
  $('#pNum').onchange = e => e.target.value && pickHouse(+e.target.value, true);
  $('#pOk').onclick = startGame;
}
function pickHouse(id, fromList) {
  setupData.house = id;
  const b = bById[id], h = W3.houseById[id];
  W3.setGuide({ x: b.c[0], z: b.c[1] });
  $('#pChosen').textContent = `📍 ${addr(b)}`;
  $('#pOk').disabled = false;
  if (!fromList) { $('#pSt').value = b.st; $('#pSt').onchange({ target: $('#pSt') }); $('#pNum').value = id; }
  W3.topFocus(h.b.c[0], h.b.c[1], 140);
}

// ===================== start =====================
function show(id) { ['start', 'setup', 'game'].forEach(s => $('#' + s).classList.toggle('hidden', s !== id)); }
function startGame() {
  S = newState(setupData);
  ui.picking = false; ui.top = false;
  document.body.classList.remove('picking');
  const p = $('#pick'); if (p) p.remove();
  W3.exitTop(); W3.setGuide(null);
  const h = home();
  W3.teleport(h.door[0] + h.dir[0] * 1.5, h.door[1] + h.dir[1] * 1.5, Math.atan2(-h.dir[0], -h.dir[1]));
  enterGame();
  modal({
    icon: '🎉🏡', title: `${g('ברוך הבא', 'ברוכה הבאה')} לגבעות עדן!`,
    text: `${esc(S.name)}, ${g('אתה עומד', 'את עומדת')} מול הבית שלך — ${addr(bById[S.house])}! מהיום ${g('אתה ראש', 'את ראשת')} היישוב 🏛️<br><br>💰 יש לך <b>₪500,000</b> · 🏛️ בקופת היישוב <b>₪1,500,000</b><br><br>${W3.MOBILE ? '🕹️ גרור באצבע בצד <b>שמאל</b> כדי ללכת, ובצד <b>ימין</b> כדי להסתכל מסביב.' : '🕹️ W A S D כדי ללכת, גרירה עם העכבר כדי להסתכל מסביב.'}<br>🏗️ אולי להתחיל מ<b>בית כנסת</b> ו<b>מכולת</b>? 😉`,
    buttons: [{ t: 'יאללה, מתחילים! 🚀' }],
  });
  save();
}
function enterGame() {
  S.inv = S.inv || []; S.furn = S.furn || {};
  W3.attract = false;
  document.body.classList.add('playing');
  if (!W3.MOBILE) { $('#joyhint').classList.add('hidden'); $('#run').classList.add('hidden'); }
  show('game');
  $('#menu').classList.remove('hidden');
  W3.setPlayer(S.gender); W3.setHome(S.house); W3.setFacilities(S.built);
  if (S.car) { W3.setCar(S.car); const h = home(), c = S.carAt || { x: h.park[0], z: h.park[1], h: h.parkHeading }; W3.placeCar(c.x, c.z, c.h); }
  initHud(); placeFamily(); renderHud();
  W3.onFrame = renderActs;
  if (S.riding) W3.setRide(S.riding);
  if (window.initChat) initChat();
  W3.frozen = false;
}
function goFull() {
  if (!W3.MOBILE) return;
  try { const el = document.documentElement; (el.requestFullscreen ? el.requestFullscreen() : Promise.resolve()).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape')).catch(() => {}); } catch (e) {}
}

window.bootLife = function () {
  W3.onKeyAction = () => { if (ui.acts && ui.acts[0] && !ui.modal && !ui.panel) ui.acts[0][1](); };
  setInterval(tick, 250);
  const saved = load();
  $('#btnNew').disabled = false; $('#btnNew').textContent = '🎮 משחק חדש';
  if (saved && saved.v === 1) $('#btnCont').classList.remove('hidden');
  $('#btnCont').onclick = () => {
    goFull();
    S = load();
    const h = home();
    if (S.pos && S.pos.mode !== 'drive') W3.teleport(S.pos.x, S.pos.z); else W3.teleport(h.door[0], h.door[1], Math.atan2(-h.dir[0], -h.dir[1]));
    enterGame();
    toast(`👋 ${g('ברוך השב', 'ברוכה השבה')}, ${esc(S.name)}!`, 'gold');
  };
  $('#btnNew').onclick = () => {
    if (saved && !confirm('יש משחק שמור. להתחיל משחק חדש? (השמור יימחק)')) return;
    goFull();
    show('setup'); renderSetup(1);
  };
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
  modal({ icon: '📲', title: 'להתקין את המשחק', text: ios ? 'בספארי: לוחצים על כפתור השיתוף <b>⬆️</b> למטה, ואז על <b>"הוסף למסך הבית"</b>.' : 'בכרום: לוחצים על <b>⋮</b> (שלוש הנקודות למעלה), ואז על <b>"התקנת אפליקציה"</b> או <b>"הוספה למסך הבית"</b>.', buttons: [{ t: 'הבנתי 👍' }] });
};
