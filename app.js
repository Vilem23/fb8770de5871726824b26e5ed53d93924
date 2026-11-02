(() => {
'use strict';

/* ------------------------------------------------------------------ data */
const DEFAULT_USER = { first: 'Vilém', last: 'Částka', email: 'vilemcastka34@gmail.com', dob: '2008-12-05', notifReceipt: true, notifBonus: true };

/* MHD Zlín, linka 32 – trasa A (jízdní řád DSZO platný od 1. 9. 2026).
   Okružní trasa z Kudlova; číslo = minuty jízdy od zastávky Kudlov, točna. */
const LOOP_MIN = 32;
const ROUTE = [
  ['Kudlov točna', 0], ['Kudlov u pomníku padlých', 2], ['Kudlov Výhledy', 3], ['Kudlov střed', 4],
  ['Kudlov dolní konec', 5], ['Hradská', 7], ['Zimní lázně', 7], ['Školní', 10], ['Náměstí Míru', 13],
  ['Náměstí Práce', 13], ['Zimní stadion-Trinity Bank', 16], ['U Majáku křižovatka', 19], ['U Majáku točna', 20],
  ['Ke Křibům', 21], ['Lesní hřbitov', 23], ['Filmové ateliéry Fabiánka', 24], ['Filmové ateliéry točna', 26],
  ['Filmové ateliéry Fabiánka', 26.5], ['Kudlov tiskárna', 29], ['Kudlov u pomníku padlých', 30],
];
const STOPS = [...new Set(ROUTE.map(r => r[0]))].map(n => ['Zlín, ' + n, 'Zlínský kraj']);
const stopIdx = name => STOPS.findIndex(s => s[0] === name);
const HOME_STOP = stopIdx('Zlín, Filmové ateliéry točna');

/* Where the bus is after `sec` seconds when boarding at STOPS[from]. */
function routeStopAfter(from, sec) {
  const name = STOPS[from][0].slice(6);
  const p0 = ROUTE.findIndex(r => r[0] === name), t0 = ROUTE[p0][1], min = sec / 60;
  let best = p0;
  for (let k = 1; k < ROUTE.length * 4; k++) {
    const p = (p0 + k) % ROUTE.length, lap = Math.floor((p0 + k) / ROUTE.length);
    if (ROUTE[p][1] + lap * LOOP_MIN - t0 > min) break;
    best = p;
  }
  return stopIdx('Zlín, ' + ROUTE[best][0]);
}

/* A transport day ends at 3:00, so tickets and daily caps run until then. */
const validTo = start => { const d = new Date(start); const t = new Date(d); t.setHours(3, 0, 0, 0); if (d.getHours() >= 3) t.setDate(t.getDate() + 1); return t.getTime(); };
const fareLabel = (dob, ms) => ageAt(dob, ms) < 18 ? 'Dětské jízdné' : 'Obyčejné jízdné';

/* Fare: single ride in MHD Zlín–Otrokovice, children's fare under 18, capped per transport day. */
const ageAt = (iso, ms) => { if (!iso) return 30; const [y, m, d] = iso.split('-').map(Number), t = new Date(ms); return t.getFullYear() - y - ((t.getMonth() + 1 < m || (t.getMonth() + 1 === m && t.getDate() < d)) ? 1 : 0); };
function fare(start, end, dob, history) {
  const min = (end - start) / 6e4, age = ageAt(dob, start);
  if (min < 2) return { price: 0, tariff: 'Nezpoplatněno (jízda kratší než 2 min)' };
  if (age < 6) return { price: 0, tariff: 'Dítě do 6 let – zdarma' };
  const reduced = age < 18, k = reduced ? 0.5 : 1;
  const single = (min <= 45 ? 20 : 28) * k, cap = 70 * k;
  const day = validTo(start), spent = history.filter(h => validTo(h.start) === day).reduce((a, h) => a + h.price, 0);
  const price = Math.max(0, Math.min(single, cap - spent));
  return { price, tariff: fareLabel(dob, start) + (price < single ? ' · denní strop' : '') };
}

const VALIDITY = 'Platí ve vlacích i regionálních autobusech v tarifních zónách IDZK a v MHD Zlín–Otrokovice, Kroměříž, Uherské Hradiště a Vsetín.';

/* ----------------------------------------------------------------- state */
const KEY = 'fairtiq.cz.v2';
function seedHistory() {
  const now = Date.now(), day = 864e5, out = [];
  // [days ago, start hour, boarding stop, ride minutes]
  const spec = [[1, 7.3, 'Filmové ateliéry točna', 19], [1, 14.4, 'Náměstí Práce', 13], [3, 7.3, 'Filmové ateliéry točna', 19], [3, 15.1, 'Školní', 16],
    [6, 7.3, 'Filmové ateliéry točna', 19], [8, 17.3, 'Náměstí Míru', 13], [10, 7.35, 'Filmové ateliéry točna', 20], [14, 12.2, 'Kudlov točna', 13]];
  for (const [d, h, from, min] of spec) {
    const t = new Date(now - d * day); t.setHours(Math.floor(h), Math.round((h % 1) * 60), 20, 0);
    const start = t.getTime(), end = start + min * 6e4 + 25e3, fi = stopIdx('Zlín, ' + from);
    const prev = out.slice();
    out.push({ id: 'H' + d + Math.round(h * 10), start, end, from: STOPS[fi][0], to: STOPS[routeStopAfter(fi, (end - start) / 1000)][0], evaluated: true, evalAt: end + 9e5, ...fare(start, end, DEFAULT_USER.dob, prev) });
  }
  return out.sort((a, b) => b.start - a.start);
}
const fresh = () => ({
  user: { ...DEFAULT_USER }, onboarded: true, stop: HOME_STOP, ride: null, history: seedHistory(),
  notifsRead: false, lastSeen: 0,
});
let S;
try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
if (!S || typeof S !== 'object' || !('user' in S)) S = fresh();
S.credit ??= 0; S.smartStop ??= true; S.companions ??= [];
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
save(); // keep the seeded history stable across reloads

/* --------------------------------------------------------------- helpers */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const p2 = n => String(n).padStart(2, '0');
const fmtDT = ms => { const d = new Date(ms); return `${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
const fmtD = ms => { const d = new Date(ms); return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`; };
const fmtHM = ms => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const fmtClock = ms => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
const fmtDur = s => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? p2(h) + ':' : '') + p2(m) + ':' + p2(x); };
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dobFmt = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${+d}. ${+m}. ${y}`; };
const dobInput = iso => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const parseDob = v => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v); if (!m) return null;
  const d = +m[1], mo = +m[2], y = +m[3], dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d || dt > new Date() || y < 1900) return null;
  return `${y}-${m[2]}-${m[1]}`;
};
const rid =() => Array.from({ length: 12 }, () => '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 34 | 0]).join('');
const initials = u => ((u.first || '')[0] || '') + ((u.last || '')[0] || '');

/* ----------------------------------------------------------------- icons */
const IC = {
  paxIcon: `<svg width="26" height="26" viewBox="0 0 24 24" fill="#555"><circle cx="12" cy="7.5" r="4.3"/><path d="M3.5 21c.4-4.8 3.700-7.300 8.500-7.300s8.100 2.500 8.500 7.300z"/></svg>`,
  coins: `<svg width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="15" fill="#17a882"/><g fill="none" stroke="#fff" stroke-width="1.7"><ellipse cx="12.5" cy="9.5" rx="5" ry="2"/><path d="M7.5 9.5v8.5c0 1.1 2.2 2 5 2M7.5 12.3c0 1.1 2.2 2 5 2s5-.9 5-2M7.5 15.2c0 1.1 2.2 2 5 2M17.5 9.5v3"/><circle cx="19" cy="18" r="4.6" fill="#17a882"/></g></svg>`,
  giftPlus: `<svg width="34" height="30" viewBox="0 0 34 30" fill="#111"><rect x="1" y="11" width="22" height="5" rx="1"/><rect x="2.5" y="17.5" width="19" height="11" rx="1"/><path d="M12 11c-3 0-6.5-1-6-3.5s4-2 6 3.5zm0 0c3 0 6.5-1 6-3.5s-4-2-6 3.5z" fill="none" stroke="#111" stroke-width="1.8"/><path d="M27 1v10M22 6h10" stroke="#111" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  plus: `<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#2b2b2b" stroke-width="2.4" stroke-linecap="round"><path d="M12 4v16M4 12h16"/></svg>`,
  chevR: (c = '#9a9da5', s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>`,
  chevL: (c = '#fff', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>`,
  chevD: (c = '#fff', s = 26) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l7 7 7-7"/></svg>`,
  travel: `<svg width="34" height="26" viewBox="0 0 34 26"><rect x="1" y="2" width="32" height="22" rx="11" fill="#111"/><circle cx="12" cy="13" r="7.5" fill="#fff"/><path d="M10.2 9.6l3.8 3.4-3.8 3.4" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="26" cy="13" r="3" fill="#fff" opacity=".0"/></svg>`,
  gift: `<svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="#111" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="11" width="23" height="15" rx="2"/><path d="M2.5 8.5h25v3h-25zM15 8.5v17.5M15 8.5C12 8.5 8.5 7.5 9 5s4-2.2 6 3.5M15 8.5c3 0 6.500-1 6-3.500s-4-2.200-6 3.500"/></svg>`,
  user: `<svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="#111" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="15" cy="9" r="5"/><path d="M5 26c.5-5.500 4-8 10-8s9.500 2.500 10 8z"/></svg>`,
  bell: `<svg width="34" height="34" viewBox="0 0 34 34"><path fill="#5c0b1c" d="M17 3.500c-.9 0-1.600.7-1.600 1.600v.7C11.300 6.800 9 10 9 14.300v4.500l-2.500 4.200c-.4.700.1 1.600.9 1.600h19.200c.8 0 1.300-.9.900-1.600L25 18.800v-4.500c0-4.300-2.300-7.500-6.400-8.500v-.7c0-.9-.7-1.600-1.600-1.600zM13.200 26.500c.5 1.900 2 3 3.800 3s3.300-1.100 3.800-3z" transform="translate(-1 0)"/><circle cx="26" cy="9" r="5.500" fill="#5c0b1c" stroke="#ffa6c2" stroke-width="2"/></svg>`,
  people: `<svg width="34" height="30" viewBox="0 0 34 30" fill="#e21a34"><circle cx="12" cy="8" r="5.500"/><circle cx="24.500" cy="9.500" r="4.500"/><path d="M1.500 25c0-5.200 4.200-8.500 10.500-8.500S22.500 19.800 22.500 25c0 1.100-.7 1.800-1.800 1.800H3.300c-1.100 0-1.800-.7-1.800-1.800z"/><path d="M24.500 15.500c4.500 0 8 2.500 8 6.800 0 1.100-.7 1.800-1.800 1.800H25c.4-.6.600-1.300.6-2.100 0-2.700-.9-4.700-2.500-6.100.4-.3.900-.4 1.400-.4z"/></svg>`,
  sparkle: `<svg class="sparkle" viewBox="0 0 48 40" fill="none" stroke="#1d1d1f" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="15.5" width="43" height="22" rx="11" stroke-width="3.6"/><circle cx="34.500" cy="26.500" r="7.200" fill="#1d1d1f" stroke="none"/><path d="M15 22l-4.200 4.500 4.200 4.500" stroke-width="3.200"/><path d="M34.500 2.500v6M26 5l2.600 4.600M43 5l-2.600 4.600" stroke-width="3.200"/></svg>`,
  cal: `<svg width="30" height="30" viewBox="0 0 30 30" fill="none" stroke="#2b2b2b" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="24" height="21" rx="2.500"/><path d="M3 12h24M9 2.500v6M21 2.500v6"/><path d="M8 18h1.500M14.300 18h1.500M20.500 18h1.500" stroke-width="2.800"/></svg>`,
  pin: (c = '#e21a34') => `<svg width="22" height="22" viewBox="0 0 24 24" fill="${c}"><path d="M12 2C7.600 2 4.500 5.200 4.500 9.300c0 5.300 7.500 12.700 7.500 12.700s7.500-7.400 7.500-12.700C19.500 5.200 16.400 2 12 2zm0 10a3 3 0 110-6 3 3 0 010 6z"/></svg>`,
  search: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#7d8088" stroke-width="2.4" stroke-linecap="round"><circle cx="10.500" cy="10.500" r="6.500"/><path d="M15.500 15.500L21 21"/></svg>`,
  check: `<svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.500l4.500 4.500L19 7.500"/></svg>`,
  ride: (c = '#e21a34') => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.500" y="3.500" width="17" height="14" rx="3"/><path d="M3.500 11h17M7 20.500l1.500-3M17 20.500l-1.500-3"/><circle cx="7.500" cy="14.200" r=".6" fill="${c}"/><circle cx="16.500" cy="14.200" r=".6" fill="${c}"/></svg>`,
  person: (c = '#e21a34') => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c.5-4.500 3.500-6.500 8-6.500s7.500 2 8 6.500z"/></svg>`,
  card: (c = '#e21a34') => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.500" y="5" width="19" height="14" rx="2.500"/><path d="M2.500 10h19M6 15h4"/></svg>`,
  bellS: (c = '#e21a34') => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 17V11a6 6 0 1112 0v6l1.500 2h-15zM10 21.500a2 2 0 004 0"/></svg>`,
  globe: (c = '#e21a34') => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>`,
  help: (c = '#e21a34') => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.500 9.500a2.600 2.600 0 115 .8c0 1.700-2.500 2.200-2.500 3.700M12 17.200v.2"/></svg>`,
  doc: (c = '#e21a34') => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2.500h8l4.500 4.500v14.500H6zM14 2.500V7h4.500M9 12h6M9 16h6"/></svg>`,
  info: (c = '#e21a34') => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.500v.2"/></svg>`,
  out: (c = '#e21a34') => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4H5.500A1.500 1.500 0 004 5.500v13A1.500 1.500 0 005.500 20H10M15 8l4 4-4 4M19 12H9"/></svg>`,
  coffee: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#148667" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h12v5a5 5 0 01-5 5H9a5 5 0 01-5-5zM16 10h2a2.500 2.500 0 010 5h-2M7 3v3M11 3v3"/></svg>`,
  pct: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#148667" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.500"/><circle cx="17" cy="17" r="2.500"/></svg>`,
  star: `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#148667" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.700 5.600 6.100.8-4.500 4.200 1.100 6.100L12 16.800 6.600 19.700l1.100-6.100L3.200 9.400l6.100-.8z"/></svg>`,
};
const Switch = (id, on) => `<button class="sw ${on ? 'on' : ''}" id="${id}" role="switch" aria-checked="${!!on}"></button>`;
const bindSwitch = (el, cb) => el && el.addEventListener('click', () => { const on = !el.classList.contains('on'); el.classList.toggle('on', on); el.setAttribute('aria-checked', on); cb && cb(on); });
const hdr = (title, back) => `<div class="hdr">${back ? `<button class="circ l" data-back aria-label="Zpět">${IC.chevL('#2b0a14', 26)}</button>` : ''}<h1>${esc(title)}</h1></div>`;
const bar = () => `<div class="hdr"><img class="logo" src="assets/logo.png" alt="FAIRTIQ"><button class="circ r" id="bellbtn" aria-label="Oznámení">${IC.bell}${unread() ? '<i class="dot"></i>' : ''}</button></div>`;

