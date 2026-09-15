import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, typed } from '../src/engine/evaluator.js';
import { bucket, fixedRandom, nativeRandom } from '../src/engine/bucketer.js';

const spec = (name) => JSON.parse(readFileSync(new URL(`../../../spec/${name}`, import.meta.url), 'utf8'));

const evaluation = spec('evaluation-vectors.json');
for (const suite of evaluation.suites) {
  for (const c of suite.cases) {
    test(`${suite.name}: ${c.name}`, () => {
      const random = Object.hasOwn(c, 'randomBucket') ? fixedRandom(c.randomBucket) : nativeRandom;
      let result = evaluate(structuredClone(suite.document), c.flag, c.context, c.default, random);
      if (c.requestedType) {
        result = typed(result, c.requestedType, c.default);
      }
      assert.deepStrictEqual(result, c.expect);
    });
  }
}

test('bucketing vectors', () => {
  const { buckets } = spec('bucketing-vectors.json');
  assert.ok(buckets.length >= 500);
  for (const row of buckets) {
    assert.equal(bucket(row.hash, row.salt, row.key, nativeRandom), row.bucket, JSON.stringify(row));
  }
});
