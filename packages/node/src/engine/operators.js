/**
 * Operators compare one context attribute value with one clause value. Types are
 * strict: strings only equal strings, booleans only booleans, numbers compare as
 * doubles. Ported from Operators.php.
 */

export const OPERATORS = [
  'in', 'contains', 'startsWith', 'endsWith',
  'lessThan', 'lessThanOrEqual', 'greaterThan', 'greaterThanOrEqual',
  'before', 'after', 'segmentMatch',
];

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

export function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function equals(a, b) {
  if (typeof a === 'string' || typeof b === 'string') {
    return typeof a === 'string' && typeof b === 'string' && a === b;
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return typeof a === 'boolean' && typeof b === 'boolean' && a === b;
  }
  return isNumber(a) && isNumber(b) && a === b;
}

export function apply(op, attribute, value) {
  switch (op) {
    case 'in':
      return equals(attribute, value);
    case 'contains':
      return typeof attribute === 'string' && typeof value === 'string' && attribute.includes(value);
    case 'startsWith':
      return typeof attribute === 'string' && typeof value === 'string' && attribute.startsWith(value);
    case 'endsWith':
      return typeof attribute === 'string' && typeof value === 'string' && attribute.endsWith(value);
    case 'lessThan':
      return isNumber(attribute) && isNumber(value) && attribute < value;
    case 'lessThanOrEqual':
      return isNumber(attribute) && isNumber(value) && attribute <= value;
    case 'greaterThan':
      return isNumber(attribute) && isNumber(value) && attribute > value;
    case 'greaterThanOrEqual':
      return isNumber(attribute) && isNumber(value) && attribute >= value;
    case 'before':
    case 'after': {
      const a = timestamp(attribute);
      const b = timestamp(value);
      if (a === null || b === null) {
        return false;
      }
      return op === 'before' ? a < b : a > b;
    }
    default:
      return false;
  }
}

/** timestamp: epoch milliseconds for a number, or a strict RFC 3339 string with a timezone; null otherwise. */
export function timestamp(value) {
  if (isNumber(value)) {
    return value;
  }

  const m = typeof value === 'string' ? value.match(DATE_PATTERN) : null;
  if (!m) {
    return null;
  }

  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) {
    return null;
  }

  let offsetSeconds = 0;
  if (m[8] !== 'Z') {
    const offsetHours = Number(m[8].slice(1, 3));
    const offsetMinutes = Number(m[8].slice(4, 6));
    if (offsetHours > 23 || offsetMinutes > 59) {
      return null;
    }
    offsetSeconds = (offsetHours * 3600 + offsetMinutes * 60) * (m[8][0] === '-' ? -1 : 1);
  }

  const millis = m[7] ? Number(m[7].slice(1, 4).padEnd(3, '0')) : 0;
  const seconds = daysFromCivil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second - offsetSeconds;

  return seconds * 1000 + millis;
}

function daysInMonth(year, month) {
  if (month === 2) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.trunc(y / 400);
  const yoe = y - era * 400;
  const doy = Math.trunc((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.trunc(yoe / 4) - Math.trunc(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}