/* ------------------------------------------------------- overlay helpers */
const overlay = $('#overlay');
function closeOverlay() { overlay.innerHTML = ''; overlay.style.pointerEvents = 'none'; }
function sheet(html, bind) {
  overlay.style.pointerEvents = 'auto';
  overlay.innerHTML = `<div class="scrim"></div><div class="sheet"><div class="grab"></div>${html}</div>`;
  const sc = $('.scrim', overlay), sh = $('.sheet', overlay);
  requestAnimationFrame(() => { sc.classList.add('on'); sh.classList.add('on'); });
  const close = () => { sc.classList.remove('on'); sh.classList.remove('on'); setTimeout(closeOverlay, 260); };
  sc.onclick = close; $$('[data-close]', sh).forEach(b => b.onclick = close);
  bind && bind(sh, close);
}
function dialog(title, text, okLabel, onOk, cancelLabel = 'Zrušit') {
  overlay.style.pointerEvents = 'auto';
  overlay.innerHTML = `<div class="scrim"></div><div class="dialog"><h2>${esc(title)}</h2><p>${text}</p><div class="row"><button data-x>${cancelLabel}</button><button class="pri" data-ok>${okLabel}</button></div></div>`;
  const sc = $('.scrim', overlay), dl = $('.dialog', overlay);
  requestAnimationFrame(() => { sc.classList.add('on'); dl.classList.add('on'); });
  const close = () => { sc.classList.remove('on'); dl.classList.remove('on'); setTimeout(closeOverlay, 220); };
  sc.onclick = close; $('[data-x]', dl).onclick = close; $('[data-ok]', dl).onclick = () => { close(); onOk && onOk(); };
}
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), 2200); }

