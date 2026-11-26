/* Revize – terénní checklist CL-A4-02 (PWA pro iPhone).
 *
 * Vše běží v telefonu: seznam objektů i rozpracované checklisty jsou jen v úložišti
 * prohlížeče. Výstupem je JSON CL-A4-02, který program na PC načte přes
 * „Připojit JSON…“ a ukáže stejný kontrolní náhled jako u fotografie checklistu.
 */
'use strict';

const APP_VERSION = '1.5.0';
const ROLES = [
  ['po', 'A – Preventivní prohlídka PO'], ['php', 'B – Hasicí přístroje'], ['hydranty', 'B2 – Hydranty'],
  ['pozarni_dvere', 'C – Požární uzávěry'], ['nouzove_osvetleni', 'C – Nouzové osvětlení'], ['ucpavky', 'C – Ucpávky'],
  ['odvetravani', 'C – Odvětrávání'], ['klapky', 'C – Klapky'], ['detekce_co', 'C – Detekce CO'],
  ['central_stop', 'C – Central / Total stop'],
];
const PBZ = ROLES.slice(3).map(r => r[0]);
const ROLE_NAME = Object.fromEntries(ROLES);
const STATES = [['beze_zmen', 'Beze změn'], ['zmeny', 'Změny'], ['netyka_se', 'Netýká se']];
const PHP_ACTIONS = { TZ: 'Tlaková zkouška', OPR: 'Oprava', VYR: 'Vyřazení', NOVY: 'Nový přístroj', VYM: 'Výměna', EVIDENCE: 'Evidence stávajícího' };
const DRUHY = ['Práškový', 'Vodní', 'Pěnový', 'Sněhový (CO₂)', 'Čisté hasivo', 'Jiný'];
const FULL_ROW = ['NOVY', 'VYM', 'EVIDENCE'];
const MEASURE_KEYS = ['tlak_vytok', 'tlak_p1', 'tlak_p2', 'tlak_rozdil', 'prutok'];
const MEASURE_NAME = { tlak_vytok: 'Tlak na výtoku (MPa)', tlak_p1: 'Tlak P1 (MPa)', tlak_p2: 'Tlak P2 (MPa)', tlak_rozdil: 'Rozdíl P1–P2 (MPa)', prutok: 'Průtok Q (l/s)' };
const NO_STAVY = ['vyhovuje', 'nefunkční', 'mimo provoz'];
const VYROKY = ['odpovídá', 'odpovídá s omezením', 'neodpovídá'];

/* ------------------------------------------------------------------ úložiště */
const store = {
  get(key, fallback) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { toast('Uložení v telefonu se nezdařilo: ' + e.message); return false; }
  },
};
/* Seznam objektů s podklady (PHP, Kontrola PO, hydranty, NO) je velký – ukládá se do IndexedDB
   (localStorage má v Safari jen ~5 MB). Rozpracované checklisty jsou v IndexedDB také (klíč koncepty). */
const idb = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB není k dispozici')); return; }
      const req = indexedDB.open('revize', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  },
  async get(key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
  },
  async set(key, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(value, key);
      tx.oncomplete = () => resolve(true); tx.onerror = () => reject(tx.error);
    });
  },
};
let seznam = { vytvoreno: '', polozky: [], katalog: [] };
async function loadSeznam() {
  try {
    const stored = await idb.get('seznam');
    const legacy = store.get('revize.seznam', null);
    if (stored) seznam = stored;
    else if (legacy) { seznam = legacy; await idb.set('seznam', legacy); }
    if (legacy) localStorage.removeItem('revize.seznam');  // uvolní místo pro checklisty
  } catch (e) { seznam = store.get('revize.seznam', seznam); }
  seznam.katalog = seznam.katalog || [];
}
async function saveSeznam() {
  try { await idb.set('seznam', seznam); return true; }
  catch (e) { return store.set('revize.seznam', seznam); }
}
let drafts = store.get('revize.koncepty', {});
// Objekty odebrané ze seznamu (vyřízené jinak než telefonem): id → termín v době odebrání.
// Při novém termínu (další rok) se objekt v seznamu znovu objeví.
let skryte = store.get('revize.skryte', {});
function isHidden(o) { return Object.prototype.hasOwnProperty.call(skryte, o.id) && skryte[o.id] === (o.termin || ''); }
let saveTimer = null;
/* Checklisty jsou v IndexedDB (localStorage má v Safari jen ~5 MB a zápis brzdí aplikaci).
   localStorage je jen záchrana: použije se, když IndexedDB selže, a smaže se po prvním úspěšném zápisu. */
async function writeDrafts() {
  try {
    await idb.set('koncepty', drafts);
    localStorage.removeItem('revize.koncepty');
  } catch (e) {
    store.set('revize.koncepty', drafts);
  }
}
function saveDrafts(now) {
  clearTimeout(saveTimer);
  updateUnsent();
  if (now) { writeDrafts(); return; }
  saveTimer = setTimeout(writeDrafts, 300);
}
async function loadDrafts() {
  // Sloučení: novější verze každého checklistu vyhrává (localStorage existuje jen po selhání IndexedDB).
  const fromLs = store.get('revize.koncepty', {});
  let fromDb = null;
  try { fromDb = await idb.get('koncepty'); } catch (e) { fromDb = null; }
  const merged = Object.assign({}, fromDb || {});
  for (const [id, d] of Object.entries(fromLs)) {
    if (!merged[id] || String(d.zmeneno || '') > String(merged[id].zmeneno || '')) merged[id] = d;
  }
  drafts = merged;
  if (Object.keys(fromLs).length) await writeDrafts();   // převod starých checklistů do IndexedDB
}
window.addEventListener('pagehide', () => { if (saveTimer) { clearTimeout(saveTimer); writeDrafts(); } });
/* Neodeslané checklisty: „jen v telefonu“ = rozpracované nebo změněné po uložení (při ztrátě telefonu
   / smazání ikony zmizí); „čeká na OneDrive“ = uložené, ale aktuální obsah ještě není v OneDrive. */
function unsentInfo() {
  const all = Object.values(drafts);
  const jenTelefon = all.filter(d => d.stav !== 'ulozeno');
  // Při nastaveném OneDrive se uložené checklisty odesílají samy – dokud neodejdou, počítají se jako neodeslané
  // (i když mezitím vypršelo přihlášení).
  const cekaOd = typeof od !== 'undefined' && od.configured() ? all.filter(d => d.stav === 'ulozeno' && d.nahrano !== d.zmeneno) : [];
  const nejstarsi = [...jenTelefon, ...cekaOd].map(d => d.zmeneno || '').filter(Boolean).sort()[0] || '';
  return { jenTelefon, cekaOd, celkem: jenTelefon.length + cekaOd.length, nejstarsi };
}
function updateUnsent() {
  const info = unsentInfo();
  const pill = document.getElementById('neodeslano');
  if (pill) {
    pill.hidden = !info.celkem;
    pill.textContent = `${info.celkem} neodesl.`;
    pill.setAttribute('aria-label', `Neodeslané checklisty: ${info.celkem}`);
  }
  try { if (navigator.setAppBadge) (info.celkem ? navigator.setAppBadge(info.celkem) : navigator.clearAppBadge()).catch(() => {}); } catch (e) { /* ikona bez čísla */ }
  return info;
}
function daysSince(iso) { const t = Date.parse(iso || ''); return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : 0; }

