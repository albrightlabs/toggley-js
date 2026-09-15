import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToggleyClient, init } from '../src/index.js';
import { Summarizer, MAX_COUNTERS, MAX_COUNTERS_PER_FLAG } from '../src/summarizer.js';
import { manualTimers, fakeFetch, documentWith, booleanFlag, SERVER_KEY } from './helpers.js';

const quiet = { logger: null, jitter: () => 0.5 };

test('rejects client keys and requires a server key unless offline', () => {
  assert.throws(() => init({ serverKey: 'tgly_cli_' + 'b'.repeat(32) }), /client key/);
  assert.throws(() => init({}), /server key/);
  assert.doesNotThrow(() => init({ offline: true, ...quiet }));
});

test('serves defaults with CLIENT_NOT_READY before a config arrives', () => {
  const client = new ToggleyClient({ serverKey: SERVER_KEY, autoStart: false, ...quiet });
  const detail = client.boolVariationDetail('checkout', { key: 'u1' }, true);
  assert.equal(detail.value, true);
  assert.equal(detail.reason.errorKind, 'CLIENT_NOT_READY');
});

test('polls the config, sends the ETag and handles 304', async () => {
  const timers = manualTimers();
  let config = documentWith({ checkout: booleanFlag('checkout') });
  const fetch = fakeFetch(({ init }) => (init.headers['if-none-match'] === '"4-1"'
    ? { status: 304, headers: { etag: '"4-1"' } }
    : { body: config, headers: { etag: '"4-1"', 'x-toggley-poll-interval': '30' } }));
  const client = new ToggleyClient({ serverKey: SERVER_KEY, fetch, timers, autoStart: false, events: false, ...quiet });

  const ready = client.waitForInitialization(1000);
  await client._poll();
  assert.equal(await ready, true);
  assert.equal(fetch.calls[0].url, 'https://my.toggleyapp.com/api/v2/sdk/config');
  assert.equal(fetch.calls[0].init.headers.authorization, `Bearer ${SERVER_KEY}`);
  assert.equal(client.boolVariation('checkout', { key: 'u1' }, false), true);
  assert.equal(timers.last().ms, 30000);

  await client._poll();
  assert.equal(fetch.calls[1].init.headers['if-none-match'], '"4-1"');
  assert.equal(client.boolVariation('checkout', { key: 'u1' }, false), true, '304 keeps the config');
});

test('keeps the last good config and backs off on errors', async () => {
  const timers = manualTimers();
  const replies = [
    { body: documentWith({ checkout: booleanFlag('checkout', false) }) },
    { body: '{"schemaVersion": 99}' },
    new TypeError('connection refused'),
    { status: 503 },
  ];
  const fetch = fakeFetch(() => replies.shift());
  const errors = [];
  const client = new ToggleyClient({ serverKey: SERVER_KEY, fetch, timers, autoStart: false, events: false, onError: (e) => errors.push(e.code), ...quiet });

  await client._poll();
  await client._poll();
  assert.equal(timers.last().ms, 1000, 'first retry after about a second');
  await client._poll();
  assert.equal(timers.last().ms, 2000);
  await client._poll();
  assert.equal(timers.last().ms, 4000);
  assert.deepEqual(errors, ['invalid_config', 'network_error', 'http_error']);
  assert.equal(client.boolVariation('checkout', null, true), false, 'still serving the last good config');
});

test('honours Retry-After and stops polling when the key is rejected', async () => {
  const timers = manualTimers();
  const replies = [
    { status: 429, headers: { 'retry-after': '90' } },
    { status: 401, body: { error: { code: 'invalid_key', message: 'This SDK key is not valid.' } } },
  ];
  const fetch = fakeFetch(() => replies.shift());
  const errors = [];
  const client = new ToggleyClient({ serverKey: SERVER_KEY, fetch, timers, autoStart: false, events: false, onError: (e) => errors.push(e.message), ...quiet });
  const ready = client.waitForInitialization(1000);

  await client._poll();
  assert.equal(timers.last().ms, 90000);
  const scheduledBefore = timers.scheduled.length;
  await client._poll();
  assert.equal(timers.scheduled.length, scheduledBefore, 'no further polls');
  assert.equal(await ready, false);
  assert.equal(errors.at(-1), 'This SDK key is not valid.');
});

test('bootstrap and offline mode never call Toggley', () => {
  const fetch = fakeFetch(() => { throw new Error('should not fetch'); });
  const client = init({ offline: true, bootstrap: documentWith({ theme: { ...booleanFlag('theme'), type: 'string', variations: [{ id: 'light', value: 'light' }, { id: 'dark', value: 'dark' }], offVariation: 'light', fallthrough: { variation: 'dark' } } }), fetch, ...quiet });

  assert.equal(client.stringVariation('theme', { key: 'u1' }, 'light'), 'dark');
  const wrong = client.boolVariationDetail('theme', { key: 'u1' }, false);
  assert.equal(wrong.value, false);
  assert.equal(wrong.reason.errorKind, 'WRONG_TYPE');
  assert.deepEqual(client.allFlags({ key: 'u1' }), { theme: 'dark' });
  assert.equal(fetch.calls.length, 0);
});

test('sends evaluation counts on flush and close, never contexts', async () => {
  const timers = manualTimers();
  const fetch = fakeFetch(({ url }) => (url.endsWith('/config') ? { body: documentWith({ checkout: booleanFlag('checkout') }) } : { status: 202, body: { accepted: 2, dropped: 0 } }));
  const client = new ToggleyClient({ serverKey: SERVER_KEY, fetch, timers, autoStart: false, now: () => 1700000000000, ...quiet });

  await client._poll();
  client.boolVariation('checkout', { key: 'secret-user@example.com' }, false);
  client.boolVariation('checkout', { key: 'another' }, false);
  client.boolVariation('missing', { key: 'u1' }, false);
  await client.close();

  const post = fetch.calls.find((call) => call.url.endsWith('/api/v2/sdk/events'));
  assert.ok(post, 'events posted');
  assert.match(post.init.headers['x-toggley-payload-id'], /^[0-9a-f-]{36}$/);
  const payload = JSON.parse(post.init.body);
  assert.equal(payload.kind, 'summary');
  assert.deepEqual(payload.features.checkout.counters, [{ variation: 'on', count: 2, version: 3 }]);
  assert.deepEqual(payload.features.missing.counters, [{ variation: null, count: 1, unknown: true }]);
  assert.ok(!post.init.body.includes('secret-user'), 'contexts are not sent');
});

test('summarizer caps counters', () => {
  const summarizer = new Summarizer(() => 1);
  for (let i = 0; i < MAX_COUNTERS_PER_FLAG + 5; i++) {
    summarizer.record('many-versions', { variation: 'on', flagVersion: i });
  }
  assert.equal(summarizer.features.get('many-versions').size, MAX_COUNTERS_PER_FLAG);
  assert.equal(summarizer.dropped, 5);

  for (let i = 0; i < MAX_COUNTERS * 2; i++) {
    summarizer.record(`flag-${i}`, { variation: 'on', flagVersion: 1 });
  }
  assert.equal(summarizer.counterCount, MAX_COUNTERS);
  assert.equal(summarizer.snapshot({ name: 't', version: '0' }).kind, 'summary');
  assert.ok(summarizer.isEmpty, 'snapshot starts a new period');
});
