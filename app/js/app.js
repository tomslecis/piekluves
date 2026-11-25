import { createKey, keyForFile, seal, open, isVaultFile } from './crypto.js';
import { storage, emptyData, newEntry, mergeData, signature, liveEntries, parseCsv, groupList, groupOf, NO_GROUP } from './vault.js';
import { generatePassword, strength } from './generator.js';
import { sheets, isValidSheetUrl } from './sheets.js';

const $ = (id) => document.getElementById(id);
const DEVICE_KEY = 'piekluves.device';
const GEN_KEY = 'piekluves.generator';
const CLIPBOARD_CLEAR_MS = 30000;

// Session state. The key is a non-extractable CryptoKey; the master password is never stored.
const S = { key: null, kdf: null, data: null };
const keyCache = new Map(); // salt -> CryptoKey, for vaults re-keyed on another device
let editingId = null;
let lastActivity = Date.now();
let syncing = false, syncAgain = false, syncTimer = null;

/* ---------- helpers ---------- */

function show(name) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== `screen-${name}`;
  $('top-actions').hidden = name !== 'main';
  const focus = { setup: 'setup-pw', lock: 'unlock-pw', restore: 'restore-url', main: null }[name];
  if (focus && matchMedia('(pointer: fine)').matches) setTimeout(() => $(focus).focus(), 50);
}

let toastTimer;
function toast(msg, err = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), err ? 4500 : 2200);
}

function busy(btn, on) {
  if (btn) btn.disabled = on;
}

function deviceName() {
  const saved = localStorage.getItem(DEVICE_KEY);
  if (saved) return saved;
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Ierīce';
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString('lv-LV', { dateStyle: 'medium', timeStyle: 'short' });
}

function setMeter(el, pw) {
  const s = strength(pw);
  el.style.width = `${s.level * 25}%`;
  el.dataset.level = s.level;
  el.title = s.label;
}

function safeUrl(url) {
  try {
    const u = new URL(url.includes('://') ? url : `https://${url}`);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}

let clipToken = 0;
async function copyText(text, what = 'Nokopēts') {
  if (!text) return toast('Lauks ir tukšs', true);
  try {
    await navigator.clipboard.writeText(text);
    const mine = ++clipToken;
    toast(`${what} (starpliktuve tiks notīrīta pēc 30 s)`);
    setTimeout(() => { if (mine === clipToken) navigator.clipboard.writeText('').catch(() => {}); }, CLIPBOARD_CLEAR_MS);
  } catch {
    toast('Neizdevās nokopēt', true);
  }
}

// Small promise-based prompt. type: 'password' | 'text' | null (plain confirm).
function ask({ title, text = '', type = 'password', ok = 'Labi', danger = false }) {
  const dlg = $('ask-dialog'), input = $('ask-input'), okBtn = $('ask-ok');
  $('ask-title').textContent = title;
  $('ask-text').textContent = text;
  input.hidden = !type;
  input.type = type || 'text';
  input.value = '';
  okBtn.textContent = ok;
  okBtn.classList.toggle('danger', danger);
  dlg.showModal();
  if (type) input.focus();
  return new Promise((resolve) => {
    const done = (val) => {
      $('ask-form').onsubmit = null;
      $('ask-cancel').onclick = null;
      dlg.onclose = null;
      dlg.close();
      resolve(val);
    };
    $('ask-form').onsubmit = (e) => { e.preventDefault(); done(type ? input.value : true); };
    $('ask-cancel').onclick = () => done(type ? null : false);
    dlg.onclose = () => resolve(type ? null : false);
  });
}

function readFile(input) {
  const f = input.files[0];
  input.value = '';
  return f ? f.text() : Promise.resolve(null);
}

/* ---------- vault lifecycle ---------- */

async function persist({ sync = true } = {}) {
  const file = await seal(S.key, S.kdf, S.data);
  storage.save(file);
  if (sync && S.data.settings.autoBackup && isValidSheetUrl(S.data.settings.sheetUrl)) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => sync_(), 2500);
  }
}

function enterMain() {
  lastActivity = Date.now();
  $('search').value = '';
  render();
  show('main');
  updateSyncChip();
  if (S.data.settings.autoBackup && isValidSheetUrl(S.data.settings.sheetUrl)) sync_();
}

