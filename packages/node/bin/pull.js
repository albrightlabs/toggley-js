#!/usr/bin/env node
// Writes the environment's current config to a file, for use as a bootstrap:
//   TOGGLEY_SERVER_KEY=tgly_srv_... npx toggley-pull --out toggley-config.json [--base-url https://my.toggleyapp.com]
import { writeFileSync } from 'node:fs';
import { DEFAULT_BASE_URL, isConfigDocument } from '../src/client.js';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? fallback : args[index + 1];
};

const key = option('key', process.env.TOGGLEY_SERVER_KEY);
const out = option('out', 'toggley-config.json');
const baseUrl = option('base-url', process.env.TOGGLEY_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

if (!key || !key.startsWith('tgly_srv_')) {
  console.error('Set TOGGLEY_SERVER_KEY (or pass --key) to the environment\'s server key.');
  process.exit(2);
}

const response = await fetch(`${baseUrl}/api/v2/sdk/config`, { headers: { authorization: `Bearer ${key}` } });
const body = await response.json().catch(() => null);

if (!response.ok || !isConfigDocument(body)) {
  console.error(`Couldn't download the config: HTTP ${response.status} ${body?.error?.message ?? ''}`.trim());
  process.exit(1);
}

writeFileSync(out, JSON.stringify(body, null, 2) + '\n');
console.log(`Wrote ${Object.keys(body.flags).length} flag(s), config version ${body.environmentVersion}, to ${out}`);