/* ------------------------------------------------------------------ pomocné */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'value') el.value = value;
    else if (key === 'checked') el.checked = !!value;
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
function toast(message, ms = 3500) {
  const el = document.getElementById('toast');
  el.textContent = message; el.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, ms);
}
function norm(text) {
  return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
function todayIso() {
  const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function czDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}.${m[2]}.${m[1]}` : '';
}
function monthValue(text) {
  const m = /^(\d{1,2})\/(\d{4})$/.exec(String(text || '').trim()); return m ? Number(m[2]) * 12 + Number(m[1]) : null;
}
function icoOk(ico) {
  if (!/^\d{8}$/.test(ico)) return false;
  let weighted = 0;
  for (let i = 0; i < 7; i++) weighted += Number(ico[i]) * (8 - i);
  const mod = 11 - (weighted % 11);
  return (mod === 10 ? 0 : mod === 11 ? 1 : mod) === Number(ico[7]);
}
function phoneNumber(phone) {
  // Více čísel („721 778 361; 602 …“) → první z nich.
  const digits = String(phone || '').split(/[;/,]/)[0].replace(/[^\d+]/g, '');
  return digits.replace(/\D/g, '').length >= 9 ? digits : null;
}
function phoneHref(phone) { const n = phoneNumber(phone); return n ? 'tel:' + n : null; }
// SMS otevře aplikaci Zprávy s předvyplněným příjemcem; text napíše a odešle uživatel.
function smsHref(phone) { const n = phoneNumber(phone); return n ? 'sms:' + n : null; }
function yearOf(draft) { return Number((draft.datum || todayIso()).slice(0, 4)); }
/* Jednoduchá pravidla (délky textů, formáty) posílá PC v seznam.json („pravidla“, pravidla_checklistu.py);
   výchozí hodnoty níže platí, dokud seznam pravidla nemá. Logická pravidla jsou ve validate(). */
const DEFAULT_RULES = {
  verze: 1, text_max: 480, adresa_max: 240, subjekt_max: 350, radku_pbz_max: 100,
  vyrobni_cislo_nove: '^[^/\\s]+/\\d{2}$', rok: '^(19|20)\\d\\d$', mereni: '^\\d{1,5}([.,]\\d{1,6})?$',
};
function rules() { return Object.assign({}, DEFAULT_RULES, (seznam && seznam.pravidla) || {}); }
function rx(name) { return new RegExp(rules()[name]); }
function inventoryOf(draft) {
  if (draft.novy_objekt === true || !draft.zdroj) return null;
  const current = seznam.polozky.find(o => o.id === draft.zdroj.id);
  const php = (current && current.php) || draft.zdroj.php;
  return php && Array.isArray(php.pristroje) && php.pristroje.length ? php : null;
}
function kindOf(text) {
  const n = norm(text);
  if (n.startsWith('sn') || n.startsWith('co')) return 'Sněhový (CO₂)';
  return DRUHY.find(d => norm(d).slice(0, 3) === n.slice(0, 3)) || '';
}

/* ------------------------------------------------------------------ model checklistu */
function newDraft(source) {
  return {
    id: source ? 'obj:' + source.id : 'rucni:' + Date.now().toString(36),
    zdroj: source || null,
    datum: todayIso(),
    adresa: source ? source.adresa : '',
    ico: source ? (source.ico || '') : '',
    subjekt: source ? (source.zakaznik || '') : '',
    novy_objekt: source ? false : null,
    // Části, pro které objekt nemá dokument (podle exportu z PC), jsou předem „Netýká se“.
    stavy: Object.fromEntries(ROLES.map(([role]) => [role,
      source && Array.isArray(source.casti) && source.casti.length && !source.casti.includes(role) ? 'netyka_se' : 'nejasne'])),
    po: { minule: null, zavady: [] },
    d: { chybi_php: null, chybi_znaceni: null, jine: '' },
    php: [], hyd_mereni: [], hyd_zavady: [],
    pbz: Object.fromEntries(PBZ.map(role => [role, []])),
    stav: 'rozpracovano', zmeneno: new Date().toISOString(),
  };
}
/* Úpravy polí protokolů z exportu: null = beze změny (zůstane, co je v dokumentu). */
function ensureDraft(draft) {
  draft.po_a = draft.po_a || {};            // název řádku → { volby: [...], text }
  if (!('po_c' in draft)) draft.po_c = null;
  if (!('po_d' in draft)) draft.po_d = null;
  if (!('hyd_zaver' in draft)) draft.hyd_zaver = null;
  if (!('no_doklad' in draft)) draft.no_doklad = null;
  draft.no_stavy = draft.no_stavy || {};    // řádek seznamu NO → stav
  draft.php_opravy = draft.php_opravy || {};  // výrobní číslo (malými) → opravené údaje stávajícího PHP
  return draft;
}
/* Oprava údajů stávajících PHP: posílá se jen to, co se oproti evidenci změnilo (+ původní hodnoty pro kontrolu na PC). */
const PHP_FIX_FIELDS = [['umisteni', 'Umístění'], ['druh', 'Druh'], ['vyrobce', 'Výrobce'], ['model', 'Typ / model'],
  ['vyrobni_cislo', 'Výrobní číslo (rok výroby za lomítkem, např. 049176/18)']];
function phpFixes(draft) {
  const inv = inventoryOf(draft), out = [];
  if (!inv || !draft.php_opravy) return out;
  for (const unit of inv.pristroje) {
    const edit = draft.php_opravy[unit.vyrobni_cislo.trim().toLowerCase()];
    if (!edit) continue;
    const puvodni = {}, nove = {};
    for (const [key] of PHP_FIX_FIELDS) {
      const before = String(unit[key] ?? '').trim(), after = String(edit[key] ?? '').trim().replace(/\s+/g, ' ');
      if (after !== before) { puvodni[key] = before; nove[key] = after; }
    }
    if (Object.keys(nove).length) out.push({ vyrobni_cislo: unit.vyrobni_cislo, puvodni, nove });
  }
  return out;
}
function sourceOf(draft) {
  return (draft.zdroj && seznam.polozky.find(o => o.id === draft.zdroj.id)) || draft.zdroj || null;
}
function touch(draft) { draft.zmeneno = new Date().toISOString(); if (draft.stav === 'ulozeno') draft.stav = 'zmeneno'; drafts[draft.id] = draft; saveDrafts(); }

const sameList = (a, b) => JSON.stringify((a || []).map(x => String(x || '').trim()).filter(Boolean)) === JSON.stringify((b || []).map(x => String(x || '').trim()).filter(Boolean));
function rowState(row, draft) {
  const edit = draft.po_a[row.nazev];
  return { volby: edit ? edit.volby : row.volby.map(v => v[2]), text: edit ? edit.text : row.text };
}
function changedRowsA(draft, src) {
  if (!src || !src.po) return [];
  const out = [];
  for (const row of src.po.a) {
    const edit = draft.po_a[row.nazev];
    if (!edit) continue;
    const volby = edit.volby.map((v, i) => (v === row.volby[i][2] ? null : v));
    const text = row.text !== null && String(edit.text || '').trim() !== String(row.text || '').trim() ? String(edit.text || '').trim() : null;
    if (volby.every(v => v === null) && text === null) continue;
    out.push({ nazev: row.nazev, dvojice: row.volby.map(v => [v[0], v[1]]), volby, text });
  }
  return out;
}
function zaverChanged(draft, src) {
  const z = draft.hyd_zaver, orig = src && src.hydranty && src.hydranty.zaver;
  if (!z || !orig) return false;
  return z.vysledek !== orig.vysledek || !sameList(z.text, orig.text) || !sameList(z.doporuceni, orig.doporuceni);
}
function noChanged(draft, src) {
  const orig = src && src.no;
  if (!orig) return { doklad: false, stavy: [] };
  const stavy = (orig.seznam || []).filter(r => draft.no_stavy[r.radek] !== undefined && draft.no_stavy[r.radek].trim() !== r.stav)
    .map(r => ({ radek: r.radek, umisteni: r.umisteni, stav: draft.no_stavy[r.radek].trim() }));
  const d = draft.no_doklad, od = orig.doklad;
  const doklad = !!(d && od && (d.zjistene.trim() !== od.zjistene || d.odstraneni.trim() !== od.odstraneni));
  return { doklad, stavy };
}
function poValues(draft) {
  const d = draft.d, src = sourceOf(draft);
  return draft.po.minule !== null || draft.po.zavady.length > 0 || d.chybi_php !== null || d.chybi_znaceni !== null || !!d.jine.trim()
    || changedRowsA(draft, src).length > 0
    || (draft.po_c !== null && src && src.po && !sameList(draft.po_c, src.po.c))
    || (draft.po_d !== null && src && src.po && !sameList(draft.po_d, src.po.d));
}
function roleValues(draft, role) {
  const src = sourceOf(draft);
  const npred = novyPred(draft);
  if (npred) {   // nový objekt: formulář podle předlohy je sám zápisem změn
    // (formulář vzniká jen u části ve stavu Změny; u „Netýká se“ se nic nezapíše)
    if ((role === 'po' && npred.po) || (role === 'hydranty' && npred.hydranty) || (PBZ.includes(role) && npred.pbz[role])) {
      return draft.stavy[role] === 'zmeny';
    }
  }
  if (role === 'po') return poValues(draft);
  if (role === 'php') return draft.php.length > 0 || phpFixes(draft).length > 0;
  if (role === 'hydranty') return draft.hyd_zavady.length > 0 || zaverChanged(draft, src);
  if (role === 'nouzove_osvetleni') { const n = noChanged(draft, src); if (n.doklad || n.stavy.length) return true; }
  return draft.pbz[role].length > 0;
}

function validate(draft) {
  const errors = [];
  if (!czDate(draft.datum)) errors.push('Vyplň datum kontroly.');
  if (!draft.adresa.trim()) errors.push('Vyplň adresu domu.');
  if (!draft.subjekt.trim()) errors.push('Vyplň vlastníka (název SVJ / BD / firmy).');
  if (draft.ico.trim() && !icoOk(draft.ico.trim())) errors.push('IČO nemá platnou kontrolní číslici – oprav ho nebo nech prázdné.');
  if (typeof draft.novy_objekt !== 'boolean') errors.push('Zvol, zda jde o stávající, nebo nový objekt.');
  // Formulář podle předlohy potřebuje Kontrola PO, hydranty a PBZ; samotné hasicí přístroje ne.
  if (draft.novy_objekt === true && novyData() && (novyData().spravci || []).length && !novyPred(draft)
      && ['po', 'hydranty', ...PBZ].some(role => draft.stavy[role] === 'zmeny')) errors.push('Nový objekt: vyber správce (předlohu protokolů).');
  const nparts = novyParts(draft);
  if (nparts) errors.push(...nparts.errors);
  for (const [role, name] of ROLES) {
    const state = draft.stavy[role];
    if (state === 'nejasne') { errors.push(`${name}: zvol Beze změn / Změny / Netýká se.`); continue; }
    if (draft.novy_objekt === true && state === 'beze_zmen') errors.push(`${name}: nový objekt nemá stará data – zvol Změny nebo Netýká se.`);
    const has = roleValues(draft, role);
    if (has && state !== 'zmeny') errors.push(`${name}: obsahuje zapsané změny, ale stav je „${STATES.find(s => s[0] === state)[1]}“.`);
    if (state === 'zmeny' && !has && !(role === 'hydranty' && draft.hyd_mereni.length)) errors.push(`${name}: zapiš změny, nebo zvol Beze změn.`);
  }
  if (draft.hyd_mereni.length && draft.stavy.hydranty === 'netyka_se') errors.push('Hydranty: měření nelze uložit u stavu Netýká se.');
  draft.po.zavady.forEach((z, i) => { if (!z.popis.trim()) errors.push(`A – závada ${i + 1}: chybí popis.`); });
  const serials = new Set();
  const inv = inventoryOf(draft);
  const known = new Set((inv ? inv.pristroje : []).map(u => u.vyrobni_cislo.trim().toLowerCase()));
  draft.php.forEach((row, i) => {
    const label = `B – ${PHP_ACTIONS[row.akce]} ${row.vyrobni_cislo.trim() || i + 1}`;
    if (!row.vyrobni_cislo.trim()) errors.push(`${label}: chybí výrobní číslo.`);
    const serialKey = row.vyrobni_cislo.trim().toLowerCase();
    if (inv && serialKey && ['TZ', 'OPR', 'VYR', 'VYM'].includes(row.akce) && !known.has(serialKey)) errors.push(`${label}: přístroj není v evidenci objektu – vyber ho v seznamu přístrojů.`);
    if (inv && serialKey && row.akce === 'NOVY' && known.has(serialKey)) errors.push(`${label}: toto výrobní číslo už v evidenci je.`);
    const newSerial = row.akce === 'VYM' ? row.nove_vyrobni_cislo.trim() : row.akce === 'NOVY' ? row.vyrobni_cislo.trim() : '';
    if (newSerial && !rx('vyrobni_cislo_nove').test(newSerial)) errors.push(`${label}: výrobní číslo nového PHP piš ve tvaru číslo/XX (např. 001234/26).`);
    if (newSerial && known.has(newSerial.toLowerCase())) errors.push(`${label}: nové výrobní číslo ${newSerial} už v evidenci je.`);
    const key = row.vyrobni_cislo.trim().toLowerCase();
    if (key && row.akce !== 'EVIDENCE') { if (serials.has(key)) errors.push(`${label}: více akcí pro stejné výrobní číslo.`); serials.add(key); }
    if (row.akce === 'EVIDENCE' && draft.novy_objekt !== true) errors.push(`${label}: evidence stávajících PHP je jen u nového objektu.`);
    if (row.akce === 'VYM' && !row.nove_vyrobni_cislo.trim()) errors.push(`${label}: chybí výrobní číslo nového přístroje.`);
    if (row.akce === 'NOVY' || row.akce === 'VYM') {
      for (const [key2, name] of [['druh', 'druh'], ['vyrobce', 'výrobce'], ['model', 'model'], ['umisteni', 'umístění']]) {
        if (!String(row[key2] || '').trim()) errors.push(`${label}: chybí ${name}.`);
      }
    }
    if (row.akce === 'EVIDENCE') {
      if (!row.druh) errors.push(`${label}: chybí druh.`);
      // Program z nich počítá stav přístroje (TZ, životnost); bez nich checklist nepřijme.
      if (!String(row.rok_vyroby || '').trim()) errors.push(`${label}: chybí rok výroby.`);
      if (!String(row.rok_tz || '').trim()) errors.push(`${label}: chybí rok poslední TZ.`);
    }
    for (const year of ['rok_vyroby', 'rok_tz']) {
      if (row[year] && !rx('rok').test(row[year])) errors.push(`${label}: rok musí být čtyřmístný (např. 2019).`);
    }
  });
  const fixedSerials = new Set();
  for (const fix of phpFixes(draft)) {
    const label = `B – oprava údajů ${fix.vyrobni_cislo}`;
    for (const key of ['vyrobni_cislo', 'druh']) if (key in fix.nove && !fix.nove[key]) errors.push(`${label}: ${key === 'druh' ? 'druh' : 'výrobní číslo'} nesmí být prázdné.`);
    const serial = fix.nove.vyrobni_cislo;
    if (!serial) continue;
    const k = serial.toLowerCase();
    if ((known.has(k) && k !== fix.vyrobni_cislo.trim().toLowerCase()) || fixedSerials.has(k)) errors.push(`${label}: výrobní číslo ${serial} už má jiný přístroj.`);
    fixedSerials.add(k);
    const yy = serial.match(/\/(\d{2})$/);
    if (yy) {
      const made = Number(yy[1]) <= 68 ? 2000 + Number(yy[1]) : 1900 + Number(yy[1]);
      if (made > yearOf(draft)) errors.push(`${label}: rok výroby ${made} za lomítkem je v budoucnosti.`);
    }
  }
  draft.hyd_mereni.forEach((m, i) => {
    if (!m.umisteni.trim()) errors.push(`B2 – měření ${i + 1}: chybí umístění hydrantu.`);
    if (!MEASURE_KEYS.some(k => String(m[k] || '').trim())) errors.push(`B2 – měření ${i + 1}: zapiš aspoň jednu naměřenou hodnotu.`);
    for (const k of MEASURE_KEYS) if (String(m[k] || '').trim() && !rx('mereni').test(String(m[k]).trim())) errors.push(`B2 – měření ${i + 1}: hodnota „${m[k]}“ musí být číslo (např. 0,45).`);
  });
  if (draft.hyd_zavady.length) errors.push('B2 – volný text závad hydrantů program do protokolu nezapíše: odeber ho a závadu zapiš do Závěru (doporučení).');
  for (const role of PBZ) draft.pbz[role].forEach((r, i) => { if (!r.popis.trim()) errors.push(`${ROLE_NAME[role]} ${i + 1}: chybí popis.`); });
  const src = sourceOf(draft);
  if (src && src.po) {
    for (const row of src.po.a) {
      const st = rowState(row, draft);
      if (row.text !== null && row.volby[0][0].toLowerCase().startsWith('záv') && st.volby[0] === 0 && !String(st.text || '').trim()) {
        errors.push(`A – ${row.nazev}: zapiš text závady.`);
      }
    }
  }
  if (zaverChanged(draft, src)) {
    const z = draft.hyd_zaver, max = src.hydranty.zaver.max_doporuceni;
    if (z.text.some(t => !t.trim())) errors.push('B2 – Závěr: řádek textu závěru nesmí být prázdný.');
    if (z.doporuceni.filter(t => t.trim()).length > max) errors.push(`B2 – Závěr má v protokolu místo jen pro ${max} doporučení.`);
  }
  if (noChanged(draft, src).doklad && !draft.no_doklad.zjistene.trim()) errors.push('C – Nouzové osvětlení: vyplň Zjištěné závady v dokladu.');
  if (src && src.no && draft.pbz.nouzove_osvetleni.length && noChanged(draft, src).doklad) {
    errors.push('C – Nouzové osvětlení: zapiš závady buď do dokladu, nebo jako změny – ne obojí.');
  }
  errors.push(...lengthErrors(draft));
  return errors;
}

/* Délky textů a počty řádků podle pravidel z PC – stejné limity, jaké PC hlídá při převzetí. */
const FIELD_NAME = { subjekt: 'vlastník', adresa: 'adresa domu', popis: 'popis', umisteni: 'umístění', opatreni: 'opatření',
  jine: 'D – jiné', poznamka: 'poznámka', vyrobce: 'výrobce', model: 'model', text: 'text', doporuceni: 'doporučení',
  zjistene: 'zjištěné závady', odstraneni: 'odstranění závad', stav: 'stav svítidla', po_c: 'C', po_d: 'D' };
function lengthErrors(draft) {
  const r = rules(), out = [];
  let built;
  try { built = build(draft); } catch (e) { return out; }
  const obj = built.objekty[0];
  if (built.subjekt.length > r.subjekt_max) out.push(`Vlastník je delší než ${r.subjekt_max} znaků – zkrať ho.`);
  if (obj.adresa.length > r.adresa_max) out.push(`Adresa domu je delší než ${r.adresa_max} znaků.`);
  for (const role of PBZ) {
    if ((obj.pbz_zmeny[role] || []).length > r.radku_pbz_max) out.push(`${ROLE_NAME[role]}: nejvýš ${r.radku_pbz_max} změn.`);
  }
  const walk = (value, key) => {
    if (typeof value === 'string') {
      if (key !== 'subjekt' && key !== 'adresa' && value.length > r.text_max) {
        out.push(`Text „${FIELD_NAME[key] || key}“ je delší než ${r.text_max} znaků (${value.length}) – zkrať ho: „${value.slice(0, 40)}…“`);
      }
    } else if (Array.isArray(value)) value.forEach(v => walk(v, key));
    else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => walk(v, k));
  };
  walk(obj, '');
  return out;
}

function build(draft) {
  const year = yearOf(draft);
  const text = value => String(value || '').trim();
  const num = value => (text(value) ? Number(text(value)) : null);
  const evidence = [], changes = [];
  for (const row of draft.php) {
    const base = { akce: row.akce, vyrobni_cislo: text(row.vyrobni_cislo) };
    if (row.akce === 'TZ') Object.assign(base, { rok_tz: year });
    if (row.akce === 'OPR') Object.assign(base, { rok_tz: year, rok_tz_zapis: 'oprava' });
    if (FULL_ROW.includes(row.akce)) {
      Object.assign(base, { druh: text(row.druh), vyrobce: text(row.vyrobce), model: text(row.model),
        rok_vyroby: num(row.rok_vyroby), umisteni: text(row.umisteni) });
    }
    if (row.akce === 'EVIDENCE') base.rok_tz = num(row.rok_tz);
    if (row.akce === 'VYM') base.nove_vyrobni_cislo = text(row.nove_vyrobni_cislo);
    if (text(row.poznamka)) base.poznamka = text(row.poznamka);
    (row.akce === 'EVIDENCE' ? evidence : changes).push(base);
  }
  const poOn = draft.stavy.po === 'zmeny';
  const object = {
    adresa: text(draft.adresa),
    stavy: { ...draft.stavy },
    prohlidka_po: {
      minule_zavady_odstraneny: poOn ? draft.po.minule : null,
      nove_zavady: draft.po.zavady.map(z => ({ umisteni: text(z.umisteni), popis: text(z.popis), opatreni: text(z.opatreni) })),
    },
    php_evidence: evidence, php_zmeny: changes,
    hydranty_mereni: draft.hyd_mereni.map(m => {
      const row = { id: text(m.id), umisteni: text(m.umisteni) };
      for (const key of MEASURE_KEYS) if (text(m[key])) row[key] = text(m[key]);
      return row;
    }),
    hydranty_zavady: draft.hyd_zavady.map(text),
    pbz_zmeny: Object.fromEntries(PBZ.map(role => [role, draft.pbz[role].map(r => ({ id: text(r.id), umisteni: text(r.umisteni), popis: text(r.popis), hodnoty: {} }))])),
    zavady_d: { chybi_php: draft.d.chybi_php, chybi_bezpecnostni_znaceni: draft.d.chybi_znaceni, jine: text(draft.d.jine) },
  };
  // Úpravy existujících polí protokolů (jen to, co se oproti dokumentu změnilo).
  const src = sourceOf(draft);
  const lines = list => (list || []).map(text).filter(Boolean);
  const rowsA = changedRowsA(draft, src);
  if (rowsA.length) object.po_a = rowsA;
  const fixes = phpFixes(draft);
  if (fixes.length) object.php_opravy = fixes;
  const nparts = novyParts(draft);
  if (nparts) {   // nový objekt: stejný tvar jako formulář na PC (qt_novy_objekt.checklist)
    const o = nparts.obj;
    if (o.blok) {
      object.prohlidka_po = { minule_zavady_odstraneny: null, nove_zavady: [], otazky: {}, blok: o.blok };
      object.zavady_d = { chybi_php: null, chybi_bezpecnostni_znaceni: null, jine: '' };
    }
    if (o.hydranty_formular) { object.hydranty_mereni = o.hydranty_mereni; object.hydranty_formular = o.hydranty_formular; object.hydranty_zavady = []; }
    if (o.pbz_formular) { object.pbz_formular = o.pbz_formular; for (const role of Object.keys(o.pbz_formular)) object.pbz_zmeny[role] = []; }
    if (o.no_seznam_novy) object.no_seznam_novy = o.no_seznam_novy;
    if (o.ucpavky_seznam_novy) object.ucpavky_seznam_novy = o.ucpavky_seznam_novy;
  }
  if (src && src.po && draft.po_c !== null && !sameList(draft.po_c, src.po.c)) object.po_c = lines(draft.po_c);
  if (src && src.po && draft.po_d !== null && !sameList(draft.po_d, src.po.d)) object.po_d = lines(draft.po_d);
  if (zaverChanged(draft, src)) {
    object.hydranty_zaver = { vysledek: draft.hyd_zaver.vysledek, text: draft.hyd_zaver.text.map(text), doporuceni: lines(draft.hyd_zaver.doporuceni) };
  }
  const no = noChanged(draft, src);
  if (no.doklad) object.pbz_doklad = { nouzove_osvetleni: { zjistene: text(draft.no_doklad.zjistene), odstraneni: text(draft.no_doklad.odstraneni) } };
  if (no.stavy.length) object.no_seznam = no.stavy;
  const result = {
    schema_checklist: 'CL-A4-02', udaje_se_nevesly: false, ico: text(draft.ico), subjekt: text(draft.subjekt),
    novy_objekt: draft.novy_objekt, datum_kontroly: czDate(draft.datum), zdrojovy_prepis: '', varovani: [],
    objekty: [object],
  };
  // Podle složky správce zařadí program na PC objekt do správné dávky („Z telefonu“).
  if (src && src.slozka) result.telefon = { id: src.id, slozka: src.slozka, sada: src.sada || '', aplikace: APP_VERSION };
  else if (nparts) result.telefon = { slozka: nparts.pred.slozka, sada: nparts.pred.sada, aplikace: APP_VERSION };
  return result;
}

function fileName(draft) {
  const ascii = norm(draft.adresa).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'objekt';
  return `checklist_${draft.datum}_${ascii}.json`;
}

/* ------------------------------------------------------------------ obrazovky */
const app = document.getElementById('app');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('back');
backBtn.addEventListener('click', () => { location.hash = '#/'; });

function route() {
  updateUnsent();
  const hash = location.hash || '#/';
  const match = /^#\/c\/(.+)$/.exec(hash);
  if (match && drafts[decodeURIComponent(match[1])]) return renderChecklist(ensureDraft(drafts[decodeURIComponent(match[1])]));
  if (hash === '#/o-aplikaci') return renderAbout();
  renderList();
}
window.addEventListener('hashchange', route);

function setTitle(text, back) { titleEl.textContent = text; backBtn.hidden = !back; document.title = text; }
function clear() { app.replaceChildren(); document.querySelector('.fab')?.remove(); }

async function applyList(data) {
  if (data.schema !== 'lhutnik-telefon-1' || !Array.isArray(data.objekty)) throw new Error('Soubor není seznam objektů z lhůtníku.');
  seznam = { vytvoreno: data.vytvoreno || '', nazev: data.nazev || '', polozky: data.objekty, katalog: data.katalog || seznam.katalog || [],
    pravidla: data.pravidla || seznam.pravidla || null, novy_objekt: data.novy_objekt || seznam.novy_objekt || null };
  await saveSeznam();
  const extra = ['po', 'hydranty', 'no'].map(k => data.objekty.filter(o => o[k]).length);
  toast(`Načteno ${seznam.polozky.length} objektů (Kontrola PO ${extra[0]}, hydranty ${extra[1]}, NO ${extra[2]}).`, 5000);
}
function importList(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try { await applyList(JSON.parse(reader.result)); renderList(); }
    catch (e) { toast('Seznam nelze načíst: ' + e.message, 6000); }
  };
  reader.readAsText(file);
}
function filePicker(accept, onFile) {
  const input = h('input', { type: 'file', accept, style: 'display:none', onchange: e => { if (e.target.files[0]) onFile(e.target.files[0]); } });
  document.body.append(input); input.click(); setTimeout(() => input.remove(), 60000);
}

function draftBadge(draft) {
  if (!draft) return null;
  if (draft.stav === 'ulozeno') {
    if (draft.nahrano === draft.zmeneno) return h('span', { class: 'badge done' }, 'v OneDrive');
    return od.configured() ? h('span', { class: 'badge draft' }, 'čeká na odeslání') : h('span', { class: 'badge done' }, 'uloženo');
  }
  return h('span', { class: 'badge draft' }, draft.stav === 'zmeneno' ? 'změněno po uložení' : 'rozpracováno');
}
function unsentBanner() {
  const info = updateUnsent();
  if (!info.celkem) return null;
  const n = info.celkem, old = daysSince(info.nejstarsi);
  const word = n === 1 ? 'checklist' : n < 5 ? 'checklisty' : 'checklistů';
  return h('div', { class: 'card warn', role: 'status' },
    h('div', { style: 'font-weight:700' }, `Neodesláno: ${n} ${word}`),
    info.jenTelefon.length ? h('p', { style: 'margin:6px 0 0' }, info.jenTelefon.length === 1
      ? '1 rozpracovaný nebo změněný – je jen v tomto telefonu. '
      : `${info.jenTelefon.length} ${info.jenTelefon.length < 5 ? 'rozpracované nebo změněné' : 'rozpracovaných nebo změněných'} – jsou jen v tomto telefonu. `,
      h('span', { class: 'muted' }, 'Dokonči je tlačítkem „Zkontrolovat a uložit JSON“.')) : null,
    info.cekaOd.length ? h('p', { style: 'margin:6px 0 0' }, (info.cekaOd.length === 1
      ? '1 uložený čeká na odeslání do OneDrive'
      : `${info.cekaOd.length} ${info.cekaOd.length < 5 ? 'uložené čekají' : 'uložených čeká'} na odeslání do OneDrive`)
      + (od.connected() ? ' – odešle se sám, jakmile bude signál.' : '.')) : null,
    info.cekaOd.length && !od.connected() ? h('p', { style: 'margin:6px 0 0;font-weight:650' },
      'Přihlášení k OneDrive vypršelo – po přihlášení se checklisty odešlou samy.') : null,
    old >= 2 ? h('p', { style: 'margin:6px 0 0;font-weight:650' }, `Nejstarší neodeslaný je ${old} dní starý.`) : null,
    info.cekaOd.length ? h('div', { class: 'row', style: 'margin-top:8px' }, od.connected()
      ? h('button', { class: 'btn primary', type: 'button', onclick: syncOneDrive }, 'Odeslat nyní')
      : h('button', { class: 'btn primary', type: 'button', onclick: () => od.login().catch(e => toast(e.message, 6000)) }, 'Přihlásit k OneDrive')) : null);
}

function renderList() {
  clear(); setTitle('Revize – objekty', false);
  const now = new Date(); const current = now.getFullYear() * 12 + now.getMonth() + 1;
  let filter = sessionStorage.getItem('revize.filtr') || 'vse';
  let query = sessionStorage.getItem('revize.hledat') || '';

  const banner = unsentBanner();
  if (banner) app.append(banner);
  const open = Object.values(drafts).sort((a, b) => b.zmeneno.localeCompare(a.zmeneno));
  if (open.length) {
    app.append(h('h2', { class: 'muted', style: 'margin:4px 4px 8px;font-size:15px' }, 'ROZPRACOVANÉ A ULOŽENÉ CHECKLISTY'));
    for (const draft of open.slice(0, 30)) {
      const go = () => { location.hash = '#/c/' + encodeURIComponent(draft.id); };
      app.append(h('div', { class: 'obj', role: 'button', tabindex: '0', onclick: go },
        h('div', { class: 'row nowrap' }, h('span', { class: 't grow' }, draft.adresa || '(bez adresy)'), draftBadge(draft),
          xButton(`Smazat checklist ${draft.adresa || '(bez adresy)'}`, () => deleteDraft(draft))),
        h('div', { class: 'muted' }, `${czDate(draft.datum)} · ${draft.subjekt || 'vlastník nevyplněn'}`)));
    }
  }

  const listBox = h('div');
  const searchInput = h('input', { type: 'search', placeholder: 'Hledat zákazníka nebo adresu…', value: query,
    oninput: e => { query = e.target.value; sessionStorage.setItem('revize.hledat', query); fill(); } });
  const filterSelect = h('select', { onchange: e => { filter = e.target.value; sessionStorage.setItem('revize.filtr', filter); fill(); } },
    [['vse', 'Všechny termíny'], ['tento', 'Tento měsíc'], ['pristi', 'Příští měsíc'], ['prosle', 'Prošlé']].map(([v, t]) => h('option', { value: v, selected: v === filter }, t)));
  app.append(h('h2', { class: 'muted', style: 'margin:14px 4px 8px;font-size:15px' }, 'OBJEKTY Z LHŮTNÍKU'),
    h('div', { class: 'card' }, searchInput, h('div', { style: 'height:8px' }), filterSelect,
      h('p', { class: 'muted', style: 'margin:8px 0 0' }, seznam.polozky.length
        ? `${seznam.polozky.length} objektů · seznam z ${seznam.vytvoreno || 'neznámého data'}${seznam.nazev ? ' · ' + seznam.nazev : ''}`
        : 'Seznam zatím není načtený. V programu na PC: Lhůtník → Export pro telefon, soubor ulož do OneDrive a tady ho načti.')),
    listBox);

  const showHidden = sessionStorage.getItem('revize.skryte') === '1';
  function fill() {
    const q = norm(query);
    const hiddenCount = seznam.polozky.filter(isHidden).length;
    const items = seznam.polozky.filter(o => {
      if (isHidden(o) !== showHidden) return false;
      const v = monthValue(o.termin);
      if (filter === 'tento' && v !== current) return false;
      if (filter === 'pristi' && v !== current + 1) return false;
      if (filter === 'prosle' && !(v && v < current)) return false;
      return !q || norm(`${o.zakaznik} ${o.adresa} ${o.obec || ''} ${o.ico} ${o.osoba}`).includes(q);
    }).sort((a, b) => (monthValue(a.termin) || 0) - (monthValue(b.termin) || 0) || norm(a.adresa).localeCompare(norm(b.adresa)));
    listBox.replaceChildren(...items.slice(0, 300).map(o => {
      const draft = drafts['obj:' + o.id];
      const tel = phoneHref(o.telefon);
      const phpCount = o.php && o.php.pristroje ? o.php.pristroje.length : 0;
      return h('div', { class: 'card' + (showHidden ? ' dim' : '') },
        h('div', { class: 'row nowrap' }, h('div', { class: 't grow', style: 'font-weight:650' }, o.adresa), draftBadge(draft),
          showHidden ? null : xButton(`Odebrat ${o.adresa} ze seznamu`, () => hideObject(o))),
        h('div', { class: 'muted' }, `${o.obec ? o.obec + ' · ' : ''}${o.zkratka || o.zakaznik} · ${o.sada || ''} · termín ${o.termin || '—'}${phpCount ? ` · ${phpCount} PHP` : ''}${o.pro_cely_dum ? ' · pro celý dům (vyplníš i u vchodu)' : ''}`),
        (o.osoba || o.telefon) ? h('div', { class: 'muted' }, [o.osoba, o.telefon].filter(Boolean).join(' · ')) : null,
        h('div', { class: 'row', style: 'margin-top:8px' },
          showHidden
            ? h('button', { class: 'btn grow', type: 'button', onclick: () => { delete skryte[o.id]; store.set('revize.skryte', skryte); fill(); } }, 'Vrátit do seznamu')
            : h('button', { class: 'btn primary grow', type: 'button', onclick: () => openDraft(o) }, draft ? 'Pokračovat v checklistu' : 'Nový checklist'),
          tel ? h('a', { class: 'btn', href: tel }, 'Volat') : null,
          tel ? h('a', { class: 'btn', href: smsHref(o.telefon) }, 'SMS') : null));
    }));
    if (!items.length && seznam.polozky.length) listBox.append(h('p', { class: 'muted' }, showHidden ? 'Žádné odebrané objekty.' : 'Nic neodpovídá filtru.'));
    if (items.length > 300) listBox.append(h('p', { class: 'muted' }, `Zobrazeno prvních 300 z ${items.length} – upřesni hledání.`));
    if (hiddenCount || showHidden) {
      listBox.append(h('p', { class: 'muted', style: 'text-align:center' }, h('a', { href: '#/', onclick: e => {
        e.preventDefault(); sessionStorage.setItem('revize.skryte', showHidden ? '0' : '1'); renderList(); } },
        showHidden ? '‹ Zpět na seznam' : `Odebrané objekty (${hiddenCount})`)));
    }
  }
  function hideObject(o) {
    const draft = drafts['obj:' + o.id];
    const unsaved = draft && draft.stav !== 'ulozeno';
    if (!confirm(`Odebrat ${o.adresa} ze seznamu?` + (unsaved ? '\n\nRozpracovaný checklist k objektu se smaže (není uložený do OneDrive).' : draft ? '\n\nUložený checklist se z telefonu smaže.' : '')
      + '\n\nObjekt najdeš dole v „Odebrané objekty“.')) return;
    skryte[o.id] = o.termin || ''; store.set('revize.skryte', skryte);
    if (draft) { delete drafts[draft.id]; saveDrafts(true); }
    renderList();
  }
  fill();

  const fab = h('div', { class: 'fab' },
    od.connected()
      ? h('button', { class: 'btn primary', type: 'button', onclick: syncOneDrive }, 'Synchronizovat')
      : h('button', { class: 'btn', type: 'button', onclick: () => filePicker('.json,application/json', importList) }, 'Načíst seznam'),
    h('button', { class: 'btn' + (od.connected() ? '' : ' primary'), type: 'button', onclick: () => openDraft(null) }, '+ Objekt mimo seznam'));
  document.body.append(fab);
  app.append(h('p', { class: 'muted', style: 'text-align:center' },
    od.connected() ? [h('a', { href: '#/', onclick: e => { e.preventDefault(); filePicker('.json,application/json', importList); } }, 'Načíst seznam ze souboru'), ' · '] : null,
    h('a', { href: '#/o-aplikaci' }, 'O aplikaci, OneDrive a zálohy')));
}

function xButton(label, onClick) {
  return h('button', { class: 'xbtn', type: 'button', 'aria-label': label, title: label,
    onclick: e => { e.stopPropagation(); onClick(); } }, '✕');
}
function deleteDraft(draft) {
  const warn = draft.stav === 'ulozeno' ? '' : '\n\nPOZOR: checklist není uložený do OneDrive – zápis se ztratí.';
  if (!confirm(`Smazat checklist ${draft.adresa || '(bez adresy)'} z telefonu?${warn}`)) return;
  delete drafts[draft.id]; saveDrafts(true); renderList();
}

function openDraft(source) {
  const id = source ? 'obj:' + source.id : null;
  let draft = id && drafts[id];
  if (!draft) { draft = ensureDraft(newDraft(source)); drafts[draft.id] = draft; saveDrafts(true); }
  location.hash = '#/c/' + encodeURIComponent(draft.id);
}

/* --- formulářové prvky --- */
function field(label, obj, key, draft, opts = {}) {
  const input = h(opts.multiline ? 'textarea' : 'input', {
    type: opts.multiline ? null : (opts.type || 'text'), value: obj[key] ?? '', inputmode: opts.inputmode || null,
    placeholder: opts.placeholder || null, autocomplete: 'off', autocapitalize: opts.caps || 'sentences',
    oninput: e => { obj[key] = e.target.value; touch(draft); if (opts.onchange) opts.onchange(); },
  });
  return h('label', { class: 'field' }, h('span', { class: opts.required ? 'req' : null }, label), input);
}
function seg(options, value, onPick, extraClass) {
  return h('div', { class: 'seg' + (options.length === 2 ? ' two' : options.length === 5 ? ' five' : ''), role: 'group' },
    options.map(([v, t]) => h('button', { type: 'button', 'aria-pressed': String(value === v), class: v === 'zmeny' ? 'on-zmeny' : null,
      onclick: () => onPick(value === v && extraClass === 'toggle' ? null : v) }, t)));
}
function section(draft, key, title, body, openByDefault) {
  draft._open = draft._open || {};
  const det = h('details', { class: 'sec', open: draft._open[key] ?? openByDefault, ontoggle: e => { draft._open[key] = e.target.open; } },
    h('summary', null, title), h('div', { class: 'body' }, body));
  return det;
}
function removeBtn(onRemove) {
  return h('button', { class: 'btn small danger', type: 'button', onclick: () => { if (confirm('Odstranit tento řádek?')) onRemove(); } }, 'Odebrat');
}

/* Objekty vedené pro celý dům (rozsah čísel), ke kterým vchod patří: jeden společný checklist. */
function sharedDrafts(draft, src) {
  if (!src || !Array.isArray(src.spolecne) || draft.novy_objekt === true) return [];
  const out = [];
  for (const s of src.spolecne) {
    const target = seznam.polozky.find(o => o.id === s.id) || seznam.polozky.find(o => o.adresa === s.adresa);
    if (!target) continue;
    // Do seznamu rozpracovaných se uloží až po první změně (touch), do té doby jen v paměti.
    const pending = sharedDrafts.pending || (sharedDrafts.pending = {});
    let shared = drafts['obj:' + target.id] || pending['obj:' + target.id];
    if (!shared) {
      shared = pending['obj:' + target.id] = ensureDraft(newDraft(target));
      shared.datum = draft.datum;
    }
    ensureDraft(shared);
    if (shared.stav !== 'ulozeno' && shared.datum !== draft.datum) shared.datum = draft.datum;  // stejný den jako vchod
    out.push(shared);
  }
  return out;
}
function sharedEntrances(sharedSrc) {
  return seznam.polozky.filter(o => (o.spolecne || []).some(s => s.id === sharedSrc.id));
}
function sharedStarted(shared) {
  const src = sourceOf(shared);
  return ROLES.some(([role]) => (src && src.casti || []).includes(role) && shared.stavy[role] !== 'nejasne');
}

/* Hydranty, nouzové osvětlení a ostatní PBZ – stejné sekce pro objekt i pro „celý dům“ u vchodu. */
function deviceSections(draft, src, rerender) {
  const out = [];
  const npred = novyPred(draft);
  if (npred && npred.hydranty && draft.stavy.hydranty === 'zmeny') {
    out.push(section(draft, 'hydranty', `B2 – Hydranty – nový objekt (${draft.hyd_mereni.length})`, novyHydEditor(draft, npred, rerender), true));
  }
  // B2 – hydranty: měření (Příloha 2) a Závěr
  else if (draft.stavy.hydranty === 'zmeny' || draft.stavy.hydranty === 'beze_zmen') {
    const hyd = src && src.hydranty;
    const measured = new Set(draft.hyd_mereni.map(m => norm(m.umisteni) + '|' + norm(m.id)));
    out.push(section(draft, 'hydranty', `B2 – Hydranty – měření (${draft.hyd_mereni.length})`, [
      h('p', { class: 'muted' }, 'Tlaky v MPa, průtok v l/s, s desetinnou čárkou. Měření lze zapsat i při stavu Beze změn.'),
      hyd && hyd.priloha2 && hyd.priloha2.length ? [
        h('div', { style: 'font-weight:650;margin:6px 0 2px' }, 'Hydranty v Příloze 2 (minulé hodnoty)'),
        hyd.priloha2.map(row => h('div', { class: 'item' + (measured.has(norm(row.umisteni) + '|' + norm(row.id)) ? ' picked' : '') },
          h('div', { class: 'item-head' }, h('span', null, `${row.id ? row.id + ' ' : ''}${row.umisteni}`),
            h('button', { class: 'btn small', type: 'button', onclick: () => {
              const m = { id: row.id, umisteni: row.umisteni }; for (const k of MEASURE_KEYS) m[k] = '';
              for (const k of MEASURE_KEYS) if (row[k] !== undefined) m[k] = '';
              m._sloupce = MEASURE_KEYS.filter(k => row[k] !== undefined);
              draft.hyd_mereni.push(m); rerender(); } }, 'Zapsat měření')),
          h('div', { class: 'muted' }, MEASURE_KEYS.filter(k => row[k] !== undefined).map(k => `${MEASURE_NAME[k].split(' (')[0]} ${row[k] || '—'}`).join(' · ')))),
      ] : null,
      draft.hyd_mereni.map((m, i) => {
        const keys = m._sloupce && m._sloupce.length ? m._sloupce : ['tlak_p1', 'tlak_p2', 'tlak_rozdil', 'prutok'];
        return h('div', { class: 'item' },
          h('div', { class: 'item-head' }, `Měření ${i + 1}`, removeBtn(() => { draft.hyd_mereni.splice(i, 1); rerender(); })),
          h('div', { class: 'grid2' }, field('Číslo hydrantu', m, 'id', draft), field('Umístění', m, 'umisteni', draft, { required: true })),
          h('div', { class: 'grid2' }, keys.map(k => field(MEASURE_NAME[k], m, k, draft, { inputmode: 'decimal' }))));
      }),
      h('button', { class: 'btn', type: 'button', onclick: () => { draft.hyd_mereni.push({ id: '', umisteni: '', tlak_vytok: '', tlak_p1: '', tlak_p2: '', tlak_rozdil: '', prutok: '' }); rerender(); } }, '+ Měření jiného hydrantu'),
      draft.hyd_zavady.map((z, i) => h('div', { class: 'item' },
        h('div', { class: 'item-head' }, `Starý zápis závady ${i + 1} (nelze zapsat – přepiš do Závěru)`, removeBtn(() => { draft.hyd_zavady.splice(i, 1); rerender(); })),
        h('p', { class: 'muted' }, z))),
    ], true));
    if (hyd && hyd.zaver) out.push(section(draft, 'hyd_zaver', 'B2 – Hydranty – Závěr', zaverEditor(draft, hyd.zaver, rerender), draft.stavy.hydranty === 'zmeny'));
    else if (draft.stavy.hydranty === 'zmeny') out.push(h('p', { class: 'muted card' }, 'Závěr hydrantů tohoto objektu není v exportu – závady zapiš na PC.'));
  }

  // C – nouzové osvětlení podle seznamu a dokladu
  if (draft.stavy.nouzove_osvetleni === 'zmeny' && src && src.no) {
    out.push(section(draft, 'no', 'C – Nouzové osvětlení (seznam a doklad)', noEditor(draft, src.no, rerender), true));
  }

  // C – ostatní PBZ
  for (const role of PBZ) {
    if (draft.stavy[role] !== 'zmeny') continue;
    if (npred && npred.pbz[role]) { out.push(section(draft, role, `${ROLE_NAME[role]} – nový objekt`, novyPbzEditor(draft, npred, role, rerender), true)); continue; }
    if (role === 'nouzove_osvetleni' && src && src.no && !draft.pbz[role].length) continue;
    out.push(section(draft, role, `${ROLE_NAME[role]} (${draft.pbz[role].length})`, [
      draft.pbz[role].map((r, i) => h('div', { class: 'item' },
        h('div', { class: 'item-head' }, `Změna ${i + 1}`, removeBtn(() => { draft.pbz[role].splice(i, 1); rerender(); })),
        h('div', { class: 'grid2' }, field('Číslo / ID', r, 'id', draft), field('Umístění', r, 'umisteni', draft)),
        field('Popis závady nebo změny', r, 'popis', draft, { required: true, multiline: true }))),
      h('button', { class: 'btn', type: 'button', onclick: () => { draft.pbz[role].push({ id: '', umisteni: '', popis: '' }); rerender(); } }, '+ Přidat změnu'),
    ], true));
  }

  return out;
}

function renderChecklist(draft) {
  clear(); setTitle(draft.adresa || 'Nový checklist', true);
  // Pozice se čte až v okamžiku klepnutí – jinak by stránka odskočila na místo z minulého vykreslení.
  const rerender = () => { const y = window.scrollY; touch(draft); renderChecklist(draft); window.scrollTo(0, y); };

  // Hlavička: kontakt a termín z naposledy nahraného seznamu (draft.zdroj je stav z doby založení)
  const src = (draft.zdroj && seznam.polozky.find(o => o.id === draft.zdroj.id)) || draft.zdroj;
  app.append(h('div', { class: 'card' },
    src ? h('p', { class: 'muted', style: 'margin:0 0 6px' }, `${src.zkratka || src.zakaznik} · ${src.sada || ''} · termín ${src.termin || '—'}`,
      (src.osoba || src.telefon) ? h('br') : null, [src.osoba, src.telefon, src.email].filter(Boolean).join(' · ')) : null,
    field('Datum kontroly', draft, 'datum', draft, { type: 'date', required: true }),
    field('Adresa domu', draft, 'adresa', draft, { required: true, onchange: () => setTitle(draft.adresa || 'Nový checklist', true) }),
    h('div', { class: 'grid2' },
      field('IČO vlastníka', draft, 'ico', draft, { inputmode: 'numeric', placeholder: 'nepovinné' }),
      h('div', null, h('label', { class: 'field' }, h('span', { class: 'req' }, 'Objekt'),
        seg([[false, 'Stávající'], [true, 'Nový']], draft.novy_objekt, v => { draft.novy_objekt = v; rerender(); })))),
    field('Vlastník (SVJ, BD, firma)', draft, 'subjekt', draft, { required: true }),
    draft.novy_objekt === true ? novyPredlohaCard(draft, rerender) : null));
  const npred = novyPred(draft);

  // Rozsah: jen části, které objekt má (podle dokumentů z exportu); ostatní schované jako „Netýká se“.
  const casti = src && Array.isArray(src.casti) && src.casti.length && draft.novy_objekt !== true ? src.casti : null;
  const scopeRow = ([role, name]) => h('div', { class: 'scope' }, h('div', { class: 'name' }, name),
    seg(STATES, draft.stavy[role], v => { draft.stavy[role] = v; draft._open = draft._open || {}; if (v === 'zmeny') draft._open[role] = true; rerender(); }));
  const shown = ROLES.filter(([role]) => !casti || casti.includes(role) || draft.stavy[role] !== 'netyka_se');
  const hidden = ROLES.filter(r => !shown.includes(r));
  const open = shown.filter(([role]) => draft.stavy[role] === 'nejasne');
  app.append(h('div', { class: 'card' }, h('div', { style: 'font-weight:650;margin-bottom:4px' }, 'Rozsah kontroly'),
    h('p', { class: 'muted', style: 'margin:0 0 6px' }, casti
      ? 'Zobrazené jsou jen části, pro které má objekt dokument. „Změny“ otevře zápis změn níže.'
      : 'U každé části zvol stav. „Změny“ otevře zápis změn níže.'),
    shown.map(scopeRow),
    open.length ? h('button', { class: 'btn', type: 'button', style: 'margin-top:8px;width:100%', onclick: () => {
      for (const [role] of open) draft.stavy[role] = 'beze_zmen'; rerender(); } }, `Zbývající ${open.length === 1 ? 'část' : 'části'} beze změn`) : null,
    hidden.length ? h('details', { style: 'margin-top:8px' },
      h('summary', { class: 'muted' }, `Další části – v dokumentech objektu nenalezeny, Netýká se (${hidden.length})`),
      hidden.map(scopeRow)) : null));

  // Části vedené pro celý dům (např. hydranty „Bráfova 23 - 29“): vyplní se tady, jednou pro všechny vchody.
  for (const shared of sharedDrafts(draft, src)) {
    const sSrc = sourceOf(shared);
    const redraw = () => { const y = window.scrollY; touch(shared); renderChecklist(draft); window.scrollTo(0, y); };
    const roles = ROLES.filter(([role]) => (sSrc.casti || []).includes(role));
    const others = sharedEntrances(sSrc).filter(o => o.id !== (src && src.id)).map(o => o.adresa);
    app.append(h('div', { class: 'card shared' },
      h('div', { style: 'font-weight:650' }, `Pro celý dům: ${sSrc.adresa}`),
      h('p', { class: 'muted', style: 'margin:2px 0 6px' }, 'Vyplní se jednou a platí pro všechny vchody'
        + (others.length ? ` (i ${others.join(', ')})` : '') + '. Uloží se jako samostatný checklist spolu s tímto vchodem.'),
      roles.map(([role, name]) => h('div', { class: 'scope' }, h('div', { class: 'name' }, name),
        seg(STATES, shared.stavy[role], v => { shared.stavy[role] = v; shared._open = shared._open || {}; if (v === 'zmeny') shared._open[role] = true; redraw(); })))));
    deviceSections(shared, sSrc, redraw).forEach(node => app.append(node));
  }

  // Nový objekt s předlohou správce: celý blok Kontroly PO (A, B, hydranty, C – seznam VPPO a PBZ, D)
  if (draft.stavy.po === 'zmeny' && npred && npred.po) {
    app.append(section(draft, 'po', 'A–D – Kontrola PO (nový objekt)', novyPoEditor(draft, npred, rerender), true));
  }
  // A, C, D podle řádků Kontroly PO z exportu
  if (draft.stavy.po === 'zmeny' && src && src.po && !npred) {
    app.append(section(draft, 'po', 'A – Prohlídka PO (řádky protokolu)', poRows(draft, src.po, rerender), true));
    if (src.po.c !== null) {
      app.append(section(draft, 'po_c', 'C – Zjištěné skutečnosti, jiné závady', linesEditor(draft, 'po_c', src.po.c, 'po_c', rerender,
        `Řádky se zapíší do sekce C protokolu (místa na ${src.po.c_poli} ${src.po.c_poli === 1 ? 'řádek' : 'řádky'}; delší text pokračuje v posledním).`), true));
    }
    if (src.po.d !== null) {
      app.append(section(draft, 'po_d', src.po.c === null ? 'D – Zjištěné skutečnosti, opatření a termíny' : 'D – Navržená opatření a termíny',
        linesEditor(draft, 'po_d', src.po.d, 'po_d', rerender, 'Řádky nahradí obsah sekce D v protokolu. Smaž, co už neplatí.'), true));
    }
  }
  // A + D (objekt bez řádků Kontroly PO v exportu – zápis do D jako dříve)
  if (draft.stavy.po === 'zmeny' && !(src && src.po) && !(npred && npred.po)) {
    app.append(section(draft, 'po', 'A – Prohlídka PO a D – ostatní', [
      h('label', { class: 'field' }, h('span', null, 'Minulé závady odstraněny'),
        seg([[true, 'Ano'], [false, 'Ne']], draft.po.minule, v => { draft.po.minule = v; rerender(); }, 'toggle')),
      draft.po.zavady.map((z, i) => h('div', { class: 'item' },
        h('div', { class: 'item-head' }, `Nová závada ${i + 1}`, removeBtn(() => { draft.po.zavady.splice(i, 1); rerender(); })),
        field('Umístění', z, 'umisteni', draft), field('Popis závady', z, 'popis', draft, { required: true, multiline: true }),
        field('Opatření a termín', z, 'opatreni', draft))),
      h('button', { class: 'btn', type: 'button', onclick: () => { draft.po.zavady.push({ umisteni: '', popis: '', opatreni: '' }); rerender(); } }, '+ Přidat závadu'),
      h('hr', { style: 'border:0;border-top:1px solid var(--line);margin:14px 0' }),
      h('label', { class: 'field' }, h('span', null, 'D – Chybí PHP'), seg([[true, 'Ano'], [false, 'Ne']], draft.d.chybi_php, v => { draft.d.chybi_php = v; rerender(); }, 'toggle')),
      h('label', { class: 'field' }, h('span', null, 'D – Chybí bezpečnostní značení'), seg([[true, 'Ano'], [false, 'Ne']], draft.d.chybi_znaceni, v => { draft.d.chybi_znaceni = v; rerender(); }, 'toggle')),
      field('D – Jiné', draft.d, 'jine', draft, { multiline: true }),
    ], true));
  }

  // B – PHP
  const inv = inventoryOf(draft);
  if (draft.stavy.php === 'zmeny' || (inv && draft.stavy.php === 'beze_zmen')) {
    const actions = Object.keys(PHP_ACTIONS).filter(a => a !== 'EVIDENCE' || draft.novy_objekt === true);
    const linked = new Set(inv ? inv.pristroje.map(u => u.vyrobni_cislo.trim().toLowerCase()) : []);
    const isLinked = row => !!row.ev && linked.has(row.ev);
    app.append(section(draft, 'php', `B – Hasicí přístroje (${inv ? inv.pristroje.length + ' v evidenci, ' : ''}${draft.php.length} ${draft.php.length === 1 ? 'změna' : 'změn'})`, [
      inv ? phpInventory(draft, inv, rerender) : null,
      !inv && draft.novy_objekt !== true && src && src.php_chyba
        ? h('p', { class: 'muted' }, h('b', null, 'Seznam PHP není k dispozici: '), src.php_chyba, ' Akce zapiš podle výrobního čísla.') : null,
      draft.novy_objekt === true ? h('p', { class: 'muted' }, 'U nového objektu zapiš všechny stávající přístroje jako „Evidence stávajícího“. Servis (TZ, oprava…) zapiš zvlášť.') : null,
      inv ? h('div', { style: 'font-weight:650;margin:14px 0 2px' }, 'Nové přístroje a další akce') : null,
      draft.php.map((row, i) => {
        if (isLinked(row)) return null;
        const full = FULL_ROW.includes(row.akce);
        return h('div', { class: 'item' },
          h('div', { class: 'item-head' }, `${i + 1}. ${PHP_ACTIONS[row.akce]}`, removeBtn(() => { draft.php.splice(i, 1); rerender(); })),
          h('label', { class: 'field' }, h('span', null, 'Akce'),
            h('select', { onchange: e => { row.akce = e.target.value; rerender(); } }, actions.map(a => h('option', { value: a, selected: a === row.akce }, PHP_ACTIONS[a])))),
          field(row.akce === 'VYM' ? 'Výrobní číslo původního PHP' : 'Výrobní číslo', row, 'vyrobni_cislo', draft, { required: true, caps: 'none', placeholder: 'např. 049176/11' }),
          row.akce === 'VYM' ? field('Výrobní číslo nového PHP', row, 'nove_vyrobni_cislo', draft, { required: true, caps: 'none' }) : null,
          full ? h('label', { class: 'field' }, h('span', { class: 'req' }, 'Druh'),
            h('select', { onchange: e => { row.druh = e.target.value; touch(draft); } }, [h('option', { value: '' }, '— vyber —'), ...DRUHY.map(d => h('option', { value: d, selected: d === row.druh }, d))])) : null,
          full ? h('div', { class: 'grid2' }, field('Výrobce', row, 'vyrobce', draft, { required: row.akce !== 'EVIDENCE' }),
            field('Model / typ', row, 'model', draft, { required: row.akce !== 'EVIDENCE' })) : null,
          full ? h('div', { class: 'grid2' }, field('Rok výroby', row, 'rok_vyroby', draft, { inputmode: 'numeric', required: row.akce === 'EVIDENCE' }),
            row.akce === 'EVIDENCE' ? field('Rok poslední TZ', row, 'rok_tz', draft, { inputmode: 'numeric', required: true }) : h('div')) : null,
          full ? field('Umístění', row, 'umisteni', draft, { required: row.akce !== 'EVIDENCE' }) : null,
          (row.akce === 'TZ' || row.akce === 'OPR') ? h('p', { class: 'muted', style: 'margin:4px 0 0' }, `Provedeno v roce kontroly (${yearOf(draft)}).`) : null);
      }),
      h('button', { class: 'btn', type: 'button', onclick: () => {
        draft.php.push({ akce: draft.novy_objekt === true ? 'EVIDENCE' : inv ? 'NOVY' : 'TZ', vyrobni_cislo: '', nove_vyrobni_cislo: '', druh: '', vyrobce: '', model: '', rok_vyroby: '', rok_tz: '', umisteni: '' });
        if (draft.stavy.php !== 'zmeny') draft.stavy.php = 'zmeny';
        rerender(); } }, inv ? '+ Nový přístroj' : '+ Přidat přístroj / akci'),
    ], true));
  }

  deviceSections(draft, src, rerender).forEach(node => app.append(node));

  // Kontrola a uložení
  const result = h('div');
  app.append(result);
  app.append(h('p', { style: 'text-align:center' },
    h('button', { class: 'btn danger small', type: 'button', onclick: () => {
      if (!confirm('Smazat tento checklist z telefonu?')) return;
      delete drafts[draft.id]; saveDrafts(true); location.hash = '#/';
    } }, 'Smazat checklist')));
  document.body.append(h('div', { class: 'fab' },
    h('button', { class: 'btn primary', type: 'button', onclick: () => showResult(draft, result) }, 'Zkontrolovat a uložit JSON')));
}

/* ------------------------------------------------------------------ nový objekt (etapa 5)
   Stejný formulář jako na PC (qt_novy_objekt): řádky a sloupce z předlohy správce, kterou přibalí Export pro telefon
   (seznam.novy_objekt). Kontrola PO vždy v jednotném tvaru (C – seznam VPPO a PBZ s P/N, D – zjištění a opatření).
   Výsledek = checklist CL-A4-02 nového objektu (blok PO, evidence PHP, formulář hydrantů a PBZ); na PC se připojí
   v Nové objekty › Připojit JSON a formulář Údaje zařízení se z něj předvyplní ke kontrole. */
const NO_JINY = '– jiný popis (napiš níže) –';
function novyData() { return (seznam && seznam.novy_objekt) || null; }
function novyK() { return (novyData() || {}).konstanty || {}; }
function novyPred(draft) {
  if (draft.novy_objekt !== true) return null;
  const list = (novyData() || {}).spravci || [];
  return list.find(m => m.slozka === draft.predloha) || null;
}
function ensureNovy(draft) {
  draft.nb = draft.nb || { a: {}, b: {}, b_auto: true, b_kontrola: 'P', h: {}, c: null, c_jine: { nazev: '', stav: 'P' }, d: '' };
  draft.nh = draft.nh || { typ: '25D', proudnice: '10', p1: {}, vysledek: 'odpovídá', text: '', doporuceni: '' };
  draft.npbz = draft.npbz || {};
  draft.nno = draft.nno || [];
  draft.nuc = draft.nuc || [];
  return draft;
}
const isGood = text => (novyK().dobre || []).includes(norm(text));
/* Nabídka řádku A (stejná jako na PC _volby_radku): [{text, volby, stav, kat}]; první = výchozí „bez závad“. */
function novyVolbyA(row) {
  const pairs = row.dvojice, good = pairs.map(([a, b]) => (isGood(b) ? 1 : 0));
  const cat = (seznam.katalog || []).filter(i => i.k === 'po_a' && (!i.r || norm(i.r) === norm(row.nazev))).map(i => i.t);
  const out = [];
  if (row.text || pairs.length === 1) {
    const bad = 1 - good[0];
    out.push({ text: pairs[0][good[0]], volby: [good[0]], stav: '', kat: '' });
    if (row.text) {
      for (const t of cat) out.push({ text: `${pairs[0][bad]}: ${t}`, volby: [bad], stav: '', kat: t });
      out.push({ text: `${pairs[0][bad]} ${NO_JINY}`, volby: [bad], stav: '', kat: null });
    } else out.push({ text: pairs[0][bad], volby: [bad], stav: '', kat: '' });
    for (const s of row.stavy || []) out.push({ text: s, volby: pairs.map(() => null), stav: s, kat: '' });
    return out;
  }
  for (const c0 of [good[0], 1 - good[0]]) {
    const o0 = pairs[0][c0];
    if (['nejsou', 'neni'].includes(norm(o0))) { out.push({ text: o0, volby: [c0, ...pairs.slice(1).map(() => null)], stav: '', kat: '' }); continue; }
    let combos = [[]];
    pairs.slice(1).forEach((p, k) => { combos = combos.flatMap(c => [[...c, good[k + 1]], [...c, 1 - good[k + 1]]]); });
    for (const c of combos) out.push({ text: [o0, ...c.map((x, k) => pairs[k + 1][x])].join(', '), volby: [c0, ...c], stav: '', kat: '' });
  }
  return out;
}
/* B – přenosné hasicí přístroje podle evidence (Strojovna výtahu / Sklepní prostory / Ostatní). */
function novyBzEvidence(draft, places) {
  const groups = Object.fromEntries(places.map(p => [p, []]));
  const other = places.find(p => norm(p).startsWith('ostatn')) || places[places.length - 1];
  const rules = [[['strojovn', 'vytah'], places.find(p => norm(p).includes('strojovn'))], [['sklep'], places.find(p => norm(p).includes('sklep'))]];
  for (const r of draft.php.filter(x => x.akce === 'EVIDENCE')) {
    if (!String(r.model || '').trim() && !String(r.umisteni || '').trim()) continue;
    const where = norm(r.umisteni);
    const target = (rules.find(([keys, p]) => p && keys.some(k => where.includes(k))) || [null, other])[1];
    groups[target].push(String(r.model || '').trim());
  }
  return groups;
}
function novyFloors(draft) {
  const floors = [];
  for (const m of draft.hyd_mereni) for (const f of String(m.umisteni || '').match(/\d+\s*\.\s*(?:NP|PP)/gi) || []) floors.push(f.replace(/\s/g, '').toUpperCase());
  return [...new Set(floors)].join(', ');
}
function novyC(draft) {
  const K = novyK(), nb = draft.nb;
  if (!nb.c) {   // výchozí: zařízení, která má objekt v rozsahu kontroly
    nb.c = {};
    for (const name of K.zarizeni_c || []) { const role = (K.zarizeni_c_klic || {})[name]; if (role && draft.stavy[role] === 'zmeny') nb.c[name] = 'P'; }
  }
  return nb.c;
}
function novyBlokPo(draft, pred, errors) {
  const nb = draft.nb, po = pred.po, K = novyK();
  const a = po.a.map(row => {
    const opts = novyVolbyA(row), st = nb.a[row.nazev] || { i: 0, text: '' }, o = opts[st.i] || opts[0];
    const out = { nazev: row.nazev, dvojice: row.dvojice, volby: [...o.volby], stav: o.stav, text: '', umisteni: '' };
    if (row.umisteni) out.umisteni = String(st.text || '').trim();
    else if (row.text && o.volby[0] !== null && !isGood(row.dvojice[0][o.volby[0]])) {
      out.text = String(st.text || '').trim();
      if (!out.text) errors.push(`A – ${row.nazev}: doplň popis závady.`);
    }
    return out;
  });
  const places = po.b.map(x => x.misto), auto = nb.b_auto && draft.stavy.php === 'zmeny', groups = auto ? novyBzEvidence(draft, places) : null;
  const b = po.b.map(({ misto }) => {
    const st = nb.b[misto] || { sel: 'NE', typ: '', k: 'P' };
    let sel = st.sel, typ = st.typ, k = st.k;
    if (auto && (sel === 'ANO' || sel === 'NE')) { sel = groups[misto].length ? 'ANO' : 'NE'; typ = [...new Set(groups[misto].filter(Boolean))].join(', '); k = 'P'; }
    const yes = sel === 'ANO';
    if (yes && !String(typ || '').trim()) errors.push(`B – ${misto}: doplň typ hasicího přístroje.`);
    return { misto, ano: yes, typ: yes ? String(typ || '').trim() : '', stav: yes || sel === 'NE' ? '' : sel, kontrola: yes ? k : null };
  });
  let hh = null;
  if (po.hydranty) {
    const st = nb.h, yes = (st.ano ?? (draft.stavy.hydranty === 'zmeny')) === true;
    const typ = st.typ || (['25D', '52C'].includes(draft.nh.typ) ? draft.nh.typ : '25D');
    const kontrola = st.kontrola || 'provedena';
    hh = { ano: yes, typ: yes && typ !== 'nevyplněno' ? typ : null, kontrola: yes && kontrola !== 'nevyplněno' ? kontrola : null,
      podlazi: yes ? String(st.podlazi || novyFloors(draft)).trim() : '' };
  }
  const c = [];
  if (po.c_seznam) {
    const chosen = novyC(draft);
    for (const name of Object.keys(chosen)) c.push({ nazev: name, stav: chosen[name] });
    if (String(nb.c_jine.nazev || '').trim()) c.push({ nazev: nb.c_jine.nazev.trim(), stav: nb.c_jine.stav || 'P' });
  }
  const d = String(nb.d || '').split(/\s+/).filter(Boolean).join(' ');
  const cText = c.map(i => `${i.nazev} (${i.stav})`).join(', ');
  if (cText.length > (K.limit_c || 220) * 2 || d.length > (K.limit_d || 420) * 2) errors.push('Kontrola PO: text části C nebo D se nevejde na jednu stranu protokolu.');
  return { a, b, b_kontrola: po.b.length ? (nb.b_kontrola || null) : null, h: hh, c, d };
}
const fmtNum = (v, d) => v.toFixed(d).replace('.', ',');
const parseNum = t => {
  const s = String(t ?? '').trim().replace(',', '.');
  if (!s) return null;
  if (!/^\d{1,3}(\.\d{1,4})?$/.test(s)) throw new Error('neplatné číslo „' + t + '“');
  return Number(s);
};
function novyKHyd(draft, pred) {
  const K = novyK();
  return pred.hydranty.tabulka === 'A' ? K.k_typ[draft.nh.typ] : K.k_proudnice[draft.nh.proudnice];
}
/* Q = k·√p a dopočet chybějících hodnot (stejně jako hydranty_novy.dopocti). */
function novyDopocti(tab, k, row) {
  const out = { ...row };
  if (tab === 'A') {
    const p1 = parseNum(row.tlak_p1), q = parseNum(row.prutok);
    let p2 = parseNum(row.tlak_p2);
    if (p2 === null && q !== null) { p2 = Math.round((q / k) ** 2 * 100) / 100; out.tlak_p2 = fmtNum(p2, 2); }
    if (q === null && p2 !== null) out.prutok = fmtNum(k * Math.sqrt(p2), 3);
    if (p1 !== null && p2 !== null && !String(row.tlak_rozdil || '').trim()) out.tlak_rozdil = fmtNum(Math.max(p1 - p2, 0), 2);
  } else {
    const p = parseNum(row.tlak_vytok), q = parseNum(row.prutok);
    if (p === null && q !== null) out.tlak_vytok = fmtNum((q / k) ** 2, 2);
    if (q === null && p !== null) out.prutok = fmtNum(k * Math.sqrt(p), 2);
  }
  return out;
}
const HYD_KEYS = { A: ['tlak_p1', 'tlak_p2', 'tlak_rozdil', 'prutok'], B: ['tlak_vytok', 'prutok'] };
const HYD_INPUT = { A: ['tlak_p1', 'tlak_p2', 'prutok'], B: ['tlak_vytok', 'prutok'] };
const P1_HLAVNI = [['objekt', 'Objekt'], ['okres', 'Pracovní okres vodáren'], ['zdroj', 'Zdroj požární vody'], ['dn', 'DN rozvodu (nepovinné)'],
  ['typ_d', 'Hydrant. systém typu D (např. D25, 30 m, pr. ekv. 10 mm)'], ['pocet_d', 'Počet D (prázdné = podle měření)'],
  ['typ_c', 'Hydrant. systém typu C (např. C52)'], ['pocet_c', 'Počet C']];
const P1_DALSI = [['suchovod', 'Požární potrubí (suchovod)'], ['pocet_suchovod', 'Počet suchovodů'], ['stanice', 'Tlaková zvyšovací stanice'],
  ['nadzemni', 'Vnější – nadzemní hydrant'], ['pocet_nadzemni', 'Počet nadzemních'], ['podzemni', 'Vnější – podzemní hydrant'],
  ['pocet_podzemni', 'Počet podzemních'], ['stanice_vnejsi', 'Vnější tlaková stanice'], ['dokumentace', 'Druh dokumentace'],
  ['zpracovatel', 'Zpracovatel, datum zprac.'], ['uvedeni', 'Uvedení do provozu'], ['posledni_datum', 'Poslední kontrola (datum)'],
  ['posledni_kdo', 'Poslední kontrolu provedl'], ['zavady_odstraneny', 'Závady z posl. kontroly odstraněny']];
function novyP1Default(pred, key) {
  const d = pred.hydranty.priloha1 || {};
  return { objekt: d.objekt || 'Bytový dům', okres: d.okres || '', zdroj: d.zdroj || 'veřejný vodovodní řad', dokumentace: 'nezjištěno',
    zpracovatel: 'nezjištěno', uvedeni: 'nezjištěno', rozvod: 'větvový' }[key] ?? '';
}
function novyP1Popis(draft, pred) {
  const nh = draft.nh;
  if (pred.hydranty.tabulka === 'B') return { typ_d: `D${nh.dn || '25'}, ${nh.hadice || '30'} m, pr. ekv. ${nh.proudnice} mm`, typ_c: '' };
  return nh.typ === '25D' ? { typ_d: 'D25', typ_c: '' } : nh.typ === '52C' ? { typ_d: '', typ_c: 'C52' } : { typ_d: '', typ_c: '' };
}
function novyHydranty(draft, pred, errors) {
  const nh = draft.nh, tab = pred.hydranty.tabulka, K = novyK(), k = novyKHyd(draft, pred), rows = [];
  draft.hyd_mereni.forEach((m, i) => {
    const inputs = HYD_INPUT[tab].map(x => m[x]);
    if (!String(m.umisteni || '').trim() && !inputs.some(v => String(v || '').trim())) return;
    let c;
    try { c = novyDopocti(tab, k, Object.fromEntries(HYD_INPUT[tab].map(x => [x, m[x]]))); }
    catch (e) { errors.push(`Hydrant ${i + 1}: ${e.message}.`); return; }
    if (!String(m.umisteni || '').trim()) errors.push(`Hydrant ${i + 1}: chybí umístění.`);
    if (!c.prutok) errors.push(`Hydrant ${i + 1}: chybí naměřená hodnota.`);
    const row = { id: String(m.id || '').trim(), umisteni: String(m.umisteni || '').trim() };
    for (const key of HYD_KEYS[tab]) if (c[key]) row[key] = c[key];
    rows.push(row);
  });
  if (!rows.length) errors.push('Hydranty: zapiš aspoň jedno měření, nebo zvol Netýká se.');
  const p1 = {};
  for (const [key] of [...P1_HLAVNI, ...P1_DALSI]) {
    const v = nh.p1[key] ?? novyP1Default(pred, key);
    if (String(v).trim()) p1[key] = String(v).trim();
  }
  if (!String(nh.p1.typ_d || '').trim() && !String(nh.p1.typ_c || '').trim()) {   // popis systému podle typu (jako PC)
    const auto = novyP1Popis(draft, pred);
    for (const key of ['typ_d', 'typ_c']) { if (auto[key]) p1[key] = auto[key]; else delete p1[key]; }
  }
  const countKey = ['52C', '75B'].includes(nh.typ) && tab === 'A' ? 'pocet_c' : 'pocet_d';
  if (!p1[countKey]) p1[countKey] = String(rows.length);
  for (const key of ['pocet_d', 'pocet_c', 'pocet_suchovod', 'pocet_nadzemni', 'pocet_podzemni']) {
    if (p1[key] && !/^\d{1,3}$/.test(p1[key])) errors.push(`Hydranty – Příloha 1: ${key.replace('pocet_', 'počet ')} musí být celé číslo.`);
  }
  const rozvod = nh.p1.rozvod ?? 'větvový';
  p1.rozvod = rozvod === 'nevyplněno' ? '' : rozvod;
  let lines, recs;
  if (nh.vysledek === 'odpovídá') { lines = (K.text_odpovida || []).slice(0, pred.hydranty.text_radku); recs = [...(K.doporuceni || [])]; }
  else {
    lines = String(nh.text || '').split('\n').map(x => x.trim()).filter(Boolean);
    recs = String(nh.doporuceni || (K.doporuceni || []).join('\n')).split('\n').map(x => x.trim()).filter(Boolean);
    if (lines.length < 2) errors.push('Hydranty – Závěr: rozepiš závady (na řádky pod první řádek textu závěru).');
  }
  if (rows.length === 1) recs = recs.map(r => (r === (K.doporuceni || [])[0] ? K.doporuceni_1 : r));
  if (lines.length > pred.hydranty.text_radku) errors.push(`Hydranty – Závěr: text má ${lines.length} řádků, předloha jich má ${pred.hydranty.text_radku}.`);
  if (recs.length > pred.hydranty.doporuceni_max) errors.push(`Hydranty – Závěr: předloha má místo pro ${pred.hydranty.doporuceni_max} doporučení.`);
  for (const t of [...lines, ...recs]) if (t.length > 115) errors.push(`Hydranty – Závěr: řádek je delší než 115 znaků: „${t.slice(0, 30)}…“`);
  for (const [key, v] of Object.entries(p1)) if (v.length > 110) errors.push(`Hydranty – Příloha 1: ${key} je delší než 110 znaků.`);
  return { rows, form: { typ: nh.typ, tabulka: tab, proudnice: tab === 'B' ? String(nh.proudnice) : '', priloha1: p1,
    zaver: { vysledek: nh.vysledek, text: lines, doporuceni: recs } } };
}
function novyPbzLabels(pred, role) { return ((pred.pbz[role] || {}).sloupce || []).filter(Boolean); }
function novyPbz(draft, pred, errors) {
  const forms = {}, K = novyK();
  let lights = null, seals = null;
  for (const role of PBZ) {
    if (draft.stavy[role] !== 'zmeny' || !pred.pbz[role]) continue;
    const st = draft.npbz[role] || { radky: [], vysledek: 'bez', zavady: '' }, labels = novyPbzLabels(pred, role), name = ROLE_NAME[role];
    const rows = (st.radky || []).map(r => labels.map((_, i) => String(r[i] || '').trim()))
      .filter(r => r.some((v, i) => v && labels[i] !== 'Č.'))
      .map((r, n) => r.map((v, i) => (labels[i] === 'Č.' && !v ? String(n + 1) : v)));
    const defects = st.vysledek === 'zavady' ? String(st.zavady || '').split(/\s+/).filter(Boolean).join(' ') : '';
    if (st.vysledek === 'zavady' && !defects) errors.push(`${name}: doplň zjištěné závady, nebo zvol „bez závad“.`);
    if (defects.length > 480) errors.push(`${name}: text závad je delší než 480 znaků.`);
    if (rows.length > (K.pbz_max_radku || 60)) errors.push(`${name}: příliš mnoho řádků evidence.`);
    forms[role] = { sloupce: labels, radky: rows, zavady: defects };
    if (role === 'nouzove_osvetleni') {
      lights = [];
      draft.nno.forEach((r, i) => {
        if (!String(r.umisteni || '').trim() && !String(r.typ || '').trim()) return;
        const pocet = String(r.pocet || '1').trim();
        if (!/^\d{1,3}$/.test(pocet) || Number(pocet) < 1) { errors.push(`Seznam NO řádek ${i + 1}: počet musí být kladné celé číslo.`); return; }
        if (!String(r.umisteni || '').trim() || !String(r.stav || '').trim()) errors.push(`Seznam NO řádek ${i + 1}: chybí umístění nebo stav.`);
        lights.push({ umisteni: String(r.umisteni || '').trim(), typ: String(r.typ || '').trim(), stav: String(r.stav || '').trim(), pocet: Number(pocet) });
      });
      if (lights.length > (K.no_radku || 10)) errors.push(`Seznam NO: předloha má ${K.no_radku || 10} řádků.`);
      if (!lights.length) lights = null;
    }
    if (role === 'ucpavky') {
      seals = [];
      draft.nuc.forEach((r, i) => {
        if (!(K.uc_sloupce || []).some(([k]) => !['stav', 'pocet'].includes(k) && String(r[k] || '').trim())) return;
        const pocet = String(r.pocet || '1').trim();
        if (!/^\d{1,3}$/.test(pocet) || Number(pocet) < 1) { errors.push(`Seznam ucpávek řádek ${i + 1}: počet musí být kladné celé číslo.`); return; }
        const item = {};
        for (const [k] of K.uc_sloupce || []) item[k] = k === 'pocet' ? Number(pocet) : String(r[k] || '').trim();
        if (!item.umisteni || !item.stav) errors.push(`Seznam ucpávek řádek ${i + 1}: chybí umístění nebo stav.`);
        seals.push(item);
      });
      if (seals.length > (K.uc_radku || 30)) errors.push(`Seznam ucpávek: nejvýše ${K.uc_radku || 30} řádků.`);
      if (!seals.length) seals = null;
    }
  }
  return { forms, lights, seals };
}
/* Části checklistu nového objektu podle předlohy (pro build i validate). */
function novyParts(draft) {
  const pred = novyPred(draft);
  if (!pred) return null;
  ensureNovy(draft);
  const errors = [], obj = {};
  if (draft.stavy.po === 'zmeny') {
    if (!pred.po) errors.push('Kontrola PO: předloha správce chybí – na PC udělej nový Export pro telefon.');
    else obj.blok = novyBlokPo(draft, pred, errors);
  }
  if (draft.stavy.hydranty === 'zmeny' && pred.hydranty) {
    const hyd = novyHydranty(draft, pred, errors);
    obj.hydranty_mereni = hyd.rows; obj.hydranty_formular = hyd.form;
  }
  const pbz = novyPbz(draft, pred, errors);
  if (Object.keys(pbz.forms).length) obj.pbz_formular = pbz.forms;
  if (pbz.lights) obj.no_seznam_novy = pbz.lights;
  if (pbz.seals) obj.ucpavky_seznam_novy = pbz.seals;
  return { pred, obj, errors };
}

/* --- obrazovky formuláře nového objektu --- */
function selectField(label, options, value, onChange, opts = {}) {
  return h('label', { class: 'field' }, h('span', { class: opts.required ? 'req' : null }, label),
    h('select', { onchange: e => onChange(e.target.value) }, options.map(o => {
      const [v, t] = Array.isArray(o) ? o : [o, o];
      return h('option', { value: v, selected: String(v) === String(value) }, t);
    })));
}
function novyPredlohaCard(draft, rerender) {
  const data = novyData();
  if (!data || !(data.spravci || []).length) {
    return h('p', { class: 'muted' }, 'Formulář nového objektu potřebuje předlohy správců – na PC udělej nový Lhůtník › Export pro telefon a pak Synchronizovat.');
  }
  return [selectField('Správce (předloha protokolů)', [['', '— vyber správce —'], ...data.spravci.map(m => [m.slozka, m.sada])], draft.predloha || '',
    v => { draft.predloha = v; touch(draft); rerender(); }, { required: true }),
  h('p', { class: 'muted', style: 'margin:0' }, 'Řádky formuláře odpovídají posledním protokolům správce. Výchozí stav je „bez závad“, měníš jen odchylky.')];
}
function novyPoEditor(draft, pred, rerender) {
  const nb = ensureNovy(draft).nb, po = pred.po, K = novyK(), out = [];
  out.push(h('div', { style: 'font-weight:650;margin:2px 0' }, 'A – prohlídka společných prostor'));
  for (const row of po.a) {
    const opts = novyVolbyA(row), st = nb.a[row.nazev] = nb.a[row.nazev] || { i: 0, text: '' }, o = opts[st.i] || opts[0];
    const bad = o.volby[0] !== null && !isGood(row.dvojice[0][o.volby[0]]);
    out.push(h('div', { class: 'item' + (st.i ? ' picked' : '') }, h('div', { class: 'item-head' }, row.nazev),
      h('select', { onchange: e => {
        st.i = Number(e.target.value);
        if (row.text && !row.umisteni) st.text = opts[st.i].kat || '';
        touch(draft); rerender();
      } }, opts.map((x, i) => h('option', { value: i, selected: i === st.i }, x.text))),
      row.umisteni ? field('Umístění (např. ve sklepě, na fasádě)', st, 'text', draft) : null,
      row.text && !row.umisteni && bad ? field('Popis závady', st, 'text', draft, { required: true, multiline: true }) : null));
  }
  if (po.b.length) {
    out.push(h('div', { style: 'font-weight:650;margin:12px 0 2px' }, 'B – přenosné hasicí přístroje'));
    out.push(h('label', { class: 'row nowrap', style: 'gap:8px' },
      h('input', { type: 'checkbox', checked: nb.b_auto, onchange: e => { nb.b_auto = e.target.checked; touch(draft); rerender(); } }),
      h('span', null, 'Vyplnit podle evidence hasicích přístrojů (část B níže)')));
    const groups = nb.b_auto && draft.stavy.php === 'zmeny' ? novyBzEvidence(draft, po.b.map(x => x.misto)) : null;
    for (const { misto, stavy } of po.b) {
      const st = nb.b[misto] = nb.b[misto] || { sel: 'NE', typ: '', k: 'P' };
      const autoTyp = groups ? [...new Set(groups[misto].filter(Boolean))].join(', ') : null;
      const shownSel = groups && ['ANO', 'NE'].includes(st.sel) ? (groups[misto].length ? 'ANO' : 'NE') : st.sel;
      out.push(h('div', { class: 'item' }, h('div', { class: 'item-head' }, misto),
        selectField('Stav', ['NE', 'ANO', ...stavy], shownSel, v => { st.sel = v; touch(draft); rerender(); }),
        groups && ['ANO', 'NE'].includes(st.sel)
          ? h('p', { class: 'muted', style: 'margin:0' }, autoTyp ? `Typ podle evidence: ${autoTyp}` : 'V evidenci tu žádný přístroj není.')
          : st.sel === 'ANO' ? [field('Typ PHP', st, 'typ', draft, { required: true }),
            selectField('Kontrola', [['P', '(P) provedena'], ['N', '(N) neprovedena']], st.k, v => { st.k = v; touch(draft); })] : null));
    }
    out.push(selectField('Kontrola PHP', [['P', 'provedena (P)'], ['N', 'neprovedena (N)'], ['', 'nevyplněno']], nb.b_kontrola || '',
      v => { nb.b_kontrola = v || null; touch(draft); }));
  }
  if (po.hydranty) {
    const st = nb.h, yes = (st.ano ?? (draft.stavy.hydranty === 'zmeny')) === true;
    out.push(h('div', { style: 'font-weight:650;margin:12px 0 2px' }, 'Vnitřní hydrantový systém'));
    out.push(selectField('Systém', ['NE', 'ANO'], yes ? 'ANO' : 'NE', v => { st.ano = v === 'ANO'; touch(draft); rerender(); }));
    if (yes) {
      out.push(h('div', { class: 'grid2' },
        selectField('Typ', ['25D', '52C', 'nevyplněno'], st.typ || (['25D', '52C'].includes(draft.nh.typ) ? draft.nh.typ : '25D'), v => { st.typ = v; touch(draft); }),
        selectField('Kontrola roční', ['provedena', 'neprovedena', 'nevyplněno'], st.kontrola || 'provedena', v => { st.kontrola = v; touch(draft); })),
      field(`Podlaží (prázdné = z měření: ${novyFloors(draft) || '—'})`, st, 'podlazi', draft));
    }
  }
  if (po.c_seznam) {
    const chosen = novyC(draft);
    out.push(h('div', { style: 'font-weight:650;margin:12px 0 2px' }, 'C – Další instalované VPPO a PBZ (P – provedeno; N – neprovedeno)'));
    for (const name of K.zarizeni_c || []) {
      const on = name in chosen;
      out.push(h('div', { class: 'row nowrap', style: 'gap:8px;margin:4px 0' },
        h('label', { class: 'row nowrap grow', style: 'gap:8px' }, h('input', { type: 'checkbox', checked: on, onchange: e => {
          if (e.target.checked) chosen[name] = 'P'; else delete chosen[name];
          touch(draft); rerender();
        } }), h('span', null, name)),
        on ? seg([['P', 'P'], ['N', 'N']], chosen[name], v => { chosen[name] = v; touch(draft); rerender(); }) : null));
    }
    out.push(h('div', { class: 'grid2' }, field('Jiné zařízení (název)', nb.c_jine, 'nazev', draft),
      selectField('Stav', ['P', 'N'], nb.c_jine.stav || 'P', v => { nb.c_jine.stav = v; touch(draft); })));
  }
  out.push(h('div', { style: 'font-weight:650;margin:12px 0 2px' }, 'D – Zjištěné skutečnosti, jiné závady, navržená opatření, stanovení způsobu a termínů jejich splnění'));
  const counter = h('span', { class: 'muted' });
  const updateCount = () => {
    const n = String(nb.d || '').split(/\s+/).filter(Boolean).join(' ').length, lim = K.limit_d || 420;
    counter.textContent = `${n} / ${lim} znaků` + (n > lim ? ' – delší text se nemusí vejít na stranu' : '');
  };
  out.push(h('label', { class: 'field' }, h('textarea', { value: nb.d || '', oninput: e => { nb.d = e.target.value; touch(draft); updateCount(); } })));
  out.push(h('div', { class: 'row' }, catalogBtn('po_d', '', t => { nb.d = [String(nb.d || '').trim(), t].filter(Boolean).join(' '); touch(draft); rerender(); }), counter));
  updateCount();
  return out;
}
function novyHydEditor(draft, pred, rerender) {
  const nh = ensureNovy(draft).nh, tab = pred.hydranty.tabulka, K = novyK(), out = [];
  let k = null;
  try { k = novyKHyd(draft, pred); } catch (e) { /* neúplná volba */ }
  out.push(h('p', { class: 'muted' }, `Tabulka ${tab} podle předlohy správce (${tab === 'A' ? 'p1, p2, p1−p2, Q' : 'tlak na výtoku, Q'}). `
    + 'Tlaky v MPa, průtok v l/s; chybějící hodnotu program dopočítá (Q = k·√p).'));
  out.push(h('div', { class: 'grid2' }, selectField('Typ hydrantu', ['25D', '52C', '75B'], nh.typ, v => { nh.typ = v; touch(draft); rerender(); }),
    tab === 'B' ? selectField('Proudnice (mm)', Object.keys(K.k_proudnice || {}), nh.proudnice, v => { nh.proudnice = v; touch(draft); rerender(); }) : h('div')));
  if (tab === 'B') out.push(h('div', { class: 'grid2' }, selectField('Systém DN', ['25', '19', '33'], nh.dn || '25', v => { nh.dn = v; touch(draft); rerender(); }),
    selectField('Hadice (m)', ['30', '20'], nh.hadice || '30', v => { nh.hadice = v; touch(draft); rerender(); })));
  draft.hyd_mereni.forEach((m, i) => {
    let shown = '';
    try {
      if (k) {
        const c = novyDopocti(tab, k, Object.fromEntries(HYD_INPUT[tab].map(x => [x, m[x]])));
        shown = HYD_KEYS[tab].filter(x => c[x]).map(x => `${MEASURE_NAME[x].split(' (')[0]} ${c[x]}`).join(' · ');
        const q = parseNum(c.prutok), min = ((K.minimum || {})[nh.typ] || [0, 0])[1];
        if (q !== null && q < min) shown += ' – POD MINIMEM';
      }
    } catch (e) { shown = e.message; }
    out.push(h('div', { class: 'item' }, h('div', { class: 'item-head' }, `Hydrant ${i + 1}`, removeBtn(() => { draft.hyd_mereni.splice(i, 1); touch(draft); rerender(); })),
      h('div', { class: 'grid2' }, field('Číslo', m, 'id', draft), field('Umístění (např. 2.NP chodba)', m, 'umisteni', draft, { required: true })),
      h('div', { class: 'grid2' }, HYD_INPUT[tab].map(x => field(MEASURE_NAME[x], m, x, draft, { inputmode: 'decimal' }))),
      shown ? h('p', { class: 'muted', style: 'margin:2px 0' }, shown) : null));
  });
  out.push(h('button', { class: 'btn', type: 'button', onclick: () => {
    draft.hyd_mereni.push({ id: String(draft.hyd_mereni.length + 1), umisteni: '', tlak_vytok: '', tlak_p1: '', tlak_p2: '', tlak_rozdil: '', prutok: '' });
    touch(draft); rerender();
  } }, '+ Hydrant'));
  const p1 = nh.p1;
  for (const [key] of [...P1_HLAVNI, ...P1_DALSI]) if (p1[key] === undefined) p1[key] = novyP1Default(pred, key);
  out.push(h('div', { style: 'font-weight:650;margin:12px 0 2px' }, 'Příloha 1'));
  const auto = novyP1Popis(draft, pred);
  out.push(h('p', { class: 'muted', style: 'margin:0' }, `Typ systému se při prázdných polích doplní sám: ${auto.typ_d || auto.typ_c || '—'}.`));
  out.push(P1_HLAVNI.map(([key, label]) => field(label, p1, key, draft, key.startsWith('pocet') ? { inputmode: 'numeric' } : {})));
  out.push(selectField('Druh rozvodu', [...(K.rozvody || []), 'nevyplněno'], p1.rozvod ?? 'větvový', v => { p1.rozvod = v; touch(draft); }));
  out.push(h('details', null, h('summary', { class: 'muted' }, 'Další údaje Přílohy 1'),
    P1_DALSI.map(([key, label]) => field(label, p1, key, draft, key.startsWith('pocet') ? { inputmode: 'numeric' } : {}))));
  out.push(h('div', { style: 'font-weight:650;margin:12px 0 2px' }, 'Závěr'));
  out.push(selectField('Zařízení … kontrolované v rozsahu příloh', K.vysledky || [], nh.vysledek, v => {
    nh.vysledek = v;
    if (v !== 'odpovídá' && !String(nh.text || '').trim()) nh.text = (K.text_odpovida || [''])[0] + '\n';
    touch(draft); rerender();
  }));
  if (nh.vysledek === 'odpovídá') out.push(h('p', { class: 'muted' }, 'Bez závad: zapíše se obvyklý text závěru a obvyklá doporučení.'));
  else {
    out.push(field(`Text závěru – první řádek navazuje na výrok, na dalších rozepiš závady (předloha má ${pred.hydranty.text_radku} řádků)`, nh, 'text', draft, { multiline: true }));
    if (!nh.doporuceni) nh.doporuceni = (K.doporuceni || []).join('\n');
    out.push(field(`Doporučení – jedno na řádek (místo pro ${pred.hydranty.doporuceni_max})`, nh, 'doporuceni', draft, { multiline: true }));
    out.push(h('div', { class: 'row' }, catalogBtn('hydranty', '', t => { nh.doporuceni = [String(nh.doporuceni || '').trim(), t].filter(Boolean).join('\n'); touch(draft); rerender(); })));
  }
  return out;
}
function novyListEditor(draft, rows, cols, stavy, limit, empty, rerender, title) {
  const out = [h('div', { style: 'font-weight:650;margin:12px 0 2px' }, title)];
  rows.forEach((r, i) => out.push(h('div', { class: 'item' },
    h('div', { class: 'item-head' }, `Řádek ${i + 1}`, removeBtn(() => { rows.splice(i, 1); touch(draft); rerender(); })),
    cols.map(([k, name]) => (k === 'stav'
      ? selectField(name, ['', ...stavy], r[k] || '', v => { r[k] = v; touch(draft); }, { required: true })
      : field(name, r, k, draft, k === 'pocet' ? { inputmode: 'numeric', placeholder: '1' } : {}))))));
  if (rows.length < limit) out.push(h('div', { class: 'row' },
    h('button', { class: 'btn', type: 'button', onclick: () => { rows.push({ ...empty }); touch(draft); rerender(); } }, '+ Řádek'),
    rows.length ? h('button', { class: 'btn', type: 'button', onclick: () => { rows.push({ ...rows[rows.length - 1] }); touch(draft); rerender(); } }, 'Kopírovat poslední') : null));
  return out;
}
function novyPbzEditor(draft, pred, role, rerender) {
  const K = novyK(), p = pred.pbz[role], labels = novyPbzLabels(pred, role);
  ensureNovy(draft);
  const st = draft.npbz[role] = draft.npbz[role] || { radky: [], vysledek: 'bez', zavady: '' };
  const out = [];
  if (p.chyba) out.push(h('p', { class: 'muted' }, p.chyba));
  if (labels.length) {
    out.push(h('p', { class: 'muted' }, `Evidence podle předlohy (${p.radku_predlohy} ${p.radku_predlohy === 1 ? 'řádek' : 'řádků'}; další se přidají). Prázdné řádky se nezapíší.`));
    st.radky.forEach((r, i) => out.push(h('div', { class: 'item' },
      h('div', { class: 'item-head' }, `Řádek ${i + 1}`, removeBtn(() => { st.radky.splice(i, 1); touch(draft); rerender(); })),
      labels.map((name, c) => h('label', { class: 'field' }, h('span', null, name === 'Č.' ? 'Č. (prázdné = pořadí)' : name),
        h('input', { value: r[c] || '', oninput: e => { r[c] = e.target.value; touch(draft); } }))))));
    out.push(h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => { st.radky.push(labels.map(() => '')); touch(draft); rerender(); } }, '+ Řádek evidence'),
      st.radky.length ? h('button', { class: 'btn', type: 'button', onclick: () => { st.radky.push([...st.radky[st.radky.length - 1]]); touch(draft); rerender(); } }, 'Kopírovat poslední') : null));
  }
  if (role === 'nouzove_osvetleni') out.push(novyListEditor(draft, draft.nno, K.no_sloupce || [], K.no_stavy || [], K.no_radku || 10,
    { umisteni: '', typ: '', stav: 'vyhovuje', pocet: '1' }, rerender, `Seznam nouzového osvětlení (nový list NO, nejvýše ${K.no_radku || 10} řádků)`));
  if (role === 'ucpavky') out.push(novyListEditor(draft, draft.nuc, K.uc_sloupce || [], K.uc_stavy || [], K.uc_radku || 30,
    { cislo: '', umisteni: '', druh: '', pocet: '1', odolnost: '', typ: '', system: '', stav: 'vyhovuje' }, rerender,
    `Seznam ucpávek (nejvýše ${K.uc_radku || 30} řádků; „č.“ = označení ucpávky na místě)`));
  out.push(selectField('Výsledek kontroly', [['bez', 'bez závad'], ['zavady', 'se závadami']], st.vysledek, v => { st.vysledek = v; touch(draft); rerender(); }));
  if (st.vysledek === 'zavady') {
    out.push(field('Zjištěné závady (zapíší se za „Zjištěno:“)', st, 'zavady', draft, { required: true, multiline: true }));
    if (role === 'nouzove_osvetleni') out.push(catalogBtn('no', '', t => { st.zavady = [String(st.zavady || '').trim(), t].filter(Boolean).join(' '); touch(draft); rerender(); }));
  } else out.push(h('p', { class: 'muted' }, 'Bez závad: „' + (K.vysledek_ok || '') + '“'));
  return out;
}

/* ------------------------------------------------------------------ katalog závad */
const KAT_NAZEV = { po_a: 'Řádek A', po_c: 'C – zjištěné skutečnosti', po_d: 'D – opatření', hydranty: 'Doporučení hydrantů', no: 'Nouzové osvětlení' };
function pickFromCatalog(kat, radek, onPick) {
  const items = (seznam.katalog || []).filter(i => i.k === kat && (kat !== 'po_a' || !i.r || norm(i.r) === norm(radek)));
  const close = () => overlay.remove();
  const listBox = h('div');
  const fill = q => listBox.replaceChildren(...items.filter(i => !q || norm(i.t).includes(norm(q))).slice(0, 80).map(i =>
    h('button', { class: 'pick', type: 'button', onclick: () => { close(); onPick(i.t); } }, i.t)));
  const overlay = h('div', { class: 'overlay', onclick: e => { if (e.target === overlay) close(); } },
    h('div', { class: 'sheet' },
      h('div', { class: 'row nowrap' }, h('b', { class: 'grow' }, `Katalog – ${KAT_NAZEV[kat] || kat}${radek ? ': ' + radek : ''}`),
        h('button', { class: 'btn small', type: 'button', onclick: close }, 'Zavřít')),
      h('input', { type: 'search', placeholder: 'Hledat v katalogu…', oninput: e => fill(e.target.value) }),
      items.length ? null : h('p', { class: 'muted' }, 'Katalog je prázdný. Na PC: Lhůtník › Katalog závad… a nový Export pro telefon.'),
      h('p', { class: 'muted', style: 'margin:6px 0' }, 'Znak … po vložení nahraď (např. termínem).'),
      listBox));
  fill('');
  document.body.append(overlay);
}
function catalogBtn(kat, radek, onPick) {
  return h('button', { class: 'btn small', type: 'button', onclick: () => pickFromCatalog(kat, radek, onPick) }, 'Katalog');
}

/* Řádky sekce A z Kontroly PO: vybraná volba je v protokolu tučně; u „závady“ / „neproveden“ text. */
function poRows(draft, po, rerender) {
  const out = [h('p', { class: 'muted', style: 'margin:0 0 6px' }, 'Stav převzatý z protokolu. Změň jen to, co se liší – zapíše se do příslušného řádku.')];
  for (const row of po.a) {
    const st = rowState(row, draft);
    const edit = () => (draft.po_a[row.nazev] = draft.po_a[row.nazev] || { volby: [...st.volby], text: st.text });
    const changed = changedRowsA(draft, { po }).some(r => r.nazev === row.nazev);
    const textual = row.text !== null;
    const showText = textual && (st.volby[0] === 0 || String(st.text || '').trim());
    out.push(h('div', { class: 'item' + (changed ? ' picked' : '') },
      h('div', { class: 'item-head' }, h('span', null, row.nazev), changed ? h('button', { class: 'btn small', type: 'button',
        onclick: () => { delete draft.po_a[row.nazev]; rerender(); } }, 'Vrátit') : null),
      row.volby.map((pair, i) => h('div', { style: 'margin-top:6px' }, seg([[0, pair[0]], [1, pair[1]]], st.volby[i], v => {
        const e = edit(); e.volby[i] = v;
        if (i === 0 && textual && v === 1 && norm(pair[0]).startsWith('zav')) e.text = '';
        rerender();
      }))),
      showText ? h('div', { class: 'row', style: 'margin-top:6px;align-items:flex-end' },
        h('div', { class: 'grow' }, h('label', { class: 'field' }, h('span', null, norm(row.volby[0][0]).startsWith('zav') ? 'Popis závady' : 'Poznámka'),
          h('textarea', { value: st.text || '', oninput: e => { edit().text = e.target.value; touch(draft); } }))),
        catalogBtn('po_a', row.nazev, t => { const e = edit(); e.text = t; if (e.volby[0] !== 0) e.volby[0] = 0; rerender(); })) : null));
  }
  return out;
}

/* Seznam řádků textu (C, D, doporučení): předvyplněno z protokolu, nahradí jeho obsah. */
function linesEditor(draft, key, original, kat, rerender, note, holder) {
  const target = holder || draft;
  const list = target[key] !== null && target[key] !== undefined ? target[key] : [...(original || [])];
  const commit = () => { target[key] = list; touch(draft); };
  return [
    h('p', { class: 'muted', style: 'margin:0 0 6px' }, note),
    list.map((line, i) => h('div', { class: 'item' },
      h('div', { class: 'item-head' }, `Řádek ${i + 1}`, h('button', { class: 'btn small danger', type: 'button', onclick: () => { list.splice(i, 1); commit(); rerender(); } }, 'Smazat')),
      h('textarea', { value: line, oninput: e => { list[i] = e.target.value; commit(); } }))),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => { list.push(''); commit(); rerender(); } }, '+ Řádek'),
      catalogBtn(kat, '', t => { list.push(t); commit(); rerender(); }),
      !sameList(list, original) ? h('button', { class: 'btn small', type: 'button', onclick: () => {
        target[key] = holder ? [...(original || [])] : null; touch(draft); rerender(); } }, 'Vrátit podle protokolu') : null),
  ];
}

function zaverEditor(draft, zaver, rerender) {
  // Výchozí = obsah protokolu (dokud se neliší, nic se nezapisuje).
  const z = draft.hyd_zaver = draft.hyd_zaver || { vysledek: zaver.vysledek, text: [...zaver.text], doporuceni: [...zaver.doporuceni] };
  const keep = () => { draft.hyd_zaver = z; if (zaverChanged(draft, sourceOf(draft)) && draft.stavy.hydranty !== 'zmeny') draft.stavy.hydranty = 'zmeny'; touch(draft); };
  return [
    h('label', { class: 'field' }, h('span', null, 'Zařízení … požadavkům ČSN'),
      h('div', { class: 'seg' }, VYROKY.map(v => h('button', { type: 'button', 'aria-pressed': String(z.vysledek === v),
        onclick: () => { z.vysledek = v; keep(); rerender(); } }, v)))),
    h('div', { style: 'font-weight:650;margin:10px 0 2px' }, 'Text závěru (řádky protokolu)'),
    z.text.map((line, i) => h('textarea', { value: line, style: 'margin:4px 0', oninput: e => { z.text[i] = e.target.value; keep(); } })),
    h('div', { style: 'font-weight:650;margin:10px 0 2px' }, `Doporučení a návrhy opatření (max. ${zaver.max_doporuceni})`),
    linesEditor(draft, 'doporuceni', zaver.doporuceni, 'hydranty', () => { keep(); rerender(); },
      'Pořadí = číslování 1., 2., … v protokolu. Závadu dej jako první doporučení s termínem.', z),
    draft.hyd_zaver && zaverChanged(draft, sourceOf(draft)) ? h('button', { class: 'btn small', type: 'button', onclick: () => { draft.hyd_zaver = null; touch(draft); rerender(); } }, 'Vrátit Závěr podle protokolu') : null,
  ];
}

function inDays(days) { const d = new Date(); d.setDate(d.getDate() + days); return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`; }
function noEditor(draft, no, rerender) {
  const original = no.doklad || { zjistene: '', odstraneni: '' };
  const d = draft.no_doklad || { zjistene: original.zjistene, odstraneni: original.odstraneni };
  const keep = () => { draft.no_doklad = d; touch(draft); };
  const state = r => (draft.no_stavy[r.radek] !== undefined ? draft.no_stavy[r.radek] : r.stav);
  const suggest = () => {
    const bad = (no.seznam || []).filter(r => norm(state(r)) !== 'vyhovuje');
    d.zjistene = bad.length
      ? 'PBZ je s omezením schopno řádně plnit svoji funkci s výjimkou nouzového osvětlení viz přiložený seznam.'
      : 'PBZ je schopno řádně plnit svoji funkci, provedenou kontrolou nebyly zjištěny žádné zjevné závady viz přiložený seznam.';
    d.odstraneni = bad.length ? `Neprodleně dle možností provozovatele, nejpozději však do ${inDays(60)}.` : '';
    keep(); rerender();
  };
  return [
    no.seznam && no.seznam.length ? [
      h('div', { style: 'font-weight:650;margin:0 0 2px' }, `Seznam svítidel (${no.seznam.length})`),
      no.seznam.map(r => {
        const value = state(r);
        const custom = !NO_STAVY.includes(value);
        return h('div', { class: 'item' + (value !== r.stav ? ' picked' : '') },
          h('div', { class: 'item-head' }, h('span', null, r.umisteni), h('span', { class: 'badge' + (norm(value) !== 'vyhovuje' ? ' draft' : '') }, value || '—')),
          r.typ && r.typ !== '-' ? h('div', { class: 'muted' }, r.typ) : null,
          h('select', { style: 'margin-top:6px', onchange: e => {
            const v = e.target.value === '__jine' ? (prompt('Stav svítidla:', custom ? value : '') || value) : e.target.value;
            draft.no_stavy[r.radek] = v; if (draft.stavy.nouzove_osvetleni !== 'zmeny') draft.stavy.nouzove_osvetleni = 'zmeny'; touch(draft); rerender(); } },
            [...NO_STAVY, ...(custom ? [value] : [])].map(s => h('option', { value: s, selected: s === value }, s)), h('option', { value: '__jine' }, 'jiný stav…')));
      }),
    ] : h('p', { class: 'muted' }, 'Seznam svítidel k objektu není v exportu.'),
    no.doklad ? [
      h('div', { style: 'font-weight:650;margin:12px 0 2px' }, 'Doklad o kontrole NO'),
      h('label', { class: 'field' }, h('span', { class: 'req' }, 'Zjištěné závady'),
        h('textarea', { value: d.zjistene, oninput: e => { d.zjistene = e.target.value; keep(); } })),
      h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: suggest }, 'Navrhnout podle seznamu'),
        catalogBtn('no', '', t => { d.zjistene = t; keep(); rerender(); })),
      no.doklad.odstraneni_pole ? h('label', { class: 'field' }, h('span', null, 'Odstranění závad (prázdné = bez závad)'),
        h('textarea', { value: d.odstraneni, oninput: e => { d.odstraneni = e.target.value; keep(); } })) : null,
      draft.no_doklad && noChanged(draft, sourceOf(draft)).doklad ? h('button', { class: 'btn small', type: 'button', onclick: () => { draft.no_doklad = null; touch(draft); rerender(); } }, 'Vrátit doklad podle protokolu') : null,
    ] : h('p', { class: 'muted' }, 'Doklad NO objektu není v exportu (např. vlastník bez IČO) – text dokladu uprav na PC.'),
  ];
}