function lock() {
  S.key = S.kdf = S.data = null;
  keyCache.clear();
  editingId = null;
  activeGroup = null;
  clearTimeout(syncTimer);
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  $('list').replaceChildren();
  $('unlock-pw').value = '';
  $('unlock-error').textContent = '';
  show(storage.load() ? 'lock' : 'setup');
}

/* ---------- Google Sheets sync ---------- */

function setSync(state, label) {
  $('sync-dot').className = `dot ${state}`;
  $('sync-label').textContent = label;
  $('sync-btn').title = label;
}

function updateSyncChip() {
  if (!isValidSheetUrl(S.data?.settings.sheetUrl)) setSync('', 'Sheets nav pieslēgts');
}

// Pull the latest backup, merge entry-by-entry, save locally, push the result.
async function sync_({ manual = false } = {}) {
  if (!S.data) return;
  const s = S.data.settings;
  if (!isValidSheetUrl(s.sheetUrl)) {
    if (manual) openSettings();
    return;
  }
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  setSync('busy', 'Sinhronizē…');
  try {
    const remote = await sheets.latest(s);
    let upload = true;
    if (remote && isVaultFile(remote.file)) {
      const salt = remote.file.kdf.salt;
      let rkey = salt === S.kdf.salt ? S.key : keyCache.get(salt);
      if (!rkey) {
        const pw = await ask({
          title: 'Ievadi galveno paroli',
          text: 'Google Sheets kopija ir šifrēta ar citu galveno paroli (droši vien tā mainīta citā ierīcē).',
        });
        if (pw == null) throw new Error('Sinhronizācija atcelta');
        rkey = await keyForFile(pw, remote.file);
      }
      let rdata;
      try { rdata = await open(rkey, remote.file); } catch { throw new Error('Nepareiza parole Sheets kopijai'); }
      keyCache.set(salt, rkey);
      if (!S.data) return; // locked meanwhile
      const merged = mergeData(S.data, rdata);
      // The most recently changed master password wins on every device.
      if (salt !== S.kdf.salt && (rdata.keyChangedAt || 0) > (S.data.keyChangedAt || 0)) {
        S.key = rkey;
        S.kdf = remote.file.kdf;
        toast('Galvenā parole atjaunota no citas ierīces');
      }
      upload = signature(merged) !== signature(rdata) || salt !== S.kdf.salt;
      const changed = signature(merged) !== signature(S.data);
      S.data = merged;
      await persist({ sync: false });
      if (changed) render();
    }
    if (upload) await sheets.save(s, storage.load(), deviceName());
    setSync('ok', `Sinhronizēts ${new Date().toLocaleTimeString('lv-LV', { hour: '2-digit', minute: '2-digit' })}`);
    if (manual) toast('Sinhronizēts ar Google Sheets');
  } catch (e) {
    setSync('err', 'Sinhronizācijas kļūda');
    $('sync-btn').title = e.message;
    if (manual) toast(e.message, true);
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; sync_(); }
  }
}

/* ---------- list ---------- */

let activeGroup = null; // selected section filter, null = all

function entryRow(e) {
  const li = document.createElement('li');
  const btn = document.createElement('div');
  btn.className = 'item';
  btn.tabIndex = 0;
  btn.setAttribute('role', 'button');
  const av = document.createElement('span');
  av.className = 'avatar';
  av.textContent = (e.title || '?').trim()[0] || '?';
  const text = document.createElement('span');
  text.className = 'item-text';
  const t = document.createElement('span');
  t.className = 'item-title';
  t.textContent = e.title || 'Bez nosaukuma';
  const sub = document.createElement('span');
  sub.className = 'item-sub';
  sub.textContent = e.username || e.url || e.tags || '';
  text.append(t, sub);
  const copy = document.createElement('button');
  copy.className = 'item-copy';
  copy.textContent = 'Parole';
  copy.title = 'Kopēt paroli';
  copy.hidden = !e.password;
  copy.onclick = (ev) => { ev.stopPropagation(); copyText(e.password, 'Parole nokopēta'); };
  btn.append(av, text, copy);
  btn.onclick = () => openEntry(e.id);
  btn.onkeydown = (ev) => { if (ev.key === 'Enter') openEntry(e.id); };
  li.append(btn);
  return li;
}

