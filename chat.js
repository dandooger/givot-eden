'use strict';
// The settlement's WhatsApp: groups with the neighbours, the family, the minyan, tremps and Bnei Akiva.
// Neighbours write on their own during the day, and answer what you write. On Shabbat — no phones.
const GROUPS = [
  { id: 'town', name: 'גבעות עדן 🏡 הודעות היישוב', icon: '🏡' },
  { id: 'family', name: 'המשפחה ❤️', icon: '❤️' },
  { id: 'minyan', name: 'מניין גבעות עדן 🕍', icon: '🕍' },
  { id: 'tremp', name: 'טרמפים מגבעות עדן 🚗', icon: '🚗' },
  { id: 'ba', name: 'בני עקיבא — הורים 💙', icon: '💙', need: () => has('bneiakiva') },
];
const NEIGHBORS = M.buildings.filter((b, i) => i % 5 === 0).slice(0, 24).map((b, i) => `${(i % 2 ? D.girls : D.boys)[(b.id >> 3) % D.boys.length]} ${surname(b)}`);
const TOWN_CHAT = [
  'מישהו ראה כלב חום מסתובב ליד רחוב הקדרון? 🐕', 'תודה לכל מי שבא לעזור בגינה הקהילתית 🌳', 'יש למישהו מקדחה להשאיל? 🙏', 'מזל טוב למשפחת לוי על הולדת הבן! 👶🎉',
  'מחר יש איסוף בגדים לנזקקים ליד בית הכנסת', 'שימו לב — עובדים על הכביש ברחוב סיני 🚧', 'מי רוצה ארגז עגבניות מהחממה? 🍅', 'איזה שקיעה יש עכשיו מהגבעה! 🌅',
  'מחפשת בייביסיטר ליום חמישי בערב', 'נמצאו מפתחות ליד תחנת האוטובוס 🔑', 'שבוע טוב לכולם! 🎶', 'מישהו יודע מתי פותחים את המכולת? 🛒', 'כל הכבוד לראש היישוב על העבודה 👏',
];
const ANSWERS = ['😂😂', 'מסכים לגמרי 👍', 'יאללה!', 'חח', 'אמן 🙏', 'וואו', 'מי עוד בא?', 'כל הכבוד!', 'תודה על העדכון 🙏', 'אני בעד 👍'];
function initChat() {
  if (!S.chat) {
    S.chat = { town: [], family: [], minyan: [], tremp: [], ba: [] }; S.unread = {};
    postMsg('town', 'ועד היישוב', `ברוכים הבאים ל${S.name}, ${g('ראש', 'ראשת')} היישוב החדש${g('', 'ה')}! 🎉 בהצלחה!`, { quiet: true });
    postMsg('family', S.spouse, 'איזה כיף לגור בגבעות עדן ❤️', { quiet: true });
    postMsg('minyan', 'הגבאי', 'זמני תפילות: שחרית 6:30 · מנחה 13:30 · ערבית 19:30 🙏', { quiet: true });
    postMsg('tremp', NEIGHBORS[3], 'מי שצריך טרמפ — תכתבו פה או תחכו בטרמפיאדה ליד השער 👍', { quiet: true });
  }
  S.unread = S.unread || {};
  S.lastChatT = S.lastChatT || S.t;
  updateChatBadge();
}
function postMsg(gid, from, text, o = {}) {
  if (!S || !S.chat) return;
  (S.chat[gid] = S.chat[gid] || []).push({ f: from, x: text, t: S.t, me: !!o.me });
  if (S.chat[gid].length > 80) S.chat[gid].shift();
  if (!o.me) {
    if (!(ui.panel === 'chat' && ui.chatG === gid)) S.unread[gid] = (S.unread[gid] || 0) + 1;
    if (!o.quiet && !ui.silent && ui.panel !== 'chat') toast(`💬 <b>${GROUPS.find(x => x.id === gid).icon} ${esc(from)}:</b> ${esc(text)}`, 'blue', [['לפתוח', () => { ui.chatG = gid; openPanel('chat'); }]], 4500);
  }
  updateChatBadge();
  if (ui.panel === 'chat') refreshPanel();
}
function updateChatBadge() {
  const b = document.querySelector('#menu [data-p="chat"]'); if (!b || !S) return;
  const n = Object.values(S.unread || {}).reduce((s, v) => s + v, 0);
  b.dataset.badge = n ? (n > 9 ? '9+' : n) : '';
}
// the game clock decides when people write
function chatPoll() {
  if (!S || !S.chat || ui.picking) return;
  let from = S.lastChatT || S.t;
  if (S.t - from > 180) from = S.t - 180; // after a long skip, only the last 3 hours
  for (let t = from + 1; t <= S.t; t++) {
    if (isShabbat(t)) continue; // phones are off on Shabbat
    const m = minOf(t), d = dayOf(t), kids = kidsHome().filter(k => k.age >= 9);
    const say = (gid, who, txt) => postMsg(gid, who, txt, { quiet: S.t - t > 30 });
    if (d <= 4 && m === 6 * 60 + 15) say('minyan', 'הגבאי', 'שחרית ב-6:30 ☀️ מי מגיע?');
    if (d <= 4 && m === 19 * 60 + 10) say('minyan', 'הגבאי', `ערבית ב-19:30 — חסרים ${1 + (t % 3)} למניין! מי בא? 🙏`);
    if (d <= 4 && m === 7 * 60) say('tremp', pick(NEIGHBORS), `יוצא לירושלים ב-7:45, יש ${1 + (t % 3)} מקומות 🚗`);
    if (d <= 4 && m === 16 * 60 + 30) say('tremp', pick(NEIGHBORS), 'מישהו חוזר מבית שמש עכשיו? 🙏');
    if (d === 5 && m === 12 * 60) say('town', 'ועד היישוב', '📢 זמני שבת: כניסה 17:30 · יציאה 18:45. שבת שלום! 🕯️');
    if (d === 5 && m === 17 * 60) say('family', S.spouse, 'עוד חצי שעה מדליקים נרות! 🕯️ איפה את/ה?');
    if (d === 6 && m === 18 * 60 + 50) say('town', pick(NEIGHBORS), 'שבוע טוב לכולם! 🎶');
    if (d === 3 && m === 20 * 60 && has('bneiakiva')) say('ba', 'רכזת הסניף', `תזכורת: פעולה בשבת ב-16:00! הנושא: ${pick(BA_TOPICS)} 💙`);
    if (kids.length && d <= 4 && m === 13 * 60 + 15) say('family', pick(kids).name, `${g('אבא', 'אמא')}, מה יש לאכול? 😋`);
    if (d <= 5 && m === 18 * 60 + 30 && Math.random() < 0.5) say('family', S.spouse, pick(['קנית חלב בדרך? 🥛', 'מתי את/ה חוזר/ת הביתה?', 'הילדים מחכים לך ❤️', 'אל תשכח/י את הזבל 😅']));
    if (m > 8 * 60 && m < 22 * 60 && Math.random() < 1 / 100) say('town', pick(NEIGHBORS), pick(TOWN_CHAT));
  }
  S.lastChatT = S.t;
}
setInterval(chatPoll, 1000);
function reply(gid, text) {
  const t = text;
  const who = gid === 'family' ? [S.spouse, ...kidsHome().filter(k => k.age >= 9).map(k => k.name)] : gid === 'minyan' ? ['הגבאי', ...NEIGHBORS.slice(0, 6)] : gid === 'ba' ? ['רכזת הסניף', ...NEIGHBORS.slice(6, 12)] : NEIGHBORS;
  let lines;
  if (/טרמפ/.test(t)) lines = [`יש לי מקום ב-${8 + (S.t % 3)}:${['00', '15', '30'][S.t % 3]} לירושלים, תבוא לטרמפיאדה 👍`, 'אני יוצא לבית שמש עוד חצי שעה 🚗'];
  else if (/בוקר טוב/.test(t)) lines = ['בוקר טוב! ☀️', 'בוקר אור 🌞'];
  else if (/ערב טוב|לילה טוב/.test(t)) lines = ['לילה טוב 🌙', 'ערב טוב!'];
  else if (/מניין|תפיל|ערבית|שחרית|מנחה|מתפלל/.test(t)) lines = ['אני בא! 🙏', 'גם אני מגיע', 'אני כבר בדרך 🏃'];
  else if (/תודה/.test(t)) lines = ['בכיף 🙏', 'אין בעד מה!', 'תמיד 😊'];
  else if (/אוהב|אוהבת|❤/.test(t) && gid === 'family') lines = ['גם אני אוהב/ת אותך ❤️', '❤️❤️❤️'];
  else if (/בית כנסת|מכולת|גן|בריכה|בית ספר|סניף|לבנות/.test(t)) lines = ['אמן! יאללה לבנות כבר 🏗️', 'זה בדיוק מה שהיישוב צריך!', 'כל הכבוד לראש היישוב 👏'];
  else if (/\?/.test(t)) lines = ['כן, נראה לי 👍', 'אין לי מושג 😅', 'תשאל את ראש היישוב... רגע, זה אתה! 😂', 'שאלה טובה 🤔'];
  else lines = gid === 'family' ? ['סבבה 👍', 'מתי את/ה חוזר/ת הביתה?', 'קנית חלב? 🥛', '😂😂'] : ANSWERS;
  const n = 1 + (Math.random() < 0.4 ? 1 : 0);
  for (let i = 0; i < n; i++) setTimeout(() => { if (isShabbat(S.t)) return; postMsg(gid, pick(who), pick(lines), { quiet: true }); boostTown(0.1); save(); }, 1400 + i * 1600 + Math.random() * 1200);
}
PANELS.chat = function () {
  const gid = ui.chatG, sh = isShabbat(S.t);
  if (!gid) {
    let h = `<div class="note">💬 <b>הוואטסאפ של היישוב</b>${sh ? '<br>📵 שבת — הטלפון כבוי. ההודעות יחכו למוצאי שבת.' : ''}</div>`;
    for (const gr of GROUPS) {
      if (gr.need && !gr.need()) continue;
      const msgs = S.chat[gr.id] || [], last = msgs[msgs.length - 1], un = S.unread[gr.id] || 0;
      h += `<div class="item chatg" data-a="chatopen:${gr.id}"><div class="ic">${gr.icon}</div><div class="tx"><b>${gr.name}</b><small>${last ? `${esc(last.me ? 'את/ה' : last.f)}: ${esc(last.x).slice(0, 48)}` : 'אין הודעות'}</small></div>${un ? `<span class="unread">${un}</span>` : ''}</div>`;
    }
    return { title: '💬 וואטסאפ', html: h };
  }
  const gr = GROUPS.find(x => x.id === gid);
  S.unread[gid] = 0; updateChatBadge();
  const msgs = S.chat[gid] || [];
  const html = `<button class="btn sec" data-a="chatback" style="margin-bottom:8px">→ כל הקבוצות</button>
    <div class="chatbox" id="chatbox">${msgs.map(m => `<div class="msg ${m.me ? 'me' : ''}">${m.me ? '' : `<b>${esc(m.f)}</b>`}${esc(m.x)}<small>${hhmm(m.t)}</small></div>`).join('') || '<div class="note">עוד אין הודעות — תהיה הראשון!</div>'}</div>
    <div class="shoprow"><input id="chatIn" class="t" placeholder="${sh ? '📵 שבת — אין טלפון' : 'כתוב הודעה...'}" ${sh ? 'disabled' : ''} autocomplete="off"><button class="btn" data-a="chatsend" ${sh ? 'disabled' : ''}>➤</button></div>`;
  return { title: `${gr.icon} ${gr.name}`, html, bind() { const b = $('#chatbox'); b.scrollTop = b.scrollHeight; const i = $('#chatIn'); if (i) i.onkeydown = e => { if (e.key === 'Enter') ACT.chatsend(); }; } };
};
ACT.chatopen = id => { ui.chatG = id; refreshPanel(); };
ACT.chatback = () => { ui.chatG = null; refreshPanel(); };
ACT.chatsend = () => {
  const i = $('#chatIn'), t = (i && i.value || '').trim().slice(0, 200);
  if (!t) return;
  if (isShabbat(S.t)) return toast('📵 שבת — לא משתמשים בטלפון', 'red');
  postMsg(ui.chatG, S.name, t, { me: true });
  reply(ui.chatG, t);
  save();
};
window.initChat = initChat;