/* ---------------------------------------------------------------- router */
const stack = [];
let tickFn = null;
const screenEl = $('#screen');
function render(name, params = {}, anim = '') {
  tickFn = null; closeOverlay();
  const root = document.createElement('div');
  root.className = 'scr ' + anim;
  screenEl.innerHTML = ''; screenEl.appendChild(root);
  (SCREENS[name] || SCREENS.main)(root, params);
  $$('[data-back]', root).forEach(b => b.onclick = back);
  if (NAVTAB[name]) addNav(root, NAVTAB[name]);
}
/* sub-pages that keep the floating tab bar, like the original app */
const NAVTAB = { ticket: 'travel', thanks: 'travel', promo: 'rewards', credithist: 'rewards', smartstop: 'travel', rides: 'profile', payment: 'profile', notifset: 'profile', language: 'profile', help: 'profile', legal: 'profile', about: 'profile' };
const navHTML = (on = '') => `<nav class="nav">
  <button data-t="travel" class="${on === 'travel' ? 'on' : ''}">${IC.travel}<span>Cestovat</span></button>
  <button data-t="rewards" class="${on === 'rewards' ? 'on' : ''}">${IC.gift}<span>Odměny</span></button>
  <button data-t="profile" class="${on === 'profile' ? 'on' : ''}">${IC.user}<span>Profil</span></button></nav>`;
function addNav(root, tab) {
  root.classList.add('hasnav');
  root.insertAdjacentHTML('beforeend', navHTML(tab));
  $$('.nav button', root).forEach(b => b.onclick = () => go('main', { tab: b.dataset.t }, { reset: true, anim: 'fade' }));
}
function go(name, params = {}, opt = {}) {
  if (opt.reset) stack.length = 0;
  else if (opt.replace) stack.pop();
  stack.push({ name, params });
  render(name, params, opt.anim ?? (opt.reset ? 'fade' : ''));
}
function back() {
  if (stack.length < 2) return;
  stack.pop(); const t = stack[stack.length - 1];
  render(t.name, t.params, 'back');
}

/* ---------------------------------------------------------------- screens */
const unread = () => !S.notifsRead;
const curStop = () => STOPS[S.stop] || STOPS[0];

const SCREENS = {};

/* splash */
SCREENS.splash = root => {
  root.className = 'scr splash';
  root.innerHTML = `<div class="lg"><img class="logo" src="assets/logo.png" alt="FAIRTIQ"><img class="tag" src="assets/tagline.png" alt="Public transport made easy."></div>`;
  setTimeout(() => {
    if (stack[stack.length - 1]?.name !== 'splash') return;
    go(S.user ? 'main' : 'onboarding', { tab: 'travel' }, { reset: true, anim: 'fade' });
  }, 1500);
};

/* onboarding */
SCREENS.onboarding = root => {
  root.className = 'scr ob fade';
  root.innerHTML = `
    <div class="top"><img class="logo" src="assets/logo.png" alt="FAIRTIQ"><img class="tag" src="assets/tagline.png" alt=""></div>
    <div class="ill"><div><img src="assets/ob1.png" alt=""></div><div><img src="assets/ob2.png" alt=""></div><div><img src="assets/ob3.png" alt=""></div></div>
    <div class="btnrow"><button class="btn-white" id="cont">Pokračovat</button>
    <button class="more" id="more">Více informací${IC.chevD('#fff', 26)}</button></div>`;
  $('#cont', root).onclick = () => go('account', { mode: 'register' });
  $('#more', root).onclick = () => sheet(`
    <h2>Jak FAIRTIQ funguje</h2><p>Žádné lístky, žádné zóny, žádné počítání. Stačí swipnout a jet.</p>
    <div class="step"><i>1</i><div><b>Swipněte na začátku cesty</b><span>Jakmile nastoupíte, přejeďte posuvníkem doprava a jízda začne.</span></div></div>
    <div class="step"><i>2</i><div><b>Jeďte, jak potřebujete</b><span>Přestupujte mezi vlaky, autobusy i MHD. FAIRTIQ vše zaznamená.</span></div></div>
    <div class="step"><i>3</i><div><b>Na konci swipněte zpět</b><span>Cenu spočítáme automaticky a účtenku pošleme e-mailem.</span></div></div>
    <button class="btn-red" data-close>Rozumím</button>`);
};

