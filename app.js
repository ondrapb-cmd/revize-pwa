/* Revize – terénní checklist CL-A4-02 (PWA pro iPhone).
 *
 * Vše běží v telefonu: seznam objektů i rozpracované checklisty jsou jen v úložišti
 * prohlížeče. Výstupem je JSON CL-A4-02, který program na PC načte přes
 * „Připojit JSON…“ a ukáže stejný kontrolní náhled jako u fotografie checklistu.
 */
'use strict';

const APP_VERSION = '1.1.0';
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
const DRUHY = ['Práškový', 'Vodní', 'Pěnový', 'Sněhový (CO₂)', 'Jiný'];
const FULL_ROW = ['NOVY', 'VYM', 'EVIDENCE'];

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
let seznam = store.get('revize.seznam', { vytvoreno: '', polozky: [] });
let drafts = store.get('revize.koncepty', {});
// Objekty odebrané ze seznamu (vyřízené jinak než telefonem): id → termín v době odebrání.
// Při novém termínu (další rok) se objekt v seznamu znovu objeví.
let skryte = store.get('revize.skryte', {});
function isHidden(o) { return Object.prototype.hasOwnProperty.call(skryte, o.id) && skryte[o.id] === (o.termin || ''); }
let saveTimer = null;
function saveDrafts(now) {
  clearTimeout(saveTimer);
  if (now) { store.set('revize.koncepty', drafts); return; }
  saveTimer = setTimeout(() => store.set('revize.koncepty', drafts), 300);
}

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
function phoneHref(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  return digits.replace(/\D/g, '').length >= 9 ? 'tel:' + digits.split(/[;/,]/)[0] : null;
}
function yearOf(draft) { return Number((draft.datum || todayIso()).slice(0, 4)); }
const NEW_SERIAL = /^[^/\s]+\/\d{2}$/;  // PC čte rok výroby nového PHP z „/XX“
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
    stavy: Object.fromEntries(ROLES.map(([role]) => [role, 'nejasne'])),
    po: { minule: null, zavady: [] },
    d: { chybi_php: null, chybi_znaceni: null, jine: '' },
    php: [], hyd_mereni: [], hyd_zavady: [],
    pbz: Object.fromEntries(PBZ.map(role => [role, []])),
    stav: 'rozpracovano', zmeneno: new Date().toISOString(),
  };
}
function touch(draft) { draft.zmeneno = new Date().toISOString(); if (draft.stav === 'ulozeno') draft.stav = 'zmeneno'; drafts[draft.id] = draft; saveDrafts(); }

function poValues(draft) {
  const d = draft.d;
  return draft.po.minule !== null || draft.po.zavady.length > 0 || d.chybi_php !== null || d.chybi_znaceni !== null || !!d.jine.trim();
}
function roleValues(draft, role) {
  if (role === 'po') return poValues(draft);
  if (role === 'php') return draft.php.length > 0;
  if (role === 'hydranty') return draft.hyd_zavady.length > 0;
  return draft.pbz[role].length > 0;
}

function validate(draft) {
  const errors = [];
  if (!czDate(draft.datum)) errors.push('Vyplň datum kontroly.');
  if (!draft.adresa.trim()) errors.push('Vyplň adresu domu.');
  if (!draft.subjekt.trim()) errors.push('Vyplň vlastníka (název SVJ / BD / firmy).');
  if (draft.ico.trim() && !icoOk(draft.ico.trim())) errors.push('IČO nemá platnou kontrolní číslici – oprav ho nebo nech prázdné.');
  if (typeof draft.novy_objekt !== 'boolean') errors.push('Zvol, zda jde o stávající, nebo nový objekt.');
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
    if (newSerial && !NEW_SERIAL.test(newSerial)) errors.push(`${label}: výrobní číslo nového PHP piš ve tvaru číslo/XX (např. 001234/26).`);
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
      if (row[year] && !/^(19|20)\d\d$/.test(row[year])) errors.push(`${label}: rok musí být čtyřmístný (např. 2019).`);
    }
  });
  draft.hyd_mereni.forEach((m, i) => {
    if (!m.umisteni.trim()) errors.push(`B2 – měření ${i + 1}: chybí umístění hydrantu.`);
    if (!['tlak_p1', 'tlak_p2', 'tlak_rozdil', 'prutok'].some(k => m[k].trim())) errors.push(`B2 – měření ${i + 1}: zapiš aspoň jednu naměřenou hodnotu.`);
  });
  draft.hyd_zavady.forEach((z, i) => { if (!z.trim()) errors.push(`B2 – závada ${i + 1}: prázdný text.`); });
  for (const role of PBZ) draft.pbz[role].forEach((r, i) => { if (!r.popis.trim()) errors.push(`${ROLE_NAME[role]} ${i + 1}: chybí popis.`); });
  return errors;
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
    hydranty_mereni: draft.hyd_mereni.map(m => ({ id: text(m.id), umisteni: text(m.umisteni), tlak_p1: text(m.tlak_p1) || null,
      tlak_p2: text(m.tlak_p2) || null, tlak_rozdil: text(m.tlak_rozdil) || null, prutok: text(m.prutok) || null })),
    hydranty_zavady: draft.hyd_zavady.map(text),
    pbz_zmeny: Object.fromEntries(PBZ.map(role => [role, draft.pbz[role].map(r => ({ id: text(r.id), umisteni: text(r.umisteni), popis: text(r.popis), hodnoty: {} }))])),
    zavady_d: { chybi_php: draft.d.chybi_php, chybi_bezpecnostni_znaceni: draft.d.chybi_znaceni, jine: text(draft.d.jine) },
  };
  return {
    schema_checklist: 'CL-A4-02', udaje_se_nevesly: false, ico: text(draft.ico), subjekt: text(draft.subjekt),
    novy_objekt: draft.novy_objekt, datum_kontroly: czDate(draft.datum), zdrojovy_prepis: '', varovani: [],
    objekty: [object],
  };
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
  const hash = location.hash || '#/';
  const match = /^#\/c\/(.+)$/.exec(hash);
  if (match && drafts[decodeURIComponent(match[1])]) return renderChecklist(drafts[decodeURIComponent(match[1])]);
  if (hash === '#/o-aplikaci') return renderAbout();
  renderList();
}
window.addEventListener('hashchange', route);

