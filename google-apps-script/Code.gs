/**
 * Piekļuves: Google Sheets backup endpoint.
 * Stores ONLY the already-encrypted vault file sent by the app. Keeps the newest KEEP versions.
 *
 * Setup: Extensions → Apps Script in your spreadsheet, paste this file, run setup() once
 * (copy the token from the log), then Deploy → New deployment → Web app,
 * Execute as: Me, Who has access: Anyone. Copy the /exec URL into the app.
 */
const SHEET_NAME = 'Backups';
const KEEP = 50;
const CHUNK = 40000; // a cell holds max 50 000 characters
const PREFIX = 'c:'; // stops Sheets from reading a chunk as a formula or number

function setup() {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('TOKEN', token);
  sheet_();
  Logger.log('Tavs token (ielīmē lietotnē): ' + token);
}

function doGet() {
  return json_({ ok: true, app: 'Piekluves backup' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!token || !safeEqual_(String(req.token || ''), token)) return json_({ ok: false, error: 'unauthorized' });
    switch (req.action) {
      case 'ping': return json_({ ok: true });
      case 'save': return json_(save_(req));
      case 'latest': return json_(latest_());
      default: return json_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

function save_(req) {
  const data = String(req.data || '');
  const parsed = JSON.parse(data);
  if (parsed.v !== 1 || !parsed.kdf || !parsed.iv || !parsed.ct) throw new Error('not an encrypted vault');
  const chunks = [];
  for (let i = 0; i < data.length; i += CHUNK) chunks.push(PREFIX + data.slice(i, i + CHUNK));
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = sheet_();
    const savedAt = new Date().toISOString();
    const row = [savedAt, String(req.device || '').slice(0, 40), data.length, chunks.length].concat(chunks);
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@').setValues([row]);
    const extra = sh.getLastRow() - 1 - KEEP;
    if (extra > 0) sh.deleteRows(2, extra);
    return { ok: true, savedAt: savedAt };
  } finally {
    lock.releaseLock();
  }
}

function latest_() {
  const sh = sheet_();
  const last = sh.getLastRow();
  if (last < 2) return { ok: true, data: null };
  const head = sh.getRange(last, 1, 1, 4).getValues()[0];
  const n = Number(head[3]);
  const parts = sh.getRange(last, 5, 1, n).getValues()[0];
  const data = parts.map(function (p) { return String(p).slice(PREFIX.length); }).join('');
  return { ok: true, data: data, savedAt: String(head[0]), device: String(head[1]) };
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['Laiks', 'Ierīce', 'Izmērs', 'Daļas', 'Šifrēti dati →']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
