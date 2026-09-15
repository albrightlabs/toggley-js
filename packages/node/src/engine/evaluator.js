/**
 * Evaluator decides which variation a context gets. Ported from Evaluator.php, the
 * reference implementation; spec/evaluation-vectors.json must pass unchanged.
 *
 * Order: missing flag → invalid context / malformed flag → off → individual
 * targets → rules (all clauses) → fallthrough.
 */
import { contextKey, hasOwn, isPlainObject, isValidContext, lookup } from './context.js';
import { OPERATORS, apply, isNumber } from './operators.js';
import { bucket, bucketKey, nativeRandom } from './bucketer.js';

export const TYPES = ['boolean', 'string', 'number', 'json'];

const own = (object, key) => (isPlainObject(object) && hasOwn(object, key) ? object[key] : undefined);

export function evaluate(document, flagKey, context, defaultValue = null, random = nativeRandom) {
  return evaluateFlag(own(document?.flags, flagKey) ?? null, document?.segments ?? {}, context, defaultValue, random);
}

export function evaluateAll(document, context, random = nativeRandom) {
  const results = {};
  for (const key of Object.keys(isPlainObject(document?.flags) ? document.flags : {})) {
    results[key] = evaluateFlag(document.flags[key], document.segments ?? {}, context, null, random);
  }
  return results;
}

export function evaluateFlag(flag, segments, context, defaultValue = null, random = nativeRandom) {
  if (flag === null || flag === undefined) {
    return error('FLAG_NOT_FOUND', defaultValue, null);
  }

  const version = Number.isInteger(flag.version) ? flag.version : null;

  if (!isValidContext(context)) {
    return error('CONTEXT_INVALID', defaultValue, version);
  }

  if (!isPlainObject(flag) || !isWellFormed(flag)) {
    return error('MALFORMED_FLAG', defaultValue, version);
  }

  const values = new Map(flag.variations.map((variation) => [variation.id, variation.value]));

  if (!flag.on) {
    const off = flag.offVariation ?? null;
    return off === null
      ? result(defaultValue, null, { kind: 'OFF' }, null, version)
      : result(values.get(off), off, { kind: 'OFF' }, null, version);
  }

  const key = contextKey(context);

  if (key !== null) {
    for (const target of listOrEmpty(flag.targets ?? [])) {
      if (listOrEmpty(target.values).includes(key)) {
        return result(values.get(target.variation), target.variation, { kind: 'TARGET_MATCH' }, null, version);
      }
    }
  }

  const rules = listOrEmpty(flag.rules ?? []);
  for (let index = 0; index < rules.length; index++) {
    if (ruleMatches(rules[index], context, segments)) {
      return serve(flag, rules[index], values, { kind: 'RULE_MATCH', ruleIndex: index, ruleId: rules[index].id ?? null }, context, random, version);
    }
  }

  return serve(flag, flag.fallthrough, values, { kind: 'FALLTHROUGH' }, context, random, version);
}

/** typed: a value of the wrong type becomes the caller's default with ERROR WRONG_TYPE. */
export function typed(res, type, defaultValue) {
  if (res.variation === null || valueMatchesType(res.value, type)) {
    return res;
  }
  return error('WRONG_TYPE', defaultValue, res.flagVersion);
}

export function valueMatchesType(value, type) {
  switch (type) {
    case 'boolean': return typeof value === 'boolean';
    case 'string': return typeof value === 'string';
    case 'number': return isNumber(value);
    case 'json': return true;
    default: return false;
  }
}

export function ruleMatches(rule, context, segments) {
  const clauses = rule.clauses;
  if (!Array.isArray(clauses) || clauses.length === 0) {
    return false;
  }
  return clauses.every((clause) => clauseMatches(clause, context, segments));
}

export function clauseMatches(clause, context, segments, inSegmentRule = false) {
  const op = clause.op;
  const negate = Boolean(clause.negate);

  if (op === 'segmentMatch') {
    if (inSegmentRule) {
      return false;
    }
    let matched = false;
    for (const segmentKey of clause.values) {
      const segment = typeof segmentKey === 'string' ? own(segments, segmentKey) : undefined;
      if (segment !== undefined && segment !== null && inSegment(segment, context, segments)) {
        matched = true;
        break;
      }
    }
    return negate ? !matched : matched;
  }

  if (!OPERATORS.includes(op)) {
    return false;
  }

  const [found, attribute] = lookup(context, typeof clause.attribute === 'string' ? clause.attribute : '');
  if (!found) {
    return false;
  }

  let candidates;
  if (Array.isArray(attribute)) {
    if (attribute.length === 0) {
      return false;
    }
    candidates = attribute.filter((item) => typeof item === 'string' || typeof item === 'boolean' || isNumber(item));
  } else if (isPlainObject(attribute)) {
    return false;
  } else {
    candidates = [attribute];
  }

  const matched = candidates.some((candidate) => clause.values.some((value) => apply(op, candidate, value)));

  return negate ? !matched : matched;
}

