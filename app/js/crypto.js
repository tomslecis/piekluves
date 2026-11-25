// Client-side encryption: PBKDF2-SHA256 -> AES-256-GCM. Nothing leaves the device unencrypted.
const enc = new TextEncoder();
const dec = new TextDecoder();
const AAD = enc.encode('piekluves-v1');

export const KDF_ITERATIONS = 600000;

export function toB64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function fromB64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function deriveKey(password, salt, iterations = KDF_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Creates a fresh key with a new random salt.
export async function createKey(password) {
  const salt = randomBytes(16);
  const kdf = { name: 'PBKDF2', hash: 'SHA-256', iterations: KDF_ITERATIONS, salt: toB64(salt) };
  return { key: await deriveKey(password, salt), kdf };
}

// Derives the key matching an encrypted file's KDF parameters.
export function keyForFile(password, file) {
  return deriveKey(password, fromB64(file.kdf.salt), file.kdf.iterations);
}

export async function seal(key, kdf, data) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: AAD },
    key,
    enc.encode(JSON.stringify(data)),
  );
  return { v: 1, kdf, iv: toB64(iv), ct: toB64(ct) };
}

// Throws if the key is wrong or the file was tampered with.
export async function open(key, file) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(file.iv), additionalData: AAD },
    key,
    fromB64(file.ct),
  );
  return JSON.parse(dec.decode(pt));
}

export function isVaultFile(f) {
  return !!(f && f.v === 1 && f.kdf && f.kdf.salt && f.iv && f.ct);
}