/* account (register / edit) */
SCREENS.account = (root, { mode = 'register' } = {}) => {
  const edit = mode === 'edit';
  const u = S.user || DEFAULT_USER;
  let receipt = u.notifReceipt !== false, bonus = u.notifBonus !== false, consent = edit;
  root.innerHTML = `
    ${hdr('Účet', edit)}
    <div class="scroll" id="sc">
      <div class="form">
        <label class="l" for="f1">Jméno</label><input class="inp" id="f1" placeholder="Jméno" autocomplete="given-name" value="${esc(u.first)}">
        <label class="l" for="f2">Příjmení</label><input class="inp" id="f2" placeholder="Příjmení" autocomplete="family-name" value="${esc(u.last)}">
        <label class="l" for="f3">Email</label><input class="inp" id="f3" type="email" inputmode="email" placeholder="Email" autocomplete="email" value="${esc(u.email)}">
        <p class="help">Váš email použijeme pro zasílání účtenek, nabídek FAIRTIQu a relevantní komunikaci. Vždy budete mít možnost se zdarma odhlásit z odběru odkazem v zápatí emailů nebo odesláním zprávy na <a href="mailto:hello@fairtiq.com">hello@fairtiq.com</a>.</p>
        <label class="l" for="f4" style="margin-top:34px">Datum narození</label>
        <div class="dob"><input class="inp" id="f4" inputmode="numeric" placeholder="dd/mm/rrrr" maxlength="10" value="${dobInput(u.dob)}"><button id="calb" aria-label="Kalendář">${IC.cal}</button><input type="date" id="f4d" tabindex="-1"></div>
        <p class="help" style="margin-bottom:6px">Zadaný věk zohledňujeme při výpočtu ceny jízdného. Při přepravné kontrole vás dopravce může vyzvat k doložení věku platným průkazem s fotografií.</p>
      </div>
      <div style="height:38px"></div>
      <div class="sec first">Oznámení</div>
      <div class="cell"><div><div class="t">Účtenka</div><div class="s">emailem</div></div>${Switch('swR', receipt)}</div>
      <div class="cell"><div class="t">Informujte mě, jakmile získám bonus</div>${Switch('swB', bonus)}</div>
      <div class="grey"><p>Zjistěte více o <a href="#" id="bl">bonusovém programu FAIRTIQ</a>.</p></div>
      ${edit ? '' : `
      <div class="sec">Právní informace</div>
      <div class="cell"><div class="t">Souhlasím s omezením nároku práva na odstoupení od kupní smlouvy</div>${Switch('swC', false)}</div>
      <div class="grey"><p>Zjistěte více o právu na odstoupení od kupní smlouvy.</p>
      <p class="big">Vytvořením tohoto účtu souhlasím s všeobecnými obchodními podmínkami.</p>
      <p class="big n">Osobní údaje zpracováváme v souladu s <a href="#" id="pl">prohlášením o ochraně osobních údajů</a>.</p></div>`}
      <div class="pad-btn"><button class="btn-red dis" id="go">${edit ? 'Uložit' : 'Pokračovat'}</button></div>
    </div>`;
  const f = id => $(id, root), btn = f('#go');
  const check = () => {
    const ok = f('#f1').value.trim() && f('#f2').value.trim() && /^\S+@\S+\.\S+$/.test(f('#f3').value.trim()) && parseDob(f('#f4').value) && consent;
    btn.classList.toggle('dis', !ok);
  };
  bindSwitch(f('#swR'), v => receipt = v); bindSwitch(f('#swB'), v => bonus = v);
  if (!edit) bindSwitch(f('#swC'), v => { consent = v; check(); });
  $$('input', root).forEach(i => i.addEventListener('input', check));
  f('#f4').addEventListener('input', e => {
    let d = e.target.value.replace(/\D/g, '').slice(0, 8), o = d.slice(0, 2);
    if (d.length > 2) o += '/' + d.slice(2, 4); if (d.length > 4) o += '/' + d.slice(4);
    e.target.value = o; check();
  });
  f('#calb').onclick = () => { const d = f('#f4d'); try { d.showPicker(); } catch (e) { d.focus(); } };
  f('#f4d').onchange = e => { if (e.target.value) { f('#f4').value = dobInput(e.target.value); check(); } };
  const bl = f('#bl'); bl && (bl.onclick = e => { e.preventDefault(); bonusInfo(); });
  const pl = f('#pl'); pl && (pl.onclick = e => { e.preventDefault(); go('legal', { kind: 'privacy' }); });
  btn.onclick = () => {
    if (btn.classList.contains('dis')) {
      const miss = [['#f1', f('#f1').value.trim()], ['#f2', f('#f2').value.trim()], ['#f3', /^\S+@\S+\.\S+$/.test(f('#f3').value)], ['#f4', parseDob(f('#f4').value)]];
      miss.forEach(([id, ok]) => f(id).classList.toggle('err', !ok));
      toast(consent ? 'Vyplňte prosím všechna pole' : 'Potvrďte prosím právní informace');
      return;
    }
    S.user = { first: f('#f1').value.trim(), last: f('#f2').value.trim(), email: f('#f3').value.trim(), dob: parseDob(f('#f4').value), notifReceipt: receipt, notifBonus: bonus };
    S.onboarded = true; save();
    if (edit) { toast('Změny uloženy'); back(); } else go('main', { tab: 'travel' }, { reset: true, anim: 'fade' });
  };
  check();
};

function bonusInfo() {
  sheet(`<h2>Bonusový program FAIRTIQ</h2><p>Za každou dokončenou jízdu získáváte body. Se sbíráním bodů odemykáte slevy a výhody od našich partnerů.</p><p>Stav bodů najdete v záložce <b>Odměny</b>.</p><button class="btn-red" data-close>Zavřít</button>`);
}

/* main (tabs) */
SCREENS.main = (root, params) => {
  params.tab = params.tab || 'travel';
  root.className = 'scr main';
  root.innerHTML = `<div id="mh"></div><div class="body" id="mb"></div>${navHTML()}`;
  const mh = $('#mh', root), mb = $('#mb', root);
  const draw = () => {
    tickFn = null;
    $$('.nav button', root).forEach(b => b.classList.toggle('on', b.dataset.t === params.tab));
    if (params.tab === 'travel') { mh.innerHTML = bar(); Travel(mb, mh); }
    else if (params.tab === 'rewards') {
      mh.innerHTML = `<div class="hdr"><h1>Odměny</h1><button class="join" id="join">Připojit se</button></div>`;
      $('#join', mh).onclick = () => go('promo');
      Rewards(mb);
    }
    else { mh.innerHTML = hdr('Profil'); Profile(mb); }
    const bb = $('#bellbtn', mh); bb && (bb.onclick = () => go('notifs'));
  };
  $$('.nav button', root).forEach(b => b.onclick = () => { if (params.tab !== b.dataset.t) { params.tab = b.dataset.t; draw(); } });
  draw();
};