export function inSegment(segment, context, segments) {
  if (!isPlainObject(segment) || !isWellFormedSegment(segment)) {
    return false;
  }

  const key = contextKey(context);
  if (key !== null && listOrEmpty(segment.included ?? []).includes(key)) {
    return true;
  }
  if (key !== null && listOrEmpty(segment.excluded ?? []).includes(key)) {
    return false;
  }

  for (const rule of listOrEmpty(segment.rules ?? [])) {
    if (!Array.isArray(rule.clauses) || rule.clauses.length === 0) {
      continue;
    }
    if (rule.clauses.every((clause) => clauseMatches(clause, context, segments, true))) {
      return true;
    }
  }

  return false;
}

export function isWellFormed(flag) {
  if (!TYPES.includes(flag.type) || typeof flag.on !== 'boolean' || typeof flag.salt !== 'string') {
    return false;
  }

  if (!Array.isArray(flag.variations) || flag.variations.length === 0) {
    return false;
  }

  const ids = new Set();
  for (const variation of flag.variations) {
    if (!isPlainObject(variation) || typeof variation.id !== 'string' || !hasOwn(variation, 'value')
      || ids.has(variation.id) || !valueMatchesType(variation.value, flag.type)) {
      return false;
    }
    ids.add(variation.id);
  }

  const off = flag.offVariation ?? null;
  if (off !== null && (typeof off !== 'string' || !ids.has(off))) {
    return false;
  }

  const targets = listOrEmpty(flag.targets ?? []);
  if (targets === null) {
    return false;
  }
  for (const target of targets) {
    if (!isPlainObject(target) || typeof target.variation !== 'string' || !ids.has(target.variation)
      || listOrEmpty(target.values) === null || !listOrEmpty(target.values).every((value) => typeof value === 'string')) {
      return false;
    }
  }

  const rules = listOrEmpty(flag.rules ?? []);
  if (rules === null) {
    return false;
  }
  for (const rule of rules) {
    if (!isPlainObject(rule) || !areWellFormedClauses(rule.clauses) || !isWellFormedServe(rule, ids)) {
      return false;
    }
  }

  return isPlainObject(flag.fallthrough) && isWellFormedServe(flag.fallthrough, ids);
}

function isWellFormedSegment(segment) {
  for (const list of ['included', 'excluded']) {
    const items = listOrEmpty(segment[list] ?? []);
    if (items === null || !items.every((item) => typeof item === 'string')) {
      return false;
    }
  }

  const rules = listOrEmpty(segment.rules ?? []);
  return rules !== null && rules.every((rule) => isPlainObject(rule) && areWellFormedClauses(rule.clauses));
}

function areWellFormedClauses(clauses) {
  const list = listOrEmpty(clauses);
  if (list === null) {
    return false;
  }

  return list.every((clause) => isPlainObject(clause)
    && typeof clause.op === 'string'
    && listOrEmpty(clause.values) !== null
    && (clause.attribute === undefined || clause.attribute === null || typeof clause.attribute === 'string')
    && (clause.negate === undefined || clause.negate === null || typeof clause.negate === 'boolean'));
}

function isWellFormedServe(serve, ids) {
  const hasVariation = serve.variation !== undefined && serve.variation !== null;
  const hasRollout = serve.rollout !== undefined && serve.rollout !== null;

  if (hasVariation === hasRollout) {
    return false;
  }

  if (hasVariation) {
    return typeof serve.variation === 'string' && ids.has(serve.variation);
  }

  const rollout = serve.rollout;
  if (!isPlainObject(rollout) || !['legacy', 'v2'].includes(rollout.hash)
    || (rollout.seed !== undefined && rollout.seed !== null && typeof rollout.seed !== 'string')
    || (rollout.bucketBy !== undefined && rollout.bucketBy !== null && (typeof rollout.bucketBy !== 'string' || rollout.bucketBy === ''))
    || !Array.isArray(rollout.variations) || rollout.variations.length === 0) {
    return false;
  }

  return rollout.variations.every((weighted) => isPlainObject(weighted) && typeof weighted.variation === 'string'
    && ids.has(weighted.variation) && Number.isInteger(weighted.weight) && weighted.weight >= 0);
}

function serve(flag, target, values, reason, context, random, version) {
  if (target.variation !== undefined && target.variation !== null) {
    return result(values.get(target.variation), target.variation, reason, null, version);
  }

  const rollout = target.rollout;
  const key = bucketKey(context, rollout.bucketBy ?? 'key');
  const n = bucket(rollout.hash, rollout.seed ?? flag.salt, key, random);

  let chosen = null;
  let cumulative = 0;
  for (const weighted of rollout.variations) {
    cumulative += weighted.weight;
    if (n < cumulative) {
      chosen = weighted.variation;
      break;
    }
  }
  chosen = chosen ?? rollout.variations[rollout.variations.length - 1].variation;

  return result(values.get(chosen), chosen, { ...reason, inExperiment: true }, key === null ? 'random' : 'sticky', version);
}

function result(value, variation, reason, assignment, flagVersion) {
  return { value, variation, reason, assignment, flagVersion };
}

function error(kind, defaultValue, flagVersion) {
  return result(defaultValue, null, { kind: 'ERROR', errorKind: kind }, null, flagVersion);
}

/** listOrEmpty: the array itself, [] for an empty object (PHP decodes {} as []), otherwise null. */
function listOrEmpty(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return isPlainObject(value) && Object.keys(value).length === 0 ? [] : null;
}
