import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { createClient } from '../src/index.js';

const CLIENT_KEY = 'tgly_cli_' + 'c'.repeat(32);

function setup(flagsFor, extra = {}) {
  const calls = [];
  const storage = new Map();
  const timers = { scheduled: [], setTimeout(fn, ms) { const t = { fn, ms, cleared: false }; this.scheduled.push(t); return t; }, clearTimeout(t) { if (t) t.cleared = true; } };
  const listeners = {};
  const doc = { hidden: false, addEventListener: (e, fn) => { listeners[e] = fn; }, removeEventListener: (e) => { delete listeners[e]; } };
  let now = 1000;
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const reply = flagsFor(JSON.parse(init.body).context, calls.length);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  };
  const client = createClient({
    clientKey: CLIENT_KEY,
    fetch,
    timers,
    document: doc,
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    now: () => now,
    ...extra,
  });
  return { client, calls, storage, timers, doc, listeners, advance: (ms) => { now += ms; } };
}

test('refuses server keys', () => {
  assert.throws(() => createClient({ clientKey: 'tgly_srv_' + 'a'.repeat(40) }), /Never put a server key/);
});

test('loads values, emits changes on identify and caches per context', async () => {
  const { client, calls, storage } = setup((context) => ({
    body: { version: 7, flags: { banner: { value: context.key === 'vip' ? 'gold' : 'plain', variation: context.key === 'vip' ? 'gold' : 'plain' } } },
  }), { context: { key: 'u1' } });

  assert.equal(client.variationDetail('banner', 'none').reason.errorKind, 'CLIENT_NOT_READY');
  await client.ready();
  assert.equal(client.variation('banner', 'none'), 'plain');
  assert.equal(calls[0].url, 'https://my.toggleyapp.com/api/v2/client/evaluate');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${CLIENT_KEY}`);
  assert.equal(client.variationDetail('missing', 1).reason.errorKind, 'FLAG_NOT_FOUND');

  const changes = [];
  client.on('change', (c) => changes.push(c));
  await client.identify({ key: 'vip', plan: 'pro' });
  assert.equal(client.variation('banner'), 'gold');
  assert.deepEqual(changes, [{ banner: { previous: 'plain', current: 'gold' } }]);
  assert.deepEqual(JSON.parse(calls[1].init.body).context, { key: 'vip', plan: 'pro' });
  assert.equal(storage.size, 2);
});

test('starts from the cache before Toggley answers', async () => {
  const first = setup(() => ({ body: { flags: { beta: { value: true, variation: 'on' } } } }), { context: { key: 'u1' } });
  await first.client.ready();

  const second = createClient({
    clientKey: CLIENT_KEY,
    context: { key: 'u1' },
    storage: { getItem: (k) => first.storage.get(k) ?? null, setItem() {} },
    fetch: () => new Promise(() => {}),
    timers: { setTimeout() {}, clearTimeout() {} },
    document: null,
  });
  assert.equal(second.variation('beta', false), true);
});

test('pauses polling while hidden and refreshes when visible again', async () => {
  const { client, calls, timers, doc, listeners, advance } = setup(() => ({ body: { flags: {} } }));
  await client.ready();
  assert.equal(timers.scheduled.filter((t) => !t.cleared).at(-1).ms, 300000);

  doc.hidden = true;
  listeners.visibilitychange();
  assert.ok(timers.scheduled.every((t) => t.cleared), 'no refresh scheduled while hidden');

  advance(400000);
  doc.hidden = false;
  listeners.visibilitychange();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2, 'refreshed after coming back');
});

test('stops polling when the key is rejected', async () => {
  const errors = [];
  const { client, timers } = setup(() => ({ status: 401, body: { error: { code: 'invalid_key', message: 'This SDK key is not valid.' } } }));
  client.on('error', (e) => errors.push(e.message));
  await client.ready();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors, ['This SDK key is not valid.']);
  assert.ok(timers.scheduled.every((t) => t.cleared));
});

test('bootstrap values and under 4 KB gzipped', () => {
  const client = createClient({ clientKey: CLIENT_KEY, bootstrap: { beta: true, theme: { value: 'dark', variation: 'dark' } }, autoStart: false, storage: null, document: null });
  assert.deepEqual(client.allFlags(), { beta: true, theme: 'dark' });

  const size = gzipSync(readFileSync(new URL('../src/index.js', import.meta.url))).length;
  assert.ok(size < 4096, `gzipped size ${size}`);
});