function setTitle(text, back) { titleEl.textContent = text; backBtn.hidden = !back; document.title = text; }
function clear() { app.replaceChildren(); document.querySelector('.fab')?.remove(); }

function importList(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (data.schema !== 'lhutnik-telefon-1' || !Array.isArray(data.objekty)) throw new Error('Soubor není seznam objektů z lhůtníku.');
      seznam = { vytvoreno: data.vytvoreno || '', nazev: data.nazev || '', polozky: data.objekty };
      store.set('revize.seznam', seznam);
      toast(`Načteno ${seznam.polozky.length} objektů.`);
      renderList();
    } catch (e) { toast('Seznam nelze načíst: ' + e.message, 6000); }
  };
  reader.readAsText(file);
}
function filePicker(accept, onFile) {
  const input = h('input', { type: 'file', accept, style: 'display:none', onchange: e => { if (e.target.files[0]) onFile(e.target.files[0]); } });
  document.body.append(input); input.click(); setTimeout(() => input.remove(), 60000);
}

function draftBadge(draft) {
  if (!draft) return null;
  if (draft.stav === 'ulozeno') return h('span', { class: 'badge done' }, 'uloženo');
  return h('span', { class: 'badge draft' }, 'rozpracováno');
}

function renderList() {
  clear(); setTitle('Revize – objekty', false);
  const now = new Date(); const current = now.getFullYear() * 12 + now.getMonth() + 1;
  let filter = sessionStorage.getItem('revize.filtr') || 'vse';
  let query = sessionStorage.getItem('revize.hledat') || '';

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
      return !q || norm(`${o.zakaznik} ${o.adresa} ${o.ico} ${o.osoba}`).includes(q);
    }).sort((a, b) => (monthValue(a.termin) || 0) - (monthValue(b.termin) || 0) || norm(a.adresa).localeCompare(norm(b.adresa)));
    listBox.replaceChildren(...items.slice(0, 300).map(o => {
      const draft = drafts['obj:' + o.id];
      const tel = phoneHref(o.telefon);
      const phpCount = o.php && o.php.pristroje ? o.php.pristroje.length : 0;
      return h('div', { class: 'card' + (showHidden ? ' dim' : '') },
        h('div', { class: 'row nowrap' }, h('div', { class: 't grow', style: 'font-weight:650' }, o.adresa), draftBadge(draft),
          showHidden ? null : xButton(`Odebrat ${o.adresa} ze seznamu`, () => hideObject(o))),
        h('div', { class: 'muted' }, `${o.zkratka || o.zakaznik} · ${o.sada || ''} · termín ${o.termin || '—'}${phpCount ? ` · ${phpCount} PHP` : ''}`),
        (o.osoba || o.telefon) ? h('div', { class: 'muted' }, [o.osoba, o.telefon].filter(Boolean).join(' · ')) : null,
        h('div', { class: 'row', style: 'margin-top:8px' },
          showHidden
            ? h('button', { class: 'btn grow', type: 'button', onclick: () => { delete skryte[o.id]; store.set('revize.skryte', skryte); fill(); } }, 'Vrátit do seznamu')
            : h('button', { class: 'btn primary grow', type: 'button', onclick: () => openDraft(o) }, draft ? 'Pokračovat v checklistu' : 'Nový checklist'),
          tel ? h('a', { class: 'btn', href: tel }, 'Volat') : null));
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
    h('button', { class: 'btn', type: 'button', onclick: () => filePicker('.json,application/json', importList) }, 'Načíst seznam'),
    h('button', { class: 'btn primary', type: 'button', onclick: () => openDraft(null) }, '+ Objekt mimo seznam'));
  document.body.append(fab);
  app.append(h('p', { class: 'muted', style: 'text-align:center' }, h('a', { href: '#/o-aplikaci' }, 'O aplikaci a zálohy')));
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
  if (!draft) { draft = newDraft(source); drafts[draft.id] = draft; saveDrafts(true); }
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

function renderChecklist(draft) {
  clear(); setTitle(draft.adresa || 'Nový checklist', true);
  // Pozice se čte až v okamžiku klepnutí – jinak by stránka odskočila na místo z minulého vykreslení.
  const rerender = () => { const y = window.scrollY; touch(draft); renderChecklist(draft); window.scrollTo(0, y); };

  // Hlavička
  const src = draft.zdroj;
  app.append(h('div', { class: 'card' },
    src ? h('p', { class: 'muted', style: 'margin:0 0 6px' }, `${src.zkratka || src.zakaznik} · ${src.sada || ''} · termín ${src.termin || '—'}`,
      (src.osoba || src.telefon) ? h('br') : null, [src.osoba, src.telefon, src.email].filter(Boolean).join(' · ')) : null,
    field('Datum kontroly', draft, 'datum', draft, { type: 'date', required: true }),
    field('Adresa domu', draft, 'adresa', draft, { required: true, onchange: () => setTitle(draft.adresa || 'Nový checklist', true) }),
    h('div', { class: 'grid2' },
      field('IČO vlastníka', draft, 'ico', draft, { inputmode: 'numeric', placeholder: 'nepovinné' }),
      h('div', null, h('label', { class: 'field' }, h('span', { class: 'req' }, 'Objekt'),
        seg([[false, 'Stávající'], [true, 'Nový']], draft.novy_objekt, v => { draft.novy_objekt = v; rerender(); })))),
    field('Vlastník (SVJ, BD, firma)', draft, 'subjekt', draft, { required: true })));

  // Rozsah
  app.append(h('div', { class: 'card' }, h('div', { style: 'font-weight:650;margin-bottom:4px' }, 'Rozsah kontroly'),
    h('p', { class: 'muted', style: 'margin:0 0 6px' }, 'U každé části zvol stav. „Změny“ otevře zápis změn níže.'),
    ROLES.map(([role, name]) => h('div', { class: 'scope' }, h('div', { class: 'name' }, name),
      seg(STATES, draft.stavy[role], v => { draft.stavy[role] = v; draft._open = draft._open || {}; if (v === 'zmeny') draft._open[role] = true; rerender(); })))));

  // A + D
  if (draft.stavy.po === 'zmeny') {
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

  // B2 – hydranty
  if (draft.stavy.hydranty === 'zmeny' || draft.stavy.hydranty === 'beze_zmen') {
    app.append(section(draft, 'hydranty', `B2 – Hydranty – měření (${draft.hyd_mereni.length})`, [
      h('p', { class: 'muted' }, 'Tlaky v MPa, průtok v l/s, s desetinnou čárkou. Měření lze zapsat i při stavu Beze změn.'),
      draft.hyd_mereni.map((m, i) => h('div', { class: 'item' },
        h('div', { class: 'item-head' }, `Měření ${i + 1}`, removeBtn(() => { draft.hyd_mereni.splice(i, 1); rerender(); })),
        h('div', { class: 'grid2' }, field('Číslo hydrantu', m, 'id', draft, { inputmode: 'numeric' }), field('Umístění', m, 'umisteni', draft, { required: true })),
        h('div', { class: 'grid2' }, field('Tlak P1 (MPa)', m, 'tlak_p1', draft, { inputmode: 'decimal' }), field('Tlak P2 (MPa)', m, 'tlak_p2', draft, { inputmode: 'decimal' })),
        h('div', { class: 'grid2' }, field('Rozdíl (MPa)', m, 'tlak_rozdil', draft, { inputmode: 'decimal' }), field('Průtok (l/s)', m, 'prutok', draft, { inputmode: 'decimal' })))),
      h('button', { class: 'btn', type: 'button', onclick: () => { draft.hyd_mereni.push({ id: '', umisteni: '', tlak_p1: '', tlak_p2: '', tlak_rozdil: '', prutok: '' }); rerender(); } }, '+ Přidat měření'),
      draft.stavy.hydranty === 'zmeny' ? [
        h('hr', { style: 'border:0;border-top:1px solid var(--line);margin:14px 0' }),
        draft.hyd_zavady.map((z, i) => h('div', { class: 'item' },
          h('div', { class: 'item-head' }, `Závada ${i + 1}`, removeBtn(() => { draft.hyd_zavady.splice(i, 1); rerender(); })),
          h('textarea', { value: z, oninput: e => { draft.hyd_zavady[i] = e.target.value; touch(draft); } }))),
        h('button', { class: 'btn', type: 'button', onclick: () => { draft.hyd_zavady.push(''); rerender(); } }, '+ Přidat závadu hydrantů'),
      ] : null,
    ], true));
  }

  // C – ostatní PBZ
  for (const role of PBZ) {
    if (draft.stavy[role] !== 'zmeny') continue;
    app.append(section(draft, role, `${ROLE_NAME[role]} (${draft.pbz[role].length})`, [
      draft.pbz[role].map((r, i) => h('div', { class: 'item' },
        h('div', { class: 'item-head' }, `Změna ${i + 1}`, removeBtn(() => { draft.pbz[role].splice(i, 1); rerender(); })),
        h('div', { class: 'grid2' }, field('Číslo / ID', r, 'id', draft), field('Umístění', r, 'umisteni', draft)),
        field('Popis závady nebo změny', r, 'popis', draft, { required: true, multiline: true }))),
      h('button', { class: 'btn', type: 'button', onclick: () => { draft.pbz[role].push({ id: '', umisteni: '', popis: '' }); rerender(); } }, '+ Přidat změnu'),
    ], true));
  }

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
    inv.rok && inv.rok !== year ? h('b', null, ` Automatický stav je spočítán pro rok ${inv.rok}, kontrola je v roce ${year}.`) : null)];
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
      (row && (row.akce === 'TZ' || row.akce === 'OPR')) ? h('p', { class: 'muted', style: 'margin:4px 0 0' }, `Provedeno v roce kontroly (${year}).`) : null));
  }
  return box;
}

