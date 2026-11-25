// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKey, keyForFile, seal, open, isVaultFile } from '../app/js/crypto.js';
import { emptyData, newEntry, mergeData, signature, liveEntries, parseCsv } from '../app/js/vault.js';
import { generatePassword, strength } from '../app/js/generator.js';
import { isValidSheetUrl } from '../app/js/sheets.js';

test('encrypt/decrypt roundtrip and wrong password fails', async () => {
  const { key, kdf } = await createKey('correct horse battery staple');
  const data = emptyData();
  data.entries.push(newEntry({ title: 'Banka', password: 'pā$$wörd' }));
  const file = await seal(key, kdf, data);
  assert.ok(isVaultFile(file));
  assert.ok(!JSON.stringify(file).includes('Banka'));
  const back = await open(await keyForFile('correct horse battery staple', file), file);
  assert.equal(back.entries[0].password, 'pā$$wörd');
  await assert.rejects(open(await keyForFile('wrong password!!', file), file));
});

test('tampered ciphertext is rejected', async () => {
  const { key, kdf } = await createKey('another long password');
  const file = await seal(key, kdf, emptyData());
  const ct = Buffer.from(file.ct, 'base64');
  ct[0] ^= 1;
  await assert.rejects(open(key, { ...file, ct: ct.toString('base64') }));
});

test('merge keeps newest version and syncs deletes', () => {
  const a = emptyData(), b = emptyData();
  const e = newEntry({ title: 'Old', updatedAt: 1 });
  e.updatedAt = 1;
  a.entries.push({ ...e });
  b.entries.push({ ...e, title: 'New', updatedAt: 5 });
  const gone = { ...newEntry({ title: 'x' }), updatedAt: 2 };
  a.entries.push(gone);
  b.entries.push({ ...gone, deleted: true, password: '', updatedAt: 3 });
  const m = mergeData(a, b);
  assert.equal(m.entries.find((x) => x.id === e.id).title, 'New');
  assert.equal(liveEntries(m).length, 1);
  assert.equal(signature(m), signature(mergeData(b, a)));
});

test('csv import (Chrome format)', () => {
  const csv = 'name,url,username,password,note\r\nGmail,https://accounts.google.com,me@x.lv,"a,b""c",\n,https://www.example.com/login,u,p,hi\n';
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].password, 'a,b"c');
  assert.equal(rows[1].title, 'example.com');
  assert.equal(rows[1].notes, 'hi');
});

test('csv import (hand-made sheet without headers)', () => {
  const csv = ',Login ,Password,Crack\nBankas\nSwed,user1,pw1,kods 12,https://swedbank.lv\n,user2,pw2\n';
  const rows = parseCsv(csv, 'Darbs');
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].title, rows[0].username, rows[0].password, rows[0].url, rows[0].notes], ['Swed', 'user1', 'pw1', 'https://swedbank.lv', 'kods 12']);
  assert.equal(rows[0].tags, 'Bankas');
  assert.equal(rows[0].group, 'Darbs');
  assert.equal(rows[1].title, 'Bankas');
});

test('generator respects options and length', () => {
  for (let i = 0; i < 50; i++) {
    const pw = generatePassword({ length: 24, symbols: false });
    assert.equal(pw.length, 24);
    assert.match(pw, /^[A-Za-z0-9]+$/);
    assert.match(pw, /[0-9]/);
  }
  assert.equal(strength(generatePassword()).level, 4);
  assert.equal(strength('abc').level, 1);
});

test('sheet url validation', () => {
  assert.ok(isValidSheetUrl('https://script.google.com/macros/s/AKfycbx-abc_123/exec'));
  assert.ok(!isValidSheetUrl('https://evil.com/macros/s/x/exec'));
  assert.ok(!isValidSheetUrl('javascript:alert(1)'));
});
