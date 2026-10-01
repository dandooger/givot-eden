// Plays the game in a hidden Chrome and saves screenshots: node tools/shot.js [url] [outDir]
const puppeteer = require('../../hazira-qa/node_modules/puppeteer-core');
const path = require('path'), fs = require('fs');
const URL = process.argv[2] || 'http://localhost:8897/';
const OUT = process.argv[3] || path.join(__dirname, '../.shots');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.setViewport({ width: 900, height: 420, deviceScaleFactor: 1 });
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('btnNew').disabled, { timeout: 120000 });
  const shot = async n => { await sleep(700); await page.screenshot({ path: path.join(OUT, n + '.png') }); console.log('shot', n); };
  await shot('01-start');
  await page.evaluate(() => {
    document.querySelector('#btnNew').click(); document.querySelector('#inName').value = 'דניאל';
    document.querySelector('#next').click(); document.querySelector('#next').click(); document.querySelector('#next').click();
  });
  await sleep(800);
  await page.evaluate(() => { const b = MAP.buildings.find(b => b.st === 'הקדרון' && b.n === 13); pickHouse(b.id); });
  await shot('02-pick');
  await page.evaluate(() => document.querySelector('#pOk').click());
  await shot('03-welcome');
  await page.evaluate(() => document.querySelector('#mcard button').click());
  await shot('04-home');
  // walk towards the street
  await page.evaluate(() => { const h = W3.houseById[S.house]; W3.teleport(h.door[0], h.door[1], Math.atan2(h.dir[0], h.dir[1])); });
  await page.keyboard.down("KeyW"); await sleep(8000); await page.keyboard.up('KeyW');
  console.log('pos after walk', await page.evaluate(() => JSON.stringify(W3.pos())));
  await shot('05-walked');
  // buy a car and drive
  await page.evaluate(() => { S.money = 600000; ACT.car('octavia'); const h = W3.houseById[S.house]; W3.teleport(h.park[0] + 2, h.park[1] + 2, 0); });
  await sleep(400);
  await page.evaluate(() => { W3.enterCar(); });
  await page.keyboard.down("KeyW"); await sleep(8000); await page.keyboard.up('KeyW');
  console.log('car after drive', await page.evaluate(() => JSON.stringify(W3.car())));
  await shot('06-driving');
  // build a synagogue right away and look at it
  await page.evaluate(() => { W3.exitCar(); S.built.push({ id: 1, type: 'synagogue', plot: 5, prog: 1, need: 1, done: true }, { id: 2, type: 'bneiakiva', plot: 6, prog: 1, need: 1, done: true }, { id: 3, type: 'playground', plot: 7, prog: 1, need: 1, done: true }); W3.setFacilities(S.built); const p = MAP.plots[5]; W3.teleport(p.x, p.y + 25, Math.PI); });
  await shot('07-synagogue');
  await page.evaluate(() => { const p = MAP.plots[6]; W3.teleport(p.x - 5, p.y + 22, Math.PI); });
  await shot('08-bneiakiva');
  // night
  await page.evaluate(() => { S.t = 21 * 60; });
  await shot('09-night');
  // shabbat
  await page.evaluate(() => { S.t = 6 * 1440 + 10 * 60; });
  await shot('10-shabbat');
  // gate
  await page.evaluate(() => { const g = W3.gate; W3.teleport(g.x + 10, g.z + 25, Math.PI); S.t = 12 * 60; });
  await shot('11-gate');
  // first person
  await page.evaluate(() => { const h = W3.houseById[S.house]; W3.teleport(h.door[0] + h.dir[0] * 6, h.door[1] + h.dir[1] * 6, Math.atan2(-h.dir[0], -h.dir[1])); W3.toggleView(); });
  await shot('12-firstperson');
  // ---- gameplay logic checks ----
  const fps = await page.evaluate(async () => { const f0 = W3.frames; await new Promise(r => setTimeout(r, 3000)); return (W3.frames - f0) / 3; });
  console.log('fps (software rendering)', fps.toFixed(1));
  // drive to the gate on a weekday morning -> exit menu -> work
  const r1 = await page.evaluate(async () => {
    if (W3.view() === 'first') W3.toggleView();
    S.t = 1440 + 8 * 60; S.workedDay = -1;
    const g = W3.gate; W3.placeCar(g.trigger[0], g.trigger[1], 0); W3.enterCar();
    await new Promise(r => setTimeout(r, 2500));
    const title = document.querySelector('#mcard h3').textContent, open = !document.getElementById('modal').classList.contains('hidden');
    const btns = [...document.querySelectorAll('#mcard .acts button')].map(b => b.textContent.slice(0, 30));
    const money0 = S.money;
    document.querySelector('#mcard .acts button').click(); // work
    await new Promise(r => setTimeout(r, 2500));
    return { open, title, btns: btns.slice(0, 4), paid: S.money - money0, time: hhmm(S.t), mode: W3.pos().mode, modal: document.querySelector('#mcard h3').textContent };
  });
  console.log('gate/work', JSON.stringify(r1));
  // pray at the synagogue
  const r2 = await page.evaluate(async () => {
    closeModal(); W3.exitCar();
    guidePray();
    const [x, z] = [MAP.plots[5].x, MAP.plots[5].y]; W3.teleport(x, z + 12, Math.PI);
    await new Promise(r => setTimeout(r, 1500));
    const acts = nearbyActions().map(a => a[0]);
    const pr0 = S.stats.prayers;
    nearbyActions()[0][1]();
    await new Promise(r => setTimeout(r, 2500));
    return { acts, prayed: S.stats.prayers - pr0 };
  });
  console.log('pray', JSON.stringify(r2));
  await shot('13-after-pray');
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
