// Talks to the Google Apps Script web app bound to the backup spreadsheet.
// Only the already-encrypted vault file is sent; the sheet never sees plaintext.

export function isValidSheetUrl(url) {
  return /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test((url || '').trim());
}

async function call(settings, payload) {
  if (!isValidSheetUrl(settings.sheetUrl)) throw new Error('Nav iestatīta pareiza Google Sheets saite');
  // text/plain body keeps it a "simple" CORS request (no preflight, which Apps Script does not support).
  const res = await fetch(settings.sheetUrl.trim(), {
    method: 'POST',
    body: JSON.stringify({ ...payload, token: settings.sheetToken }),
  });
  if (!res.ok) throw new Error(`Google Sheets atbilde: HTTP ${res.status}`);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error === 'unauthorized' ? 'Nepareiza piekļuves atslēga (token)' : json.error || 'Kļūda');
  return json;
}

export const sheets = {
  ping: (s) => call(s, { action: 'ping' }),
  save: (s, file, device) => call(s, { action: 'save', device, data: JSON.stringify(file) }),
  async latest(s) {
    const j = await call(s, { action: 'latest' });
    return j.data ? { file: JSON.parse(j.data), savedAt: j.savedAt, device: j.device } : null;
  },
};