/* travel tab */
function Travel(mb, mh) {
  const ride = S.ride, stop = curStop();
  mb.innerHTML = `
    <div class="hello">${esc(S.user.first)}</div>
    <div class="hero">${ride
      ? `<div class="tk"><img src="assets/ticket-eye.png" alt=""><button class="pill-dark" id="showtk">Zobrazit jízdenku</button></div>`
      : `<img class="zl" src="assets/zlin.png" alt=""><button class="grp" id="grp" aria-label="Skupina">${IC.people}</button>`}</div>
    <div class="loc">
      <div class="nm"><h2>${esc(stop[0])}</h2>${ride ? '' : '<button class="chg" id="chg">Změnit</button>'}</div>
      <div class="rg">${esc(stop[1])}</div>
      <button class="info-ic" id="inf" aria-label="Jak to funguje">${IC.sparkle}</button>
    </div>
    <div class="slider ${ride ? 'run' : ''}" id="sl">
      ${ride ? `<div class="tm" id="tm">${fmtDur((Date.now() - ride.start) / 1000)}</div>` : `<div class="lbl"><b>Začněte<br>swipnutím</b><span>Podléhá zpoplatnění</span></div>`}
      <div class="knob" id="kn">${IC[ride ? 'chevL' : 'chevR']('#fff', 40)}</div>
    </div>`;
  const chg = $('#chg', mb); chg && (chg.onclick = () => go('stops'));
  const grp = $('#grp', mb); grp && (grp.onclick = () => go('companions', {}, { anim: 'up' }));
  const st = $('#showtk', mb); st && (st.onclick = () => go('ticket'));
  $('#inf', mb).onclick = () => go('smartstop');
  const sl = $('#sl', mb), kn = $('#kn', mb);
  if (ride) tickFn = () => { const t = $('#tm'); t && (t.textContent = fmtDur((Date.now() - S.ride.start) / 1000)); };
  /* swipe */
  let sx = 0, dx = 0, drag = false;
  const lbl = $('.lbl', sl);
  const maxX = () => ride ? sl.clientWidth - 14 - 82 : sl.clientWidth - 14 - 85;
  kn.addEventListener('pointerdown', e => { drag = true; sx = e.clientX; dx = 0; try { kn.setPointerCapture(e.pointerId); } catch (_) {} sl.classList.add('drag'); kn.style.transition = 'none'; });
  kn.addEventListener('pointermove', e => {
    if (!drag) return;
    const m = maxX(); dx = ride ? Math.max(-m, Math.min(0, e.clientX - sx)) : Math.max(0, Math.min(m, e.clientX - sx));
    kn.style.transform = `translateX(${dx}px)`;
    if (lbl) lbl.style.opacity = 1 - Math.abs(dx) / m * 1.3;
  });
  const end = () => {
    if (!drag) return; drag = false; sl.classList.remove('drag'); kn.style.transition = '';
    const m = maxX();
    if (Math.abs(dx) > m * 0.7) { kn.style.transform = `translateX(${ride ? -m : m}px)`; navigator.vibrate && navigator.vibrate(30); setTimeout(() => (ride ? stopRide() : startRide()), 160); }
    else { kn.style.transform = ''; if (lbl) lbl.style.opacity = 1; }
  };
  kn.addEventListener('pointerup', end); kn.addEventListener('pointercancel', end);
  kn.addEventListener('keydown', e => { if (e.key === 'Enter') (ride ? stopRide : startRide)(); });
  kn.tabIndex = 0;
}

function startRide() {
  const now = Date.now();
  S.ride = { id: rid(), start: now, from: S.stop, validTo: validTo(now) }; save();
  go('main', { tab: 'travel' }, { replace: true, anim: 'fade' });
}
function stopRide(auto) {
  const r = S.ride; if (!r) return;
  const end = Math.min(Date.now(), r.validTo), sec = (end - r.start) / 1000;
  const toIdx = routeStopAfter(r.from, sec);
  // like the real app, the price arrives a little later as a notification
  const rec = { id: r.id, start: r.start, end, from: STOPS[r.from][0], to: STOPS[toIdx][0], auto: !!auto, evaluated: false, evalAt: Date.now() + 12e3, ...fare(r.start, end, S.user.dob, S.history) };
  S.history.unshift(rec); S.ride = null; S.stop = toIdx; S.lastSeen = 0; save();
  go('thanks', { rec }, { reset: true, anim: 'fade' });
}
function evaluateRides() {
  const due = S.history.filter(h => !h.evaluated && Date.now() >= h.evalAt);
  if (!due.length) return;
  due.forEach(h => h.evaluated = true);
  S.notifsRead = false; save();
  const h = due[0];
  toast(`Jízda vyhodnocena: ${fmtKc(h.price)} Kč`);
  const bb = $('#bellbtn'); bb && !$('.dot', bb) && bb.insertAdjacentHTML('beforeend', '<i class="dot"></i>');
}

/* ticket colours change every day, as in the real app (26. 10. 2026 = first palette) */
const PALETTES = [
  { bg: '#fbfbfb', wave: '#e9e9ec', band: 'linear-gradient(90deg,#f04a55,#d24bb0 50%,#f04a55)', amber: '#f0b935' },
  { bg: '#f4f8fd', wave: '#dde7f3', band: 'linear-gradient(90deg,#3b8fd9,#6b5bd6 50%,#3b8fd9)', amber: '#eaa53a' },
  { bg: '#f3fbf8', wave: '#d9eee6', band: 'linear-gradient(90deg,#24a587,#3b8fd2 50%,#24a587)', amber: '#efc23a' },
  { bg: '#fff8f2', wave: '#f2e1d3', band: 'linear-gradient(90deg,#f07a3c,#e04a6a 50%,#f07a3c)', amber: '#e8b02e' },
  { bg: '#fff6f4', wave: '#f1dcdf', band: 'linear-gradient(90deg,#d94a4f,#d03e6b 55%,#c53585)', amber: '#e9a62f' },
];
function paletteFor(ms) {
  const day = d => Math.floor((d - new Date(d).getTimezoneOffset() * 6e4) / 864e5);
  const ref = day(new Date(2026, 9, 26, 12).getTime()), t = new Date(validTo(ms) - 864e5 / 2).getTime();
  return PALETTES[(((day(t) - ref) % PALETTES.length) + PALETTES.length) % PALETTES.length];
}
const wavesBg = c => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='120' height='60'><g fill='none' stroke='${c}' stroke-width='1.6'><path d='M-10 12c20-18 40 14 60-2s40 10 80-4'/><path d='M-10 30c20-18 40 14 60-2s40 10 80-4'/><path d='M-10 48c20-18 40 14 60-2s40 10 80-4'/></g></svg>`)}")`;
const VALIDITY_LONG = 'Platí ve vlacích a regionálních autobusech v síti tarifních zón systému Integrovaná doprava Zlínského kraje (IDZK), ve všech městských autobusech a trolejbusech MHD Zlín–Otrokovice (dopravce DSZO), MHD Kroměříž, MHD Uherské Hradiště a MHD Vsetín.';
const NOT_VALID = ['ve vlacích EuroCity linky Ex4 v úseku mezi Otrokovicemi a Starým Městem u Uherského Hradiště', 'v úsecích autobusových linek IDZK mimo tarifní zóny IDZK (tj. obvykle úseky vně hranic Zlínského kraje, např. u linek z/do Brna nebo Ostravy)', 'v komerčních dálkových autobusech', 'v tarifních zónách ODIS ani v případech, že jsou nabízeny v prodejních kanálech Zlínského kraje (zóny 57, 69, 70, 89)'];

