// End-to-end check against a local Toggley. Seeds flags into a throwaway environment
// with featureflag:import-config, runs the checks, then deletes everything it created.
//
//   TOGGLEY_APP_DIR=../toggleyapp.com TOGGLEY_BASE_URL=http://toggley.test:8001 TOGGLEY_E2E_ORG=1 npm run e2e
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { init } from '../packages/node/src/index.js';
import { createClient } from '../packages/browser/src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = process.env.TOGGLEY_APP_DIR ?? resolve(here, '../../toggleyapp.com');
const baseUrl = process.env.TOGGLEY_BASE_URL ?? 'http://127.0.0.1:8001';
const org = process.env.TOGGLEY_E2E_ORG ?? '1';
const prefix = 'e2e-js-';
const environment = 'SDK e2e js';

const seedFile = join(tmpdir(), `toggley-${prefix}seed.json`);
writeFileSync(seedFile, readFileSync(join(here, 'seed.json'), 'utf8').replaceAll('e2e-', prefix));
const artisan = (...args) => execFileSync('php', ['artisan', ...args], { cwd: appDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const lastJson = (output) => JSON.parse(output.trim().split('\n').filter((line) => line.startsWith('{')).at(-1));
const importArgs = ['featureflag:import-config', seedFile, `--org=${org}`, `--environment=${environment}`];

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(`PASS ${name}`);
  } catch (error) {
    results.push(`FAIL ${name}: ${error.message.split('\n')[0]}`);
  }
};

const setup = lastJson(artisan(...importArgs, '--issue-keys'));
const ours = (values) => Object.fromEntries(Object.entries(values).filter(([key]) => key.startsWith(prefix)).sort());
const contexts = Array.from({ length: 50 }, (_, i) => ({
  key: `user-${i}`,
  email: i % 3 === 0 ? `u${i}@example.com` : `u${i}@other.org`,
  plan: ['free', 'pro', 'beta'][i % 3],
  country: ['US', 'DE', 'CA', 'JP'][i % 4],
  age: 18 + i,
  org: `org-${i % 5}`,
}));

let down = false;
const configStatuses = [];
const fetchSpy = async (url, init) => {
  if (down) {
    throw new TypeError('fetch failed (Toggley is down)');
  }
  const response = await fetch(url, init);
  if (url.endsWith('/api/v2/sdk/config')) {
    configStatuses.push(response.status);
  }
  return response;
};

const client = init({ serverKey: setup.server_key, baseUrl, fetch: fetchSpy, logger: null, flushInterval: 3600000 });

try {
  await check('server SDK initializes', async () => {
    assert.equal(await client.waitForInitialization(10000), true);
    assert.equal(Object.keys(ours(client.allFlags({ key: 'x' }))).length, 7);
  });

  await check('50 contexts: server SDK equals /client/evaluate (browser SDK)', async () => {
    const browser = createClient({ clientKey: setup.client_key, baseUrl, storage: null, document: null, autoStart: false });
    for (const context of contexts) {
      await browser.identify(context);
      assert.deepStrictEqual(ours(client.allFlags(context)), ours(browser.allFlags()), JSON.stringify(context));
    }
    browser.close();
  });

  await check('boolean flags equal the v1 API', async () => {
    for (const context of contexts.slice(0, 15)) {
      for (const flag of ['bool-on', 'bool-off', 'bool-split', 'legacy-split']) {
        const response = await fetch(`${baseUrl}/api/v1/${setup.v1_key}/flags/${prefix}${flag}?subject=${encodeURIComponent(context.key)}`);
        const body = await response.json();
        assert.equal(body.enabled, client.boolVariation(`${prefix}${flag}`, { key: context.key }, !body.enabled), `${flag} ${context.key}`);
      }
    }
  });

  await check('second poll gets 304', async () => {
    await client._poll();
    assert.equal(configStatuses.at(-1), 304, JSON.stringify(configStatuses));
  });

  await check('evaluation counts reach hourly usage', async () => {
    for (let i = 0; i < 5; i++) {
      client.stringVariation(`${prefix}text`, contexts[i], 'none');
    }
    await client.flush();
    const sum = Number(artisan('tinker', `--execute=echo "SUM:" . DB::table("featureflag_usage_hourly")->where("environment_id", ${setup.environment_id})->where("source", 1)->sum("count");`).match(/SUM:(\d+)/)[1]);
    assert.ok(sum >= 5, `usage sum ${sum}`);
  });

  await check('Toggley down: last good config keeps serving', async () => {
    const before = ours(client.allFlags(contexts[1]));
    down = true;
    await client._poll();
    assert.deepStrictEqual(ours(client.allFlags(contexts[1])), before);
    assert.ok(client.nextPollDelay >= 800 && client.nextPollDelay <= 1200, `backoff ${client.nextPollDelay}`);
    down = false;
  });
} finally {
  await client.close();
  artisan(...importArgs, '--delete');
  unlinkSync(seedFile);
}

console.log(results.join('\n'));
const failures = results.filter((line) => line.startsWith('FAIL')).length;
console.log(`${results.length - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