function renderGroupChips(groups, total) {
  const bar = $('groups');
  bar.hidden = groups.length < 2;
  const chip = (label, value, n) => {
    const b = document.createElement('button');
    b.className = 'group-chip';
    b.classList.toggle('active', activeGroup === value);
    b.textContent = label;
    const c = document.createElement('span');
    c.textContent = n;
    b.append(c);
    b.onclick = () => { activeGroup = value; render(); };
    return b;
  };
  bar.replaceChildren(chip('Visas', null, total), ...groups.map(([g, n]) => chip(g, g, n)));
  $('group-options').replaceChildren(...groups.filter(([g]) => g !== NO_GROUP).map(([g]) => {
    const o = document.createElement('option');
    o.value = g;
    return o;
  }));
}

function render() {
  if (!S.data) return;
  const q = $('search').value.trim().toLowerCase();
  const all = liveEntries(S.data);
  const groups = groupList(all);
  if (activeGroup && !groups.some(([g]) => g === activeGroup)) activeGroup = null;
  renderGroupChips(groups, all.length);
  const items = all
    .filter((e) => !activeGroup || groupOf(e) === activeGroup)
    .filter((e) => !q || [e.title, e.username, e.url, e.tags, e.notes, e.group].some((v) => (v || '').toLowerCase().includes(q)))
    .sort((a, b) => (a.title || '').localeCompare(b.title || '', 'lv'));

  const list = $('list');
  if (activeGroup || groups.length < 2) {
    list.replaceChildren(...items.map(entryRow));
  } else {
    // "All" view: one heading per section, in the same order as the chips.
    const nodes = [];
    for (const [g] of groups) {
      const inGroup = items.filter((e) => groupOf(e) === g);
      if (!inGroup.length) continue;
      const head = document.createElement('li');
      head.className = 'group-head';
      head.textContent = g;
      nodes.push(head, ...inGroup.map(entryRow));
    }
    list.replaceChildren(...nodes);
  }
  $('empty').hidden = all.length > 0;
  $('count').textContent = all.length ? (q || activeGroup ? `${items.length} no ${all.length}` : `${all.length} piekļuves`) : '';
}

/* ---------- entry editor ---------- */

function openEntry(id) {
  const e = id ? S.data.entries.find((x) => x.id === id) : null;
  editingId = e ? e.id : null;
  const f = $('entry-form');
  for (const k of ['title', 'username', 'password', 'url', 'group', 'tags', 'notes']) f.elements[k].value = e ? e[k] || '' : '';
  if (!e && activeGroup && activeGroup !== NO_GROUP) f.elements.group.value = activeGroup;
  f.elements.password.type = 'password';
  $('pw-toggle').textContent = 'Rādīt';
  $('entry-heading').textContent = e ? e.title || 'Piekļuve' : 'Jauna piekļuve';
  $('entry-meta').textContent = e ? `Mainīts: ${fmtDate(e.updatedAt)}` : '';
  $('delete-btn').hidden = !e;
  updateUrlLink();
  setMeter($('entry-meter'), f.elements.password.value);
  $('entry-dialog').showModal();
  if (!e) f.elements.title.focus();
}

function updateUrlLink() {
  const a = $('open-url');
  const href = safeUrl($('entry-form').elements.url.value.trim());
  if (href) a.href = href; else a.removeAttribute('href');
  a.hidden = !href;
}

async function saveEntry(ev) {
  ev.preventDefault();
  const f = $('entry-form');
  const vals = {};
  for (const k of ['title', 'username', 'password', 'url', 'group', 'tags', 'notes']) vals[k] = f.elements[k].value.trim();
  vals.password = f.elements.password.value; // keep exact password, spaces included
  if (editingId) {
    const e = S.data.entries.find((x) => x.id === editingId);
    Object.assign(e, vals, { updatedAt: Date.now() });
  } else {
    S.data.entries.push(newEntry(vals));
  }
  await persist();
  render();
  $('entry-dialog').close();
  toast('Saglabāts');
}

async function deleteEntry() {
  const e = S.data.entries.find((x) => x.id === editingId);
  if (!e) return;
  const ok = await ask({ title: `Dzēst “${e.title}”?`, text: 'Šo darbību nevar atsaukt.', type: null, ok: 'Dzēst', danger: true });
  if (!ok) return;
  $('entry-dialog').close();
  // Tombstone: keeps id so the delete syncs to other devices, wipes the secrets.
  Object.assign(e, { title: '', username: '', password: '', url: '', notes: '', tags: '', deleted: true, updatedAt: Date.now() });
  await persist();
  render();
  toast('Izdzēsts');
}

/* ---------- generator ---------- */