/* ticket */
SCREENS.ticket = root => {
  const r = S.ride;
  if (!r) { go('main', { tab: 'travel' }, { reset: true }); return; }
  const stop = STOPS[r.from], pal = paletteFor(r.start), u = S.user;
  const [y, m, d] = (u.dob || '').split('-');
  root.className = 'scr tkt';
  root.style.setProperty('--tk-bg', pal.bg); root.style.setProperty('--tk-waves', wavesBg(pal.wave));
  root.style.setProperty('--tk-band', pal.band); root.style.setProperty('--tk-amber', pal.amber);
  root.innerHTML = `${hdr('Jízdenka', true)}
    <div class="scroll"><div class="code"><canvas id="aztec"></canvas></div>
      <div class="clock" id="clk">${fmtClock(Date.now())}</div>
      <div class="amber"><div class="k">Platnost</div><div class="v">${VALIDITY}</div>
        <div class="two"><div><div class="k">Od</div><div class="v">${fmtDT(r.start)}</div></div><div><div class="k">Do</div><div class="v">${fmtDT(r.validTo)}</div></div></div></div>
      <div class="info">
        <div class="k">Od</div><div class="v">${esc(stop[0])}</div>
        <div class="pax">${IC.paxIcon}<div><b>${esc(u.first)} ${esc(u.last)}</b><span>${d}.${m}.${y} · ${fareLabel(u.dob, r.start)}</span></div></div>
        <p class="vt">${VALIDITY_LONG}</p>
        <p class="vt">Neplatí:<br>${NOT_VALID.map(t => '- ' + t).join('<br>')}</p>
        <p class="demo">Ukázková aplikace – kód není platný doklad o přepravě.</p>
      </div>
    </div>`;
  try {
    bwipjs.toCanvas($('#aztec', root), { bcid: 'azteccode', text: `FAIRTIQ-DEMO|NEPLATNA JIZDENKA - UKAZKOVA APLIKACE|${r.id}|${r.start}|${r.validTo}|` + btoa(`${r.id}:${r.start}:demo`).repeat(5), eclevel: 33, scale: 5, backgroundcolor: pal.bg.slice(1), barcolor: '000000', padding: 6 });
  } catch (e) { $('#aztec', root).replaceWith(Object.assign(document.createElement('div'), { textContent: 'Kód nelze zobrazit' })); }
  tickFn = () => { const c = $('#clk'); c && (c.textContent = fmtClock(Date.now())); };
};

/* stops */
SCREENS.stops = root => {
  root.innerHTML = `${hdr('Změnit zastávku', true)}
    <div class="search"><div class="dob"><input class="inp" id="q" placeholder="Hledat zastávku…" style="padding-left:48px"><span style="position:absolute;left:14px;top:14px">${IC.search}</span></div></div>
    <div class="scroll list" id="ls"></div>`;
  const ls = $('#ls', root);
  const draw = q => {
    const n = norm(q || '');
    const items = STOPS.map((s, i) => [s, i]).filter(([s]) => norm(s[0]).includes(n));
    ls.innerHTML = items.length ? items.map(([s, i]) => `<button class="row" data-i="${i}"><div class="stop-i">${IC.pin(i === S.stop ? '#17a882' : '#e21a34')}</div><div class="tx"><b>${esc(s[0])}</b><span>${esc(s[1])}${i === S.stop ? ' · aktuální' : ''}</span></div>${IC.chevR()}</button>`).join('') : '<div class="empty">Zastávka nenalezena</div>';
    $$('.row', ls).forEach(b => b.onclick = () => { S.stop = +b.dataset.i; save(); back(); });
  };
  $('#q', root).oninput = e => draw(e.target.value); draw('');
};

/* notifications */
SCREENS.notifs = root => {
  S.notifsRead = true; save();
  const items = S.history.filter(h => h.evaluated).slice(0, 8).map(h => ['Jízda vyhodnocena',
    `${esc(h.from)} → ${esc(h.to)}: ${fmtKc(h.price)} Kč (${esc(h.tariff)}).${S.user.notifReceipt ? ' Účtenku jsme poslali na ' + esc(S.user.email) + '.' : ''}`, fmtD(h.evalAt)]);
  items.push(['Vítejte ve FAIRTIQ, ' + esc(S.user.first) + '!', 'Stačí swipnout a jet. O zbytek se postaráme.', fmtD(Date.now() - 21 * 864e5)]);
  root.innerHTML = `${hdr('Oznámení', true)}<div class="scroll list">${items.map(i => `<div class="row"><div class="ico">${IC.bellS()}</div><div class="tx"><b>${i[0]}</b><span>${i[1]}</span><span style="font-size:12px;margin-top:4px">${i[2]}</span></div></div>`).join('')}</div>`;
};

/* end of ride */
SCREENS.thanks = (root, { rec }) => {
  root.className = 'scr thx';
  root.innerHTML = `<div class="thx-h"><h1>Děkujeme za jízdu<br>s FAIRTIQem!</h1></div>
    <div class="scroll"><p class="thx-p">${rec && rec.auto ? 'Jízdu jsme ukončili automaticky, protože skončila platnost jízdenky. ' : 'Doufáme, že jste si cestu užili. '}Dáme vám vědět, jakmile ji vyhodnotíme.</p>
      <div class="thx-ill"><img class="bus" src="assets/bus.png" alt=""><img class="sh" src="assets/shelter.png" alt=""></div></div>`;
};

/* rewards */
const fmtKc = n => n.toFixed(2).replace('.', ',');
function Rewards(mb) {
  mb.innerHTML = `<div class="scroll" style="background:var(--grey)">
    <div class="credit">
      <div class="ct">${IC.coins}<b>Aktuální výše kreditu</b></div>
      <p>Tuto částku odečteme při přístím vyúčtování, pokud je to bude oblast umožňovat.</p>
      <div class="amt"><b>${fmtKc(S.credit)}</b><span>Kč</span></div>
      <button class="chip" id="hist">Zobrazit historii</button>
      <img src="assets/piggy.png" alt="">
    </div>
    <button class="rowx" id="newpromo">${IC.giftPlus}<span>Přidat se k nové akci</span>${IC.chevR('#9a9da5', 22)}</button>
  </div>`;
  $('#hist', mb).onclick = () => go('credithist');
  $('#newpromo', mb).onclick = () => go('promo');
}

/* promo code */
SCREENS.promo = root => {
  root.className = 'scr';
  root.innerHTML = `${hdr('Přidat se k akci', true)}
    <div class="scroll" style="background:var(--grey)">
      <div class="promo"><label class="l" for="pc">Promokód</label><input class="inp" id="pc" placeholder="Zadejte kód" autocapitalize="characters" autocomplete="off" spellcheck="false"></div>
      <p class="phelp">Máte promokód? Skvělé! Zadejte jej sem velkými písmeny a využijte jeho výhod.</p>
    </div>
    <div class="pfoot"><button class="btn-red dis" id="send">Odeslat</button></div>`;
  const inp = $('#pc', root), btn = $('#send', root);
  inp.oninput = () => btn.classList.toggle('dis', !inp.value.trim());
  btn.onclick = () => {
    if (btn.classList.contains('dis')) return;
    inp.blur();
    dialog('Promokód nelze použít', `Promokód <b>${esc(inp.value.trim().toUpperCase())}</b> neznáme nebo jeho platnost již vypršela.`, 'OK', null, 'Zavřít');
  };
};

/* credit history */
SCREENS.credithist = root => {
  root.innerHTML = `${hdr('Historie kreditu', true)}<div class="scroll" style="background:var(--grey)"><div class="emptyc">Zatím nemáte žádné pohyby kreditu.</div></div>`;
};

