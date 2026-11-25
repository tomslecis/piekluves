// Cryptographically secure password generator.
const SETS = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digits: '23456789',
  symbols: '!@#$%^&*-_=+?.:',
};

function randInt(max) {
  // Rejection sampling avoids modulo bias.
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % max;
}

export function generatePassword({ length = 20, lower = true, upper = true, digits = true, symbols = true } = {}) {
  const pools = Object.entries({ lower, upper, digits, symbols }).filter(([, on]) => on).map(([k]) => SETS[k]);
  if (!pools.length) pools.push(SETS.lower);
  const all = pools.join('');
  // Guarantee at least one char from each chosen set, then shuffle.
  const chars = pools.map((p) => p[randInt(p.length)]);
  while (chars.length < length) chars.push(all[randInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.slice(0, length).join('');
}

// Rough entropy estimate in bits, for the strength meter.
export function strength(pw) {
  if (!pw) return { bits: 0, label: '', level: 0 };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 32;
  const unique = new Set(pw).size;
  const bits = Math.round(Math.log2(pool || 1) * Math.min(pw.length, unique * 1.5));
  const level = bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { bits, level, label: ['', 'Vāja', 'Vidēja', 'Laba', 'Ļoti laba'][level] };
}
