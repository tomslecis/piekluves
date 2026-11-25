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

// Parses CSV exports from Chrome / Google Password Manager / Bitwarden / 1Password etc.
export function parseCsv(text) {
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
  if (clean.length < 2) return [];
  const head = clean[0].map((h) => h.trim().toLowerCase());
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
    return newEntry({ title: title || 'Bez nosaukuma', url, username: get('username'), password: get('password'), notes: get('notes') });
  });
}
