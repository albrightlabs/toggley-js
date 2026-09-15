/**
 * Bucketer places a context in a bucket from 0 to 99999 for percentage splits.
 *   X = first 8 hex characters of sha256(input) as an unsigned 32-bit integer
 *   v2:     "{salt}.{key}" → X % 100000
 *   legacy: "{salt}:{key}" → (X % 100) * 1000
 * Ported from Bucketer.php.
 */
import { createHash, randomInt } from 'node:crypto';
import { lookup } from './context.js';

export const BUCKETS = 100000;

export const nativeRandom = { nextInt: (max) => randomInt(max) };

export function fixedRandom(value) {
  return { nextInt: (max) => Math.max(0, Math.min(max - 1, value)) };
}

/** bucketKey: strings as-is, integral numbers within ±2^53-1 as digits, anything else unkeyed (null). */
export function bucketKey(context, bucketBy = 'key') {
  const [found, value] = lookup(context, bucketBy);
  if (!found) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' && Number.isInteger(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER) {
    return String(value === 0 ? 0 : value);
  }
  return null;
}

export function bucket(hash, salt, key, random = nativeRandom) {
  if (key === null) {
    const n = random.nextInt(BUCKETS);
    return hash === 'legacy' ? Math.floor(n / 1000) * 1000 : n;
  }
  if (hash === 'legacy') {
    return (prefix(`${salt}:${key}`) % 100) * 1000;
  }
  return prefix(`${salt}.${key}`) % BUCKETS;
}

function prefix(input) {
  return parseInt(createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 8), 16);
}
