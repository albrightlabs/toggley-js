/**
 * A context is a flat object with an optional string "key" plus attributes
 * (strings, numbers, booleans, or arrays of those). Ported from the Toggley
 * plugin's Context.php; the shared vectors in spec/ keep them in step.
 */

export const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isValidContext(context) {
  if (context === null || context === undefined) {
    return true;
  }

  // PHP decodes {} and [] alike, so an empty array is an empty context there too.
  if (Array.isArray(context)) {
    return context.length === 0;
  }

  if (!isPlainObject(context)) {
    return false;
  }

  if (hasOwn(context, 'key') && context.key !== null && context.key !== undefined && typeof context.key !== 'string') {
    return false;
  }

  if (hasOwn(context, 'kind') && context.kind !== null && context.kind !== undefined && context.kind !== 'user') {
    return false;
  }

  return true;
}

export function contextKey(context) {
  return isPlainObject(context) && typeof context.key === 'string' ? context.key : null;
}

/** lookup returns [found, value]; null values count as missing. */
export function lookup(context, attribute) {
  if (!isPlainObject(context) || attribute === '' || !hasOwn(context, attribute) || context[attribute] === null || context[attribute] === undefined) {
    return [false, null];
  }

  return [true, context[attribute]];
}
