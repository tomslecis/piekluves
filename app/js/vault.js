// Vault data model, local storage and merge logic (pure functions are testable in Node).
const STORE_KEY = 'piekluves.vault.v1';

export const storage = {
  load() {
    const s = localStorage.getItem(STORE_KEY);
    return s ? JSON.parse(s) : null;
  },
  save(file) {
    localStorage.setItem(STORE_KEY, JSON.stringify(file));
  },
  clear() {
    localStorage.removeItem(STORE_KEY);
  },
};

export function emptyData() {
  return {
    entries: [],
    settings: { sheetUrl: '', sheetToken: '', autoBackup: true, lockMinutes: 5 },
    keyChangedAt: Date.now(),
  };
}

export function newEntry(fields = {}) {
  return {
    id: crypto.randomUUID(),
    title: '',
    username: '',
    password: '',
    url: '',
    notes: '',
    tags: '',
    ...fields,
    updatedAt: Date.now(),
  };
}

// Entry-level last-write-wins merge. Deleted entries stay as tombstones so deletes sync too.
export function mergeData(local, remote) {
  const byId = new Map();
  for (const e of [...local.entries, ...remote.entries]) {
    const cur = byId.get(e.id);
    if (!cur || (e.updatedAt || 0) > (cur.updatedAt || 0)) byId.set(e.id, e);
  }
  const settings = local.settings && local.settings.sheetUrl ? local.settings : { ...local.settings, ...remote.settings };
  return {
    ...local,
    settings,
    entries: [...byId.values()],
    keyChangedAt: Math.max(local.keyChangedAt || 0, remote.keyChangedAt || 0),
  };
}

// Cheap fingerprint to tell whether two vaults hold the same entry versions.
export function signature(data) {
  return data.entries.map((e) => `${e.id}:${e.updatedAt}`).sort().join('|');
}

export function liveEntries(data) {
  return data.entries.filter((e) => !e.deleted);
}

const URL_RE = /^(https?:\/\/|www\.)\S+$/i;
const HEADER_RE = /^(login|user(name)?|lietot[āa]j(s|vārds)|e-?pasts|email|password|parole)\s*$/i;

// Parses CSV exports from Chrome / Google Password Manager / Bitwarden / 1Password etc.
// Files without such headers (e.g. a hand-made Google Sheet tab) fall back to parseLooseRows.
export function parseCsv(text, tag = '') {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const clean = rows.filter((r) => r.some((v) => v.trim()));
  if (!clean.length) return [];
  const head = clean[0].map((h) => h.trim().toLowerCase());
  const known = head.includes('password') && head.some((h) => ['name', 'title', 'url', 'login_uri'].includes(h));
  if (!known) return parseLooseRows(clean, tag);
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const idx = {
    title: col('name', 'title'),
    url: col('url', 'login_uri', 'website', 'web site'),
    username: col('username', 'login_username', 'login', 'email'),
    password: col('password', 'login_password'),
    notes: col('note', 'notes', 'extra'),
  };
  if (idx.password < 0) return [];
  return clean.slice(1).map((r) => {
    const get = (k) => (idx[k] >= 0 ? (r[idx[k]] || '').trim() : '');
    const url = get('url');
    let title = get('title');
    if (!title && url) { try { title = new URL(url).hostname.replace(/^www\./, ''); } catch { title = url; } }
    return newEntry({ title: title || 'Bez nosaukuma', url, username: get('username'), password: get('password'), notes: get('notes'), tags: tag });
  });
}

// Positional layout: A = name, B = login, C = password, rest = notes.
// A row with only column A filled is a section heading and becomes a tag for the rows below it.
export function parseLooseRows(rows, tag = '') {
  const out = [];
  let section = '';
  for (const r of rows) {
    const cells = r.map((v) => (v || '').trim());
    const filled = cells.filter(Boolean);
    if (!filled.length) continue;
    if (filled.length === 1 && cells[0]) { section = cells[0]; continue; }
    if (HEADER_RE.test(cells[1] || '') && HEADER_RE.test(cells[2] || '')) continue;
    let url = '';
    const rest = cells.slice(3).filter(Boolean).filter((v) => {
      if (!url && URL_RE.test(v)) { url = v; return false; }
      return true;
    });
    let title = cells[0];
    if (!title && url) title = url.replace(/^https?:\/\/(www\.)?/i, '').split('/')[0];
    out.push(newEntry({
      title: title || section || 'Bez nosaukuma',
      username: cells[1] || '',
      password: cells[2] || '',
      url,
      notes: rest.join('\n'),
      tags: [...new Set([tag, section].filter(Boolean))].join(', '),
    }));
  }
  return out;
}