/* Evidence PHP z protokolu: stejné akce jako v tabulce PHP na PC (TZ, oprava, vyřazení, výměna).
   „Auto“ = nic nezapisovat, program na PC vyhodnotí stav sám (TZ v termínu, konec životnosti). */
const AUTO_TEXT = {
  dobry: u => 'dobrý' + (u.pristi_tz ? ` · TZ ${u.pristi_tz}` : ''),
  tz: () => 'letos TZ', vyradit: () => 'konec životnosti – vyřadí se', vyrazen: () => 'vyřazen dříve',
  nejasne: () => 'stav nejasný – ověř na PC',
};
function phpInventory(draft, inv, rerender) {
  const year = yearOf(draft);
  const box = [h('p', { class: 'muted', style: 'margin:0 0 6px' },
    `Evidence z protokolu ${inv.posledni_kontrola || ''}. „Auto“ = nic neměň, program na PC stav spočítá sám.`,
    inv.rok && inv.rok !== year ? h('b', null, ` Automatický stav je spočítán pro rok ${inv.rok}, kontrola je v roce ${year}.`) : null,
    inv.upozorneni ? h('b', null, ' ' + inv.upozorneni) : null)];
  for (const unit of inv.pristroje) {
    const key = unit.vyrobni_cislo.trim().toLowerCase();
    const index = draft.php.findIndex(r => r.ev === key);
    const row = index >= 0 ? draft.php[index] : null;
    const options = unit.auto === 'vyrazen' ? [] : unit.auto === 'vyradit'
      ? [['', 'Vyřadit'], ['VYM', 'Výměna']]
      : [['', 'Auto'], ['TZ', 'TZ'], ['OPR', 'Oprava'], ['VYR', 'Vyřadit'], ['VYM', 'Výměna']];
    const pick = value => {
      if (index >= 0) draft.php.splice(index, 1);
      if (value) {
        draft.php.push({ akce: value, ev: key, vyrobni_cislo: unit.vyrobni_cislo, nove_vyrobni_cislo: '', druh: kindOf(unit.druh),
          vyrobce: '', model: '', rok_vyroby: '', rok_tz: '', umisteni: unit.umisteni });
        if (draft.stavy.php !== 'zmeny') draft.stavy.php = 'zmeny';
      }
      rerender();
    };
    box.push(h('div', { class: 'item' + (unit.auto === 'vyrazen' ? ' dim' : '') + (row ? ' picked' : '') },
      h('div', { class: 'item-head' }, h('span', null, `${unit.poradi ? unit.poradi + '. ' : ''}${unit.umisteni || '—'}`),
        h('span', { class: 'badge' + (unit.auto === 'tz' || unit.auto === 'vyradit' ? ' draft' : '') }, (AUTO_TEXT[unit.auto] || AUTO_TEXT.nejasne)(unit))),
      h('div', { class: 'muted' }, [unit.druh, [unit.vyrobce, unit.model].filter(Boolean).join(' '), 'v.č. ' + unit.vyrobni_cislo].filter(Boolean).join(' · ')),
      options.length ? h('div', { style: 'margin-top:6px' }, seg(options, row ? row.akce : '', pick)) : null,
      row && row.akce === 'VYM' ? h('div', { style: 'margin-top:6px' },
        field('Výrobní číslo nového PHP', row, 'nove_vyrobni_cislo', draft, { required: true, caps: 'none', placeholder: 'číslo/XX, např. 001234/26' }),
        h('label', { class: 'field' }, h('span', { class: 'req' }, 'Druh'),
          h('select', { onchange: e => { row.druh = e.target.value; touch(draft); } }, [h('option', { value: '' }, '— vyber —'), ...DRUHY.map(d => h('option', { value: d, selected: d === row.druh }, d))])),
        h('div', { class: 'grid2' }, field('Výrobce', row, 'vyrobce', draft, { required: true }), field('Model / typ', row, 'model', draft, { required: true })),
        field('Umístění', row, 'umisteni', draft, { required: true })) : null,
      (row && (row.akce === 'TZ' || row.akce === 'OPR')) ? h('p', { class: 'muted', style: 'margin:4px 0 0' }, `Provedeno v roce kontroly (${year}).`) : null,
      unit.auto === 'vyrazen' ? null : phpFixEditor(draft, unit, key, rerender)));
  }
  return box;
}
function phpFixEditor(draft, unit, key, rerender) {
  const edit = draft.php_opravy[key];
  if (!edit) {
    return h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { class: 'btn small', type: 'button', onclick: () => {
      draft.php_opravy[key] = Object.fromEntries(PHP_FIX_FIELDS.map(([k]) => [k, String(unit[k] ?? '')]));
      touch(draft); rerender();
    } }, 'Opravit údaje'));
  }
  const markChanged = () => { if (draft.stavy.php !== 'zmeny' && phpFixes(draft).length) draft.stavy.php = 'zmeny'; };
  return h('div', { style: 'margin-top:8px' },
    h('p', { class: 'muted', style: 'margin:0 0 4px' }, 'Oprava údajů v letošní tabulce PHP. Rok TZ se počítá sám.'),
    PHP_FIX_FIELDS.map(([k, label]) => field(label, edit, k, draft, { caps: k === 'vyrobni_cislo' ? 'none' : 'sentences', onchange: markChanged })),
    h('button', { class: 'btn small', type: 'button', onclick: () => { delete draft.php_opravy[key]; touch(draft); rerender(); } }, 'Zrušit opravu'));
}