function showResult(draft, box) {
  const errors = validate(draft);
  if (errors.length) {
    box.replaceChildren(h('div', { class: 'card errors' }, h('div', { style: 'font-weight:650' }, `Doplň ještě ${errors.length} ${errors.length === 1 ? 'věc' : 'věcí'}:`),
      h('ul', null, errors.map(e => h('li', null, e)))));
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const data = build(draft);
  const json = JSON.stringify(data, null, 2);
  const name = fileName(draft);
  box.replaceChildren(h('div', { class: 'card' },
    h('div', { class: 'ok' }, 'Checklist je úplný.'),
    h('p', { class: 'muted' }, 'Ulož ho do OneDrive (např. PRÁCE › checklisty). V programu na PC ho připoj přes „Připojit JSON…“ – zobrazí se kontrolní náhled.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary grow', type: 'button', onclick: () => shareJson(draft, json, name) }, 'Uložit / sdílet'),
      h('button', { class: 'btn', type: 'button', onclick: () => downloadJson(draft, json, name) }, 'Stáhnout')),
    h('details', { style: 'margin-top:10px' }, h('summary', { class: 'muted' }, 'Zobrazit JSON'), h('pre', null, json))));
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function markSaved(draft) { draft.stav = 'ulozeno'; draft.ulozeno = new Date().toISOString(); drafts[draft.id] = draft; saveDrafts(true); toast('Checklist uložen.'); }
async function shareJson(draft, json, name) {
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); markSaved(draft); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  downloadJson(draft, json, name);
}
function downloadJson(draft, json, name) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = h('a', { href: url, download: name, style: 'display:none' });
  document.body.append(link); link.click();
  setTimeout(() => { URL.revokeObjectURL(url); link.remove(); }, 2000);
  markSaved(draft);
}

function renderAbout() {
  clear(); setTitle('O aplikaci', true);
  const backup = () => downloadJsonRaw(JSON.stringify({ schema: 'revize-pwa-zaloha-1', koncepty: drafts, seznam }, null, 2), `revize_zaloha_${todayIso()}.json`);
  app.append(h('div', { class: 'card' },
    h('p', null, `Verze ${APP_VERSION}. Aplikace funguje i bez internetu. Seznam objektů a rozpracované checklisty jsou uložené jen v tomto telefonu.`),
    h('p', { class: 'muted' }, 'Na plochu ji přidáš v Safari: Sdílet › Přidat na plochu.'),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: backup }, 'Záloha všech checklistů'),
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

/* ------------------------------------------------------------------ start */
function updateOnline() { document.getElementById('offline').hidden = navigator.onLine; }
window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline);
updateOnline();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
window.revize = { build, validate, newDraft, icoOk };  // pro kontrolu a testy
route();