/* smart stop */
SCREENS.smartstop = root => {
  root.innerHTML = `${hdr('Smart Stop', true)}
    <div class="scroll" style="background:var(--grey)">
      <div class="ssrow">${IC.sparkle}<span>Smart Stop</span>${Switch('ss', S.smartStop)}</div>
      <div class="sstext"><p>Díky funkci Smart Stop FAIRTIQ dokáže poznat, kdy jste už dojeli do cíle, ale nevypnuli jste cestování.</p>
      <p>Pokaždé, kdy tento případ nastane, funkce Smart Stop zahájí odpočítávání a zobrazí vám o tom zprávu. Dostanete na výběr, jestli chcete pokračovat v cestování, nebo cestování vypnout. Pokud nezareagujete, funkce Smart Stop automaticky po určité době vypne cestování (cca po 10–30 minutách). Upozorňujeme, že nastavení funkce Smart Stop není možné měnit během zapnutého cestování.</p></div>
      <img class="ssimg" src="assets/smartstop.png" alt="">
    </div>`;
  const sw = $('#ss', root);
  sw.addEventListener('click', e => {
    if (S.ride) { e.stopImmediatePropagation(); toast('Během cestování nelze Smart Stop měnit'); }
  }, true);
  bindSwitch(sw, v => { S.smartStop = v; save(); });
};

/* companions */
SCREENS.companions = root => {
  const draw = () => {
    root.innerHTML = `<div class="hdr white"><button class="circ l w" data-back aria-label="Zavřít">${IC.chevD('#2b2b2b', 26)}</button><h1>Spolucestující</h1><button class="circ r w" id="add" aria-label="Přidat">${IC.plus}</button></div>
      <div class="scroll" style="background:var(--grey)">${S.companions.length
        ? `<div class="list">${S.companions.map((c, i) => `<button class="row" data-i="${i}"><div class="av sm">${esc(initials(c))}</div><div class="tx"><b>${esc(c.first)} ${esc(c.last)}</b><span>Narozen/a ${dobFmt(c.dob)}</span></div></button>`).join('')}</div>`
        : '<div class="emptyc">Zatím nemáte přidány žádné spolucestující.</div>'}</div>`;
    $('[data-back]', root).onclick = back;
    $('#add', root).onclick = addCompanion;
    $$('.row', root).forEach(b => b.onclick = () => {
      const c = S.companions[+b.dataset.i];
      dialog('Odebrat spolucestujícího?', `${esc(c.first)} ${esc(c.last)} bude odebrán/a ze seznamu.`, 'Odebrat', () => { S.companions.splice(+b.dataset.i, 1); save(); draw(); });
    });
  };
  const addCompanion = () => sheet(`<h2>Přidat spolucestujícího</h2>
    <div class="form" style="padding:8px 0 0">
      <label class="l" for="c1">Jméno</label><input class="inp" id="c1" placeholder="Jméno">
      <label class="l" for="c2">Příjmení</label><input class="inp" id="c2" placeholder="Příjmení">
      <label class="l" for="c3">Datum narození</label><input class="inp" id="c3" inputmode="numeric" placeholder="dd/mm/rrrr" maxlength="10">
    </div><button class="btn-red dis" id="csave" style="margin-top:22px">Uložit</button>`, (sh, close) => {
    const v = id => $(id, sh).value.trim(), btn = $('#csave', sh);
    const ok = () => v('#c1') && v('#c2') && parseDob(v('#c3'));
    $$('input', sh).forEach(i => i.addEventListener('input', () => btn.classList.toggle('dis', !ok())));
    $('#c3', sh).addEventListener('input', e => {
      let d = e.target.value.replace(/\D/g, '').slice(0, 8), o = d.slice(0, 2);
      if (d.length > 2) o += '/' + d.slice(2, 4); if (d.length > 4) o += '/' + d.slice(4);
      e.target.value = o; btn.classList.toggle('dis', !ok());
    });
    btn.onclick = () => {
      if (!ok()) return;
      S.companions.push({ first: v('#c1'), last: v('#c2'), dob: parseDob(v('#c3')) }); save();
      close(); draw();
    };
  });
  draw();
};

/* profile */
function Profile(mb) {
  const u = S.user;
  const R = (id, ico, t, s, cls = '') => `<button class="row ${cls}" id="${id}"><div class="ico">${ico}</div><div class="tx"><b>${t}</b>${s ? `<span>${s}</span>` : ''}</div>${cls ? '' : IC.chevR()}</button>`;
  mb.innerHTML = `<div class="scroll" style="background:var(--grey)">
    <div class="pcard"><div class="av">${esc(initials(u))}</div><div><b>${esc(u.first)} ${esc(u.last)}</b><span>${esc(u.email)}</span></div></div>
    <div class="sub">Účet</div><div class="list">
      ${R('p1', IC.person(), 'Osobní údaje', 'Narozen/a ' + dobFmt(u.dob))}
      ${R('p2', IC.ride(), 'Moje jízdy', S.history.length + ' dokončených jízd')}
      ${R('p3', IC.card(), 'Platební metody', 'Visa •••• 4821')}
      ${R('p4', IC.bellS(), 'Oznámení', u.notifReceipt ? 'Účtenka emailem zapnuta' : 'Účtenka emailem vypnuta')}
    </div>
    <div class="sub">Aplikace</div><div class="list">
      ${R('p5', IC.globe(), 'Jazyk', 'Čeština')}
      ${R('p6', IC.help(), 'Nápověda a kontakt', 'hello@fairtiq.com')}
      ${R('p7', IC.doc(), 'Právní informace')}
      ${R('p8', IC.info(), 'O aplikaci')}
    </div>
    <div class="sub"> </div><div class="list">${R('p9', IC.out(), 'Odhlásit se', '', 'danger')}</div>
    <div class="ver">FAIRTIQ · verze 5.14.0 (cs)<br>Ukázková aplikace – nejedná se o platnou jízdenku</div></div>`;
  const on = (id, fn) => $('#' + id, mb).onclick = fn;
  on('p1', () => go('account', { mode: 'edit' })); on('p2', () => go('rides')); on('p3', () => go('payment'));
  on('p4', () => go('notifset')); on('p5', () => go('language')); on('p6', () => go('help'));
  on('p7', () => go('legal', { kind: 'menu' })); on('p8', () => go('about'));
  on('p9', () => {
    if (S.ride) { toast('Nejdřív ukončete probíhající jízdu'); return; }
    dialog('Odhlásit se?', 'Budete odhlášeni z účtu ' + esc(S.user.email) + '. Historie jízd zůstane uložena v účtu.', 'Odhlásit', () => {
      S.user = null; save(); go('onboarding', {}, { reset: true, anim: 'fade' });
    });
  });
}