function showResult(draft, box) {
  // Vchod + rozpracované části „pro celý dům“ se ukládají a odesílají společně.
  const shared = sharedDrafts(draft, sourceOf(draft)).filter(sharedStarted);
  const errors = [...validate(draft), ...shared.flatMap(s => validate(s).map(e => `${s.adresa} (celý dům): ${e}`))];
  if (errors.length) {
    box.replaceChildren(h('div', { class: 'card errors' }, h('div', { style: 'font-weight:650' }, `Doplň ještě ${errors.length} ${errors.length === 1 ? 'věc' : 'věcí'}:`),
      h('ul', null, errors.map(e => h('li', null, e)))));
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const all = [draft, ...shared];
  const files = all.map(d => ({ draft: d, json: JSON.stringify(build(d), null, 2), name: fileName(d) }));
  const auto = od.configured();
  if (auto) {
    // Úplný checklist se při propojení s OneDrive uloží a odešle sám (bez signálu ve frontě, odejde později).
    for (const d of all) if (d.stav !== 'ulozeno') { d.stav = 'ulozeno'; d.ulozeno = new Date().toISOString(); drafts[d.id] = d; }
    saveDrafts(true);
  }
  const sent = all.every(d => d.nahrano === d.zmeneno);
  const render = () => {
    const done = all.every(d => d.nahrano === d.zmeneno);
    box.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'ok' }, done ? 'Checklist je úplný a odeslaný do OneDrive.' : 'Checklist je úplný.'),
      shared.length ? h('p', { class: 'muted' }, `Spolu s ním: ${shared.map(s => s.adresa + ' (celý dům)').join(', ')} – ${files.length} soubory.`) : null,
      h('p', { class: 'muted' }, auto
        ? (done ? 'Na PC ho najdeš v Pracovní dávce pod tlačítkem „Z telefonu“.'
          : od.connected() ? 'Odesílá se do OneDrive automaticky – bez signálu počká a odejde sám, jakmile bude síť.'
            : 'Odešle se automaticky po přihlášení k OneDrive.')
        : 'Aby se checklisty odesílaly do OneDrive samy (bez ukládání a stahování), propoj jednou aplikaci s OneDrive.'),
      auto && od.connected() ? null : h('div', { class: 'row' }, h('button', { class: 'btn primary grow', type: 'button',
        onclick: () => { location.hash = '#/o-aplikaci'; } }, auto ? 'Přihlásit k OneDrive' : 'Nastavit automatické odesílání')),
      // Ruční uložení jen jako záloha – při propojení s OneDrive není potřeba.
      h(auto ? 'details' : 'div', { style: 'margin-top:8px' }, auto ? h('summary', { class: 'muted' }, 'Uložit ručně') : null,
        h('div', { class: 'row' },
          h('button', { class: 'btn grow', type: 'button', onclick: () => shareJson(files) }, 'Uložit / sdílet'),
          h('button', { class: 'btn', type: 'button', onclick: () => files.forEach(downloadJson) }, 'Stáhnout'))),
      h('details', { style: 'margin-top:10px' }, h('summary', { class: 'muted' }, 'Zobrazit JSON'), files.map(f => h('pre', null, f.json)))));
  };
  render();
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (auto && !sent) autoSend().then(render);
}
function markSaved(draft) { draft.stav = 'ulozeno'; draft.ulozeno = new Date().toISOString(); drafts[draft.id] = draft; saveDrafts(true); toast('Checklist uložen.'); }
async function shareJson(files) {
  const list = files.map(f => new File([f.json], f.name, { type: 'application/json' }));
  if (navigator.canShare && navigator.canShare({ files: list })) {
    try { await navigator.share({ files: list, title: list.length > 1 ? `Checklisty (${list.length})` : list[0].name }); files.forEach(f => markSaved(f.draft)); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  files.forEach(downloadJson);
}
function downloadJson(file) {
  const url = URL.createObjectURL(new Blob([file.json], { type: 'application/json' }));
  const link = h('a', { href: url, download: file.name, style: 'display:none' });
  document.body.append(link); link.click();
  setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 2000);
  markSaved(file.draft);
}

function renderAbout() {
  clear(); setTitle('O aplikaci', true);
  const backup = () => downloadJsonRaw(backupJson(), `revize_zaloha_${todayIso()}.json`);
  const lastBackup = store.get('revize.zaloha', '');
  const cfg = od.cfg();
  const status = od.connected() ? 'Propojeno – Synchronizovat stáhne seznam a odešle uložené checklisty.'
    : cfg.clientId ? 'Nepřihlášeno.' : 'Nenastaveno – vlož ID aplikace z registrace v Microsoft Entra (postup v návodu na PC).';
  app.append(h('div', { class: 'card' },
    h('div', { style: 'font-weight:650' }, 'OneDrive – automatická výměna s PC'),
    h('p', { class: 'muted' }, `Složka OneDrive › ${OD_DIR}: seznam.json (z PC) a checklisty (z telefonu). ${status}`),
    h('label', { class: 'field' }, h('span', null, 'ID aplikace (Application / Client ID)'),
      h('input', { value: cfg.clientId, autocapitalize: 'none', autocomplete: 'off', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        oninput: e => { cfg.clientId = e.target.value.trim(); store.set('revize.onedrive', cfg); } })),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'button', onclick: () => {
        store.set('revize.onedrive', { ...cfg, clientId: cfg.clientId.trim() }); od.login().catch(e => toast(e.message, 6000)); } }, od.connected() ? 'Přihlásit znovu' : 'Přihlásit k OneDrive'),
      od.connected() ? h('button', { class: 'btn', type: 'button', onclick: () => { od.logout(); renderAbout(); } }, 'Odhlásit') : null)));
  app.append(h('div', { class: 'card' },
    h('p', null, `Verze ${APP_VERSION}. Aplikace funguje i bez internetu. Seznam objektů a rozpracované checklisty jsou uložené jen v tomto telefonu.`),
    h('p', { class: 'muted' }, 'Na plochu ji přidáš v Safari: Sdílet › Přidat na plochu.'),
    h('p', { class: 'muted' }, 'Při každém Synchronizovat se všechny checklisty (i rozpracované) zálohují do OneDrive › '
      + `${OD_DIR} › zalohy (soubor pro každý den v týdnu, 7 dní zpět). `
      + (lastBackup ? `Poslední záloha do OneDrive: ${new Date(lastBackup).toLocaleString('cs-CZ')}.` : 'Do OneDrive zatím nezálohováno.')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: backup }, 'Záloha všech checklistů'),
      h('button', { class: 'btn', type: 'button', onclick: () => filePicker('.json,application/json', restoreBackup) }, 'Obnovit ze zálohy'),
      h('button', { class: 'btn danger', type: 'button', onclick: () => {
        if (!confirm('Smazat všechny uložené checklisty (rozpracované i uložené) z telefonu?')) return;
        drafts = {}; saveDrafts(true); toast('Smazáno.'); location.hash = '#/';
      } }, 'Smazat checklisty'))));
}
function downloadJsonRaw(json, name) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = h('a', { href: url, download: name, style: 'display:none' });
  document.body.append(link); link.click(); setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 2000);
}