function genOptions() {
  return {
    length: +$('gen-len').value,
    lower: $('gen-lower').checked,
    upper: $('gen-upper').checked,
    digits: $('gen-digits').checked,
    symbols: $('gen-symbols').checked,
  };
}

function regenerate() {
  const o = genOptions();
  $('gen-len-label').textContent = o.length;
  $('gen-output').textContent = generatePassword(o);
  localStorage.setItem(GEN_KEY, JSON.stringify(o));
}

function openGenerator() {
  try {
    const o = JSON.parse(localStorage.getItem(GEN_KEY) || 'null');
    if (o) {
      $('gen-len').value = o.length;
      for (const k of ['lower', 'upper', 'digits', 'symbols']) $(`gen-${k}`).checked = o[k];
    }
  } catch { /* ignore broken prefs */ }
  regenerate();
  $('gen-dialog').showModal();
}

/* ---------- settings ---------- */

function openSettings() {
  const s = S.data.settings;
  $('set-url').value = s.sheetUrl || '';
  $('set-token').value = s.sheetToken || '';
  $('set-token').type = 'password';
  $('token-toggle').textContent = 'Rādīt';
  $('set-auto').checked = !!s.autoBackup;
  $('set-lock').value = String(s.lockMinutes || 5);
  $('set-device').value = deviceName();
  $('sheets-status').textContent = isValidSheetUrl(s.sheetUrl) ? 'Pieslēgts.' : 'Nav pieslēgts.';
  $('settings-dialog').showModal();
}

async function saveSheets(ev) {
  ev.preventDefault();
  const url = $('set-url').value.trim(), token = $('set-token').value.trim();
  const status = $('sheets-status');
  if (url && !isValidSheetUrl(url)) {
    status.textContent = 'Saitei jāizskatās šādi: https://script.google.com/macros/s/…/exec';
    return;
  }
  Object.assign(S.data.settings, { sheetUrl: url, sheetToken: token, autoBackup: $('set-auto').checked });
  await persist({ sync: false });
  if (!url) { status.textContent = 'Atvienots.'; updateSyncChip(); return; }
  status.textContent = 'Pārbauda savienojumu…';
  try {
    await sheets.ping(S.data.settings);
    status.textContent = 'Savienojums strādā. Sinhronizē…';
    await sync_({ manual: true });
    status.textContent = 'Pieslēgts un sinhronizēts.';
  } catch (e) {
    status.textContent = `Kļūda: ${e.message}`;
  }
}

async function changePassword(ev) {
  ev.preventDefault();
  const err = $('pw-error');
  const old = $('pw-old').value, pw = $('pw-new').value;
  if (pw !== $('pw-new2').value) return (err.textContent = 'Jaunās paroles nesakrīt');
  if (pw.length < 10) return (err.textContent = 'Vismaz 10 simboli');
  err.textContent = 'Pārbauda…';
  try {
    await open(await keyForFile(old, storage.load()), storage.load());
  } catch {
    err.textContent = 'Pašreizējā parole nav pareiza';
    return;
  }
  const { key, kdf } = await createKey(pw);
  S.key = key;
  S.kdf = kdf;
  S.data.keyChangedAt = Date.now();
  keyCache.clear();
  await persist();
  $('pw-form').reset();
  err.textContent = '';
  $('pw-dialog').close();
  toast('Galvenā parole nomainīta');
}

// Google Sheets names exports "<Spreadsheet> - <Tab>.csv"; the tab name becomes the section.
function groupFromFileName(name) {
  const base = name.replace(/\.csv$/i, '');
  return (base.includes(' - ') ? base.split(' - ').pop() : base).trim();
}

async function importCsv() {
  const input = $('import-csv');
  const files = [...input.files];
  input.value = '';
  if (!files.length) return;
  const rows = [];
  for (const f of files) rows.push(...parseCsv(await f.text(), groupFromFileName(f.name)));
  if (!rows.length) return toast('CSV failos neatradu nevienu piekļuvi', true);
  const seen = new Set(liveEntries(S.data).map((e) => `${e.url}|${e.username}|${e.password}`));
  const fresh = rows.filter((r) => !seen.has(`${r.url}|${r.username}|${r.password}`));
  S.data.entries.push(...fresh);
  await persist();
  render();
  toast(`Importētas ${fresh.length} piekļuves${rows.length > fresh.length ? ` (${rows.length - fresh.length} jau bija)` : ''}. Izdzēs CSV failu!`);
}