/* rides history */
SCREENS.rides = root => {
  const rows = S.history.map(h => `<button class="row" data-id="${h.id}"><div class="ico">${IC.ride()}</div><div class="tx"><b>${esc(h.from)} → ${esc(h.to)}</b><span>${fmtD(h.start)} · ${fmtHM(h.start)}–${fmtHM(h.end)}</span></div><b style="font-weight:600;font-size:16px;white-space:nowrap">${h.evaluated ? fmtKc(h.price) + ' Kč' : '<span style="color:#9a9da5;font-weight:500;font-size:13px">Vyhodnocujeme…</span>'}</b></button>`).join('');
  root.innerHTML = `${hdr('Moje jízdy', true)}<div class="scroll list">${rows || '<div class="empty">Zatím žádné jízdy</div>'}</div>`;
  $$('.row', root).forEach(b => b.onclick = () => {
    const h = S.history.find(x => x.id === b.dataset.id);
    sheet(`<h2>${fmtD(h.start)}</h2><div class="kv" style="margin:12px 0"><div><span>Odkud</span><b>${esc(h.from)}</b></div><div><span>Kam</span><b>${esc(h.to)}</b></div><div><span>Čas</span><b>${fmtHM(h.start)}–${fmtHM(h.end)}</b></div><div><span>Délka</span><b>${fmtDur((h.end - h.start) / 1000)}</b></div>${h.tariff ? `<div><span>Tarif</span><b>${esc(h.tariff)}</b></div>` : ''}<div class="tot"><span>Cena</span><b>${h.evaluated ? fmtKc(h.price) + ' Kč' : 'Vyhodnocujeme…'}</b></div></div><button class="btn-red" data-close>Zavřít</button>`);
  });
};

/* payment */
SCREENS.payment = root => {
  root.innerHTML = `${hdr('Platební metody', true)}<div class="scroll list">
    <button class="row"><div class="ico">${IC.card()}</div><div class="tx"><b>Visa •••• 4821</b><span>Platnost 08/28 · výchozí</span></div></button>
    <button class="row" id="add"><div class="ico">${IC.card('#17a882')}</div><div class="tx"><b style="color:#148667">Přidat platební metodu</b></div>${IC.chevR()}</button>
    <p class="help" style="margin:16px">Jízdné vám strhneme automaticky po ukončení jízdy.</p></div>`;
  $('#add', root).onclick = () => toast('V ukázkové aplikaci nelze přidat kartu');
};

/* notification settings */
SCREENS.notifset = root => {
  const u = S.user;
  root.innerHTML = `${hdr('Oznámení', true)}<div class="scroll" style="background:var(--grey)">
    <div class="sec first">Oznámení</div>
    <div class="cell"><div><div class="t">Účtenka</div><div class="s">emailem</div></div>${Switch('a', u.notifReceipt)}</div>
    <div class="cell"><div class="t">Informujte mě, jakmile získám bonus</div>${Switch('b', u.notifBonus)}</div></div>`;
  bindSwitch($('#a', root), v => { u.notifReceipt = v; save(); }); bindSwitch($('#b', root), v => { u.notifBonus = v; save(); });
};

/* language */
SCREENS.language = root => {
  root.innerHTML = `${hdr('Jazyk', true)}<div class="scroll list">
    ${[['Čeština', 1], ['English', 0], ['Deutsch', 0], ['Slovenčina', 0]].map(([n, a]) => `<button class="row" data-n="${n}"><div class="tx"><b>${n}</b></div>${a ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#17a882" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.500l4.500 4.500L19 7.500"/></svg>` : ''}</button>`).join('')}</div>`;
  $$('.row', root).forEach(b => b.onclick = () => b.dataset.n !== 'Čeština' && toast('Tento jazyk zatím není k dispozici'));
};

/* help */
SCREENS.help = root => {
  const q = [['Jak začít jízdu?', 'Přetáhněte zelené tlačítko na úvodní obrazovce doprava. Jízda a jízdenka se aktivují okamžitě.'],
    ['Jak jízdu ukončit?', 'Přetáhněte červené tlačítko doleva. Pokud zapomenete, jízdu můžete ukončit později a cenu upravíme.'],
    ['Jak se počítá cena?', 'Cenu spočítáme podle ujeté trasy a platného tarifu. Platíte vždy nejlepší možné jízdné.'],
    ['Co dělat při kontrole?', 'Otevřete jízdenku tlačítkem „Zobrazit jízdenku“ a ukažte ji kontrolorovi.']];
  root.innerHTML = `${hdr('Nápověda a kontakt', true)}<div class="scroll list">
    ${q.map(([a, b]) => `<details class="row" style="display:block;padding:0"><summary class="row" style="border:0;list-style:none"><div class="tx"><b>${a}</b></div>${IC.chevD('#9a9da5', 20)}</summary><p class="help" style="margin:0;padding:0 16px 16px">${b}</p></details>`).join('')}
    <a class="row" href="mailto:hello@fairtiq.com" style="text-decoration:none;color:inherit"><div class="ico">${IC.help()}</div><div class="tx"><b>Napište nám</b><span>hello@fairtiq.com</span></div></a></div>`;
};

/* legal */
SCREENS.legal = (root, { kind = 'menu' } = {}) => {
  const T = {
    terms: ['Obchodní podmínky', 'Používáním aplikace FAIRTIQ uzavíráte smlouvu o přepravě s dopravcem a se společností FAIRTIQ jako zprostředkovatelem. Jízdné je splatné po ukončení jízdy.'],
    privacy: ['Ochrana osobních údajů', 'Osobní údaje zpracováváme pouze v rozsahu nezbytném pro poskytnutí služby, vyúčtování jízdného a přepravní kontrolu. Údaje o poloze se používají pouze během aktivní jízdy.'],
    withdraw: ['Právo na odstoupení', 'Souhlasem s omezením nároku na odstoupení od kupní smlouvy berete na vědomí, že služba přepravy je poskytnuta okamžitě po zahájení jízdy.'],
  };
  if (kind !== 'menu') { const [t, x] = T[kind]; root.innerHTML = `${hdr(t, true)}<div class="scroll"><p class="help" style="margin:20px 16px;font-size:16px">${x}</p></div>`; return; }
  root.innerHTML = `${hdr('Právní informace', true)}<div class="scroll list">${Object.entries(T).map(([k, v]) => `<button class="row" data-k="${k}"><div class="tx"><b>${v[0]}</b></div>${IC.chevR()}</button>`).join('')}</div>`;
  $$('.row', root).forEach(b => b.onclick = () => go('legal', { kind: b.dataset.k }));
};

/* about */
SCREENS.about = root => {
  root.innerHTML = `${hdr('O aplikaci', true)}<div class="scroll" style="background:var(--grey)"><div style="text-align:center;padding:36px 24px">
    <img src="assets/icon-192.png" width="84" height="84" style="margin:0 auto 14px;border-radius:20px" alt="">
    <b style="font-size:20px">FAIRTIQ</b><div style="color:#6b6e76;margin-top:4px;font-size:14px">Public transport made easy.</div>
    <div style="color:#6b6e76;margin-top:14px;font-size:14px">Verze 5.14.0 (cs)</div>
    <p class="help" style="margin-top:22px;font-size:13.5px;color:#6b6e76">Ukázková aplikace vytvořená podle vzhledu FAIRTIQ. Jízdenka a QR kód slouží pouze jako demonstrace a nejsou platným dokladem o přepravě.</p></div></div>`;
};

/* ------------------------------------------------------------------ boot */
setInterval(() => {
  // a day ticket ends at 3:00 – close a forgotten ride like the real app does
  if (S.ride && S.user && Date.now() >= S.ride.validTo) { stopRide(true); return; }
  if (S.user) evaluateRides();
  tickFn && tickFn();
}, 1000);
document.addEventListener('contextmenu', e => { if (e.target.closest('img')) e.preventDefault(); });
go('splash', {}, { reset: true, anim: '' });
})();