/* ------------------------------------------------------------------ OneDrive (bez serveru)
   Přihlášení účtem Microsoft (OAuth 2.0 s PKCE), přístup jen ke složce OneDrive › Revize_telefon:
   stažení seznam.json z PC a nahrání hotových checklistů do Revize_telefon/checklisty. */
const OD_DIR = 'Revize_telefon';
const OD_SCOPE = 'Files.ReadWrite offline_access';
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomText = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
const od = {
  cfg() { return store.get('revize.onedrive', { clientId: '', authority: 'common' }); },
  tokens() { return store.get('revize.onedrive.token', null); },
  connected() { return !!(this.cfg().clientId && this.tokens()); },
  configured() { return !!this.cfg().clientId; },
  redirect() { return location.origin + location.pathname; },
  base() { return `https://login.microsoftonline.com/${this.cfg().authority || 'common'}/oauth2/v2.0`; },
  async login() {
    const cfg = this.cfg();
    if (!cfg.clientId) throw new Error('Nejdřív vlož ID aplikace (Client ID).');
    const verifier = randomText(48), state = randomText(12);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    store.set('revize.onedrive.pkce', { verifier, state });
    const q = new URLSearchParams({ client_id: cfg.clientId, response_type: 'code', redirect_uri: this.redirect(), scope: OD_SCOPE,
      code_challenge: challenge, code_challenge_method: 'S256', state, prompt: 'select_account' });
    location.assign(`${this.base()}/authorize?${q}`);
  },
  async _token(params) {
    const response = await fetch(`${this.base()}/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.cfg().clientId, scope: OD_SCOPE, ...params }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || ('HTTP ' + response.status));
    store.set('revize.onedrive.token', { access: data.access_token, refresh: data.refresh_token || (this.tokens() || {}).refresh,
      exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 });
  },
  async finishLogin() {
    const q = new URLSearchParams(location.search);
    if (!q.get('code') && !q.get('error')) return false;
    history.replaceState(null, '', this.redirect() + location.hash);
    const pkce = store.get('revize.onedrive.pkce', null);
    localStorage.removeItem('revize.onedrive.pkce');
    if (q.get('error')) { toast('Přihlášení k OneDrive se nezdařilo: ' + (q.get('error_description') || q.get('error')), 7000); return true; }
    if (!pkce || pkce.state !== q.get('state')) { toast('Přihlášení k OneDrive: neplatná odpověď, zkus to znovu.', 6000); return true; }
    try { await this._token({ grant_type: 'authorization_code', code: q.get('code'), redirect_uri: this.redirect(), code_verifier: pkce.verifier }); toast('OneDrive propojen.'); }
    catch (e) { toast('Přihlášení k OneDrive se nezdařilo: ' + e.message, 7000); }
    return true;
  },
  async access() {
    const t = this.tokens();
    if (!t) throw new Error('Telefon není propojen s OneDrive (O aplikaci › OneDrive).');
    if (t.exp > Date.now() + 60000) return t.access;
    try { await this._token({ grant_type: 'refresh_token', refresh_token: t.refresh }); return this.tokens().access; }
    catch (e) { localStorage.removeItem('revize.onedrive.token'); throw new Error('Přihlášení k OneDrive vypršelo – přihlas se znovu (O aplikaci › OneDrive).'); }
  },
  async graph(path, opts = {}) {
    const response = await fetch('https://graph.microsoft.com/v1.0/me/drive/root:/' + path.split('/').map(encodeURIComponent).join('/') + (opts.suffix || ''),
      { method: opts.method || 'GET', headers: { Authorization: 'Bearer ' + await this.access(), ...(opts.type ? { 'Content-Type': opts.type } : {}) }, body: opts.body });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('OneDrive: HTTP ' + response.status);
    return response.json();
  },
  async download(path) {
    const meta = await this.graph(path);
    if (!meta) return null;
    const response = await fetch(meta['@microsoft.graph.downloadUrl']);
    if (!response.ok) throw new Error('OneDrive: stažení se nezdařilo (' + response.status + ')');
    return { meta, data: await response.json() };
  },
  upload(path, text) { return this.graph(path, { method: 'PUT', suffix: ':/content', type: 'application/json', body: text }); },
  logout() { localStorage.removeItem('revize.onedrive.token'); },
};
async function uploadDraft(draft) {
  const json = JSON.stringify(build(draft), null, 2);
  await od.upload(`${OD_DIR}/checklisty/${fileName(draft)}`, json);
  draft.stav = 'ulozeno'; draft.ulozeno = draft.ulozeno || new Date().toISOString(); draft.nahrano = draft.zmeneno;
  drafts[draft.id] = draft; saveDrafts(true);
}
/* Záloha všech checklistů (i rozpracovaných) při každé synchronizaci: OneDrive › Revize_telefon › zalohy.
   Jeden soubor na den v týdnu – přepisuje se během dne, starší dny zůstávají (7 dní zpět, bez mazání). */
const ZALOHA_DNY = ['nedele', 'pondeli', 'utery', 'streda', 'ctvrtek', 'patek', 'sobota'];
function backupJson() {
  return JSON.stringify({ schema: 'revize-pwa-zaloha-1', vytvoreno: new Date().toISOString(), aplikace: APP_VERSION, koncepty: drafts });
}
async function backupToOneDrive() {
  if (!Object.keys(drafts).length) return false;
  const day = new Date().getDay();
  await od.upload(`${OD_DIR}/zalohy/zaloha_${day || 7}_${ZALOHA_DNY[day]}.json`, backupJson());
  store.set('revize.zaloha', new Date().toISOString());
  return true;
}
/* Obnova ze zálohy: doplní chybějící checklisty a nahradí jen ty, které jsou v záloze novější. */
function restoreBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.schema !== 'revize-pwa-zaloha-1' || !data.koncepty || typeof data.koncepty !== 'object') throw new Error('soubor není záloha checklistů');
      const incoming = Object.values(data.koncepty).filter(d => d && typeof d.id === 'string' && typeof d.zmeneno === 'string' && d.stavy);
      const take = incoming.filter(d => !drafts[d.id] || d.zmeneno > drafts[d.id].zmeneno);
      if (!take.length) { toast('Záloha neobsahuje nic nového – checklisty v telefonu jsou stejné nebo novější.', 6000); return; }
      const added = take.filter(d => !drafts[d.id]).length;
      if (!confirm(`Obnovit ze zálohy ${take.length} checklistů?\n\nNové: ${added}, novější než v telefonu: ${take.length - added}.\nNovější checklisty v telefonu zůstanou beze změny.`)) return;
      for (const d of take) drafts[d.id] = ensureDraft(d);
      saveDrafts(true); toast(`Obnoveno ze zálohy: ${take.length}.`); location.hash = '#/';
    } catch (e) { toast('Zálohu nelze načíst: ' + e.message, 6000); }
  };
  reader.readAsText(file);
}
/* Automatické odeslání uložených checklistů (a jednou denně záloha) – po uložení, při startu, při návratu
   signálu a při návratu do aplikace. Tiché: chyby jen poznamená (karta Neodesláno ukáže, co zbývá). */
async function autoSend() {
  if (autoSend.running || syncOneDrive.running || !od.connected() || !navigator.onLine) return 0;
  autoSend.running = true;
  let sent = 0;
  try {
    for (const draft of Object.values(drafts)) {
      if (draft.stav !== 'ulozeno' || draft.nahrano === draft.zmeneno) continue;
      if (validate(ensureDraft(draft)).length) continue;
      await uploadDraft(draft); sent++;
    }
    const last = store.get('revize.zaloha', '');
    if (Object.keys(drafts).length && String(last).slice(0, 10) !== todayIso()) await backupToOneDrive().catch(() => {});
    if (sent) toast(`Automaticky odesláno do OneDrive: ${sent} ${sent === 1 ? 'checklist' : sent < 5 ? 'checklisty' : 'checklistů'}.`);
  } catch (e) {
    store.set('revize.autoodeslani', { chyba: e.message, kdy: new Date().toISOString() });
  } finally {
    autoSend.running = false;
    updateUnsent();
    if (sent && (!location.hash || location.hash === '#/')) renderList();
  }
  return sent;
}
async function syncOneDrive() {
  if (syncOneDrive.running) return;
  syncOneDrive.running = true;
  try {
    toast('Synchronizuji s OneDrive…', 20000);
    let backup = '';
    try { if (await backupToOneDrive()) backup = ' Záloha uložena.'; }
    catch (e) { backup = ` Zálohu se nepodařilo uložit (${e.message}).`; }
    let sent = 0, skipped = 0;
    for (const draft of Object.values(drafts)) {
      if (draft.stav !== 'ulozeno' || draft.nahrano === draft.zmeneno) continue;
      if (validate(ensureDraft(draft)).length) { skipped++; continue; }
      await uploadDraft(draft); sent++;
    }
    let got = '';
    const remote = await od.download(`${OD_DIR}/seznam.json`);
    if (remote && remote.meta.lastModifiedDateTime !== seznam.od_zmeneno) {
      await applyList(remote.data);
      seznam.od_zmeneno = remote.meta.lastModifiedDateTime; await saveSeznam();
      got = ` Nový seznam: ${seznam.polozky.length} objektů.`;
    }
    toast(`Odesláno ${sent} checklistů.${skipped ? ` ${skipped} neúplných zůstalo v telefonu.` : ''}${got || ' Seznam je aktuální.'}${backup}`, 6000);
    if (!location.hash || location.hash === '#/') renderList();
  } catch (e) { toast(e.message, 7000); }
  finally { syncOneDrive.running = false; }
}

/* ------------------------------------------------------------------ start */
function updateOnline() { document.getElementById('offline').hidden = navigator.onLine; }
// CSP (index.html) – když zablokuje adresu, kterou OneDrive použije, ať je to vidět (a dá se doplnit).
document.addEventListener('securitypolicyviolation', e => {
  let host = e.blockedURI; try { host = new URL(e.blockedURI).host; } catch (err) { /* inline apod. */ }
  toast(`Bezpečnostní pravidlo zablokovalo „${host}“ (${e.violatedDirective}). Napiš to do programu.`, 9000);
});
document.getElementById('neodeslano').addEventListener('click', () => {
  if (!location.hash || location.hash === '#/') route(); else location.hash = '#/';
  window.scrollTo(0, 0);
});
window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline);
window.addEventListener('online', () => autoSend());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoSend(); });
setInterval(() => { if (document.visibilityState === 'visible') autoSend(); }, 5 * 60 * 1000);
updateOnline();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // Aplikace startuje z uložené kopie; nová verze se stáhne na pozadí a převezme se při dalším otevření.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) toast('Nová verze aplikace je stažená – zavři aplikaci a otevři ji znovu.', 9000);
  });
  navigator.serviceWorker.register('sw.js').then(reg => {
    // iPhone aplikaci z pozadí jen probudí (bez nového načtení) – zkontroluj novou verzi i tehdy.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
window.revize = { build, validate, newDraft, ensureDraft, icoOk, applyList, drafts: () => drafts, seznam: () => seznam };  // pro kontrolu a testy
loadSeznam().then(loadDrafts).then(() => od.finishLogin()).catch(() => {}).then(route).then(() => autoSend());
