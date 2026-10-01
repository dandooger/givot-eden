// Tests the inside places, shop, tremp and WhatsApp in a hidden Chrome: node tools/test-inside.js [url]
const puppeteer = require('../../hazira-qa/node_modules/puppeteer-core');
const path = require('path'), fs = require('fs');
const URL = process.argv[2] || 'http://localhost:8897/';
const OUT = path.join(__dirname, '../.shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.setViewport({ width: 900, height: 420 });
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('btnNew').disabled, { timeout: 120000 });
  const shot = async n => { await sleep(2500); await page.screenshot({ path: path.join(OUT, n + '.png') }); };
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const closeModals = () => ev(() => { while (ui.modal) { closeModal(); ui.mq = []; } });
  await ev(() => {
    document.querySelector('#btnNew').click(); document.querySelector('#inName').value = 'דניאל';
    document.querySelector('#next').click(); document.querySelector('#next').click();
    document.querySelector('.choice[data-j="teacher"]').click();
    document.querySelector('#next').click();
  });
  await sleep(600);
  await ev(() => { const b = MAP.buildings.find(b => b.st === 'הקדרון' && b.n === 13); pickHouse(b.id); document.querySelector('#pOk').click(); });
  await sleep(800); await closeModals();
  const R = {};
  // ---- home ----
  await ev(() => { S.kids.forEach(k => (k.age = 8)); S.items.push('sofa', 'tv', 'table', 'bed', 'fridge', 'toys', 'dog', 'books'); S.t = 1440 + 16 * 60; enterHome(); });
  await sleep(1500); await closeModals();
  await shot('20-home-inside');
  R.home = await ev(async () => {
    const acts0 = nearbyActions().map(a => a[0]);
    W3.teleport(W3.IO.x - 4.5, W3.IO.z + 2.6, Math.PI); // next to the sofa
    await new Promise(r => setTimeout(r, 300));
    const acts1 = nearbyActions().map(a => a[0]);
    const moved = W3.carry('sofa');
    W3.teleport(W3.IO.x - 2, W3.IO.z + 0.5, Math.PI);
    await new Promise(r => setTimeout(r, 1500));
    dropFurniture();
    return { acts0, acts1, moved, sofa: S.furn.sofa };
  });
  R.cook = await ev(async () => { const f0 = S.fh, m0 = S.money; cook(RECIPES[1]); await new Promise(r => setTimeout(r, 2500)); const t = document.querySelector('#mcard h3').textContent; closeModal(); return { fh: S.fh - f0, paid: m0 - S.money, title: t }; });
  // ---- shop ----
  R.shop = await ev(() => { ['3 תפוחים', 'קורקינט', 'חללית', 'שלושה ביצים', 'אופנים', 'כיסא'].forEach(buyText); return S.inv.map(i => `${i.n}×${i.qty}${i.place ? '(בית)' : ''}${i.ride ? '(' + i.ride + ')' : ''}`); });
  R.ride = await ev(() => { const it = S.inv.find(i => i.ride); useItem(it.key); return S.riding; });
  await ev(() => { openPanel('shop'); document.querySelector('#shopIn').value = '2 גלידה'; document.querySelector('#shopIn').oninput(); });
  await shot('21-shop');
  await ev(() => closePanel());
  // ---- synagogue: caravan, then a real one ----
  await ev(() => { leavePlace(); });
  await sleep(1200);
  await ev(() => { S.t = 1440 + 19 * 60 + 35; enterSynagogue(); });
  await sleep(1500);
  await shot('22-caravan-minyan');
  R.caravan = await ev(() => ({ people: W3.inside() ? document.title && nearbyActions().map(a => a[0]) : null }));
  await ev(() => { leavePlace(); });
  await sleep(1000);
  await ev(() => { S.built.push({ id: 1, type: 'synagogue', plot: 5, prog: 1, need: 1, done: true }, { id: 2, type: 'school', plot: 9, prog: 1, need: 1, done: true }); W3.setFacilities(S.built); S.t = 6 * 1440 + 9 * 60; enterSynagogue(); });
  await sleep(1500);
  await shot('23-synagogue-shabbat');
  R.pray = await ev(async () => { const a = nearbyActions().map(a => a[0]); const p0 = S.stats.prayers; nearbyActions().find(x => /להתפלל/.test(x[0]))[1](); await new Promise(r => setTimeout(r, 2500)); return { a, prayed: S.stats.prayers - p0 }; });
  await ev(() => leavePlace()); await sleep(1000);
  // ---- neighbour ----
  R.knock = await ev(async () => { const h = W3.houses.find(h => h.id !== S.house && (h.id + today()) % 4 !== 0); knock(h); await new Promise(r => setTimeout(r, 1500)); return { inside: W3.inside(), kind: ui.inside && ui.inside.kind, modal: document.querySelector('#mcard h3').textContent }; });
  await closeModals();
  await shot('24-neighbor');
  await ev(() => leavePlace()); await sleep(1000);
  // ---- work as a teacher in the settlement school ----
  R.work = await ev(async () => { S.t = 2 * 1440 + 8 * 60; S.workedDay = -1; doWork('school'); await new Promise(r => setTimeout(r, 1500)); return { inside: ui.inside && ui.inside.name }; });
  await closeModals();
  await shot('25-classroom');
  R.workEnd = await ev(async () => { const m0 = S.money; workTask('📚 ללמד שיעור'); await new Promise(r => setTimeout(r, 2500)); finishWork(); await new Promise(r => setTimeout(r, 2500)); return { pay: S.money - m0, time: hhmm(S.t), modal: document.querySelector('#mcard h3').textContent, inside: W3.inside() }; });
  await closeModals();
  // ---- tremp ----
  R.tremp = await ev(async () => { const t = W3.gate.tremp; W3.teleport(t[0], t[1], 0); S.t = 3 * 1440 + 10 * 60; await new Promise(r => setTimeout(r, 500)); const a = nearbyActions().map(a => a[0]); waitTremp(); await new Promise(r => setTimeout(r, 2500)); return { a, modal: document.querySelector('#mcard h3').textContent, btns: [...document.querySelectorAll('#mcard .acts button')].map(b => b.textContent.slice(0, 25)).slice(0, 4) }; });
  await closeModals();
  await shot('26-tremp');
  // ---- WhatsApp ----
  R.chat = await ev(async () => { ui.chatG = 'minyan'; openPanel('chat'); document.querySelector('#chatIn').value = 'מי בא לערבית?'; ACT.chatsend(); await new Promise(r => setTimeout(r, 4500)); return S.chat.minyan.slice(-3).map(m => `${m.f}: ${m.x}`); });
  await shot('27-whatsapp');
  console.log(JSON.stringify(R, null, 1));
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