async function loadEncryptedFile(text) {
  let file;
  try { file = JSON.parse(text); } catch { file = null; }
  if (!isVaultFile(file)) throw new Error('Tas nav Piekļuves šifrēts fails');
  const pw = await ask({ title: 'Faila galvenā parole', text: 'Ievadi paroli, ar kuru šis fails tika šifrēts.' });
  if (pw == null) return null;
  const key = await keyForFile(pw, file);
  try { return { key, file, data: await open(key, file) }; } catch { throw new Error('Nepareiza parole'); }
}

async function importJson() {
  const text = await readFile($('import-json'));
  if (!text) return;
  try {
    const r = await loadEncryptedFile(text);
    if (!r) return;
    S.data = mergeData(S.data, r.data);
    await persist();
    render();
    toast('Fails apvienots ar seifu');
  } catch (e) { toast(e.message, true); }
}

function exportJson() {
  const blob = new Blob([JSON.stringify(storage.load())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `piekluves-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function wipe() {
  const v = await ask({
    title: 'Dzēst seifu no šīs ierīces?',
    text: 'Google Sheets kopijas paliks. Lai apstiprinātu, ieraksti DZĒST.',
    type: 'text', ok: 'Dzēst', danger: true,
  });
  if ((v || '').trim().toUpperCase() !== 'DZĒST') return;
  storage.clear();
  lock();
  toast('Seifs izdzēsts no šīs ierīces');
}

/* ---------- auto-lock ---------- */

function checkIdle() {
  if (!S.key) return;
  const mins = S.data.settings.lockMinutes || 5;
  if (Date.now() - lastActivity > mins * 60000) lock();
}

/* ---------- wiring ---------- */

function wire() {
  for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => b.closest('dialog').close();

  // Setup
  $('setup-pw').oninput = () => setMeter($('setup-meter'), $('setup-pw').value);
  $('setup-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const pw = $('setup-pw').value, err = $('setup-error');
    if (pw.length < 10) return (err.textContent = 'Vismaz 10 simboli');
    if (pw !== $('setup-pw2').value) return (err.textContent = 'Paroles nesakrīt');
    if (strength(pw).level < 2) return (err.textContent = 'Parole par vāju: pievieno vairāk vārdu, ciparus vai simbolus');
    err.textContent = '';
    const btn = ev.submitter;
    busy(btn, true);
    const { key, kdf } = await createKey(pw);
    Object.assign(S, { key, kdf, data: emptyData() });
    await persist({ sync: false });
    $('setup-form').reset();
    busy(btn, false);
    enterMain();
    toast('Seifs izveidots. Iestatījumos pieslēdz Google Sheets kopiju.');
  };
  $('go-restore').onclick = () => show('restore');
  $('back-setup').onclick = () => show(storage.load() ? 'lock' : 'setup');

  // Restore from Sheets
  $('restore-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const err = $('restore-error'), btn = ev.submitter;
    const settings = { ...emptyData().settings, sheetUrl: $('restore-url').value.trim(), sheetToken: $('restore-token').value.trim() };
    if (!isValidSheetUrl(settings.sheetUrl)) return (err.textContent = 'Saitei jāizskatās šādi: https://script.google.com/macros/s/…/exec');
    err.textContent = 'Ielādē…';
    busy(btn, true);
    try {
      const remote = await sheets.latest(settings);
      if (!remote) throw new Error('Šajā Google Sheets vēl nav nevienas kopijas');
      const key = await keyForFile($('restore-pw').value, remote.file);
      let data;
      try { data = await open(key, remote.file); } catch { throw new Error('Nepareiza galvenā parole'); }
      data.settings = { ...data.settings, sheetUrl: settings.sheetUrl, sheetToken: settings.sheetToken };
      Object.assign(S, { key, kdf: remote.file.kdf, data });
      await persist({ sync: false });
      $('restore-form').reset();
      err.textContent = '';
      enterMain();
      toast(`Atjaunots: ${liveEntries(data).length} piekļuves`);
    } catch (e) {
      err.textContent = e.message;
    } finally { busy(btn, false); }
  };
  $('restore-file').onchange = async () => {
    const text = await readFile($('restore-file'));
    if (!text) return;
    try {
      const r = await loadEncryptedFile(text);
      if (!r) return;
      Object.assign(S, { key: r.key, kdf: r.file.kdf, data: r.data });
      await persist({ sync: false });
      enterMain();
      toast('Seifs atjaunots no faila');
    } catch (e) { $('restore-error').textContent = e.message; }
  };

  // Unlock
  $('unlock-form').onsubmit = async (ev) => {
    ev.preventDefault();
    const file = storage.load(), err = $('unlock-error'), btn = $('unlock-btn');
    busy(btn, true);
    err.textContent = '';
    try {
      const key = await keyForFile($('unlock-pw').value, file);
      const data = await open(key, file);
      Object.assign(S, { key, kdf: file.kdf, data });
      $('unlock-pw').value = '';
      enterMain();
    } catch {
      err.textContent = 'Nepareiza parole';
      $('unlock-pw').select();
    } finally { busy(btn, false); }
  };

  // Main
  $('search').oninput = render;
  $('add-btn').onclick = () => openEntry(null);
  $('lock-btn').onclick = lock;
  $('settings-btn').onclick = openSettings;
  $('sync-btn').onclick = () => sync_({ manual: true });

  // Entry
  $('entry-form').onsubmit = saveEntry;
  $('delete-btn').onclick = deleteEntry;
  $('entry-form').elements.url.oninput = updateUrlLink;
  $('entry-form').elements.password.oninput = (e) => setMeter($('entry-meter'), e.target.value);
  $('pw-toggle').onclick = () => {
    const p = $('entry-form').elements.password;
    p.type = p.type === 'password' ? 'text' : 'password';
    $('pw-toggle').textContent = p.type === 'password' ? 'Rādīt' : 'Slēpt';
  };
  for (const b of document.querySelectorAll('[data-copy]')) {
    b.onclick = () => copyText($('entry-form').elements[b.dataset.copy].value, b.dataset.copy === 'password' ? 'Parole nokopēta' : 'Nokopēts');
  }

  // Generator
  $('open-generator').onclick = openGenerator;
  for (const id of ['gen-len', 'gen-lower', 'gen-upper', 'gen-digits', 'gen-symbols']) $(id).oninput = regenerate;
  $('gen-again').onclick = regenerate;
  $('gen-use').onclick = () => {
    const p = $('entry-form').elements.password;
    p.value = $('gen-output').textContent;
    p.type = 'text';
    $('pw-toggle').textContent = 'Slēpt';
    setMeter($('entry-meter'), p.value);
    $('gen-dialog').close();
  };

  // Settings
  $('sheets-form').onsubmit = saveSheets;
  $('sync-now').onclick = () => sync_({ manual: true });
  $('token-toggle').onclick = () => {
    const t = $('set-token');
    t.type = t.type === 'password' ? 'text' : 'password';
    $('token-toggle').textContent = t.type === 'password' ? 'Rādīt' : 'Slēpt';
  };
  $('set-auto').onchange = async () => { S.data.settings.autoBackup = $('set-auto').checked; await persist({ sync: false }); };
  $('set-lock').onchange = async () => { S.data.settings.lockMinutes = +$('set-lock').value; await persist({ sync: false }); };
  $('set-device').onchange = () => {
    const v = $('set-device').value.trim();
    if (v) localStorage.setItem(DEVICE_KEY, v); else localStorage.removeItem(DEVICE_KEY);
  };
  $('change-pw-btn').onclick = () => { $('pw-form').reset(); $('pw-error').textContent = ''; $('pw-dialog').showModal(); };
  $('pw-form').onsubmit = changePassword;
  $('import-csv').onchange = importCsv;
  $('import-json').onchange = importJson;
  $('export-json').onclick = exportJson;
  $('wipe-btn').onclick = wipe;

  // Activity tracking for auto-lock
  for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) {
    addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true, capture: true });
  }
  setInterval(checkIdle, 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkIdle(); });
}

function boot() {
  if (!window.isSecureContext || !crypto.subtle) {
    document.body.textContent = 'Piekļuves darbojas tikai caur https:// (vai localhost).';
    return;
  }
  wire();
  if (window.piekluvesDesktop) {
    document.documentElement.classList.add('desktop');
    window.piekluvesDesktop.onLock(() => { if (S.key) lock(); });
  }
  navigator.storage?.persist?.().catch(() => {});
  const preview = new URLSearchParams(location.search).has('preview');
  if ('serviceWorker' in navigator && !preview) navigator.serviceWorker.register('sw.js').catch(() => {});
  show(storage.load() ? 'lock' : 'setup');
}

boot();
