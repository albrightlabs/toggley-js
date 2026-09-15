// Copies the shared evaluation vectors from the Toggley plugin and records their checksums.
// Usage: node scripts/sync-vectors.mjs [path/to/featureflag/tests/fixtures]
import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2] ?? join(root, '../toggleyapp.com/plugins/albrightlabs/featureflag/tests/fixtures');
const files = ['evaluation-vectors.json', 'bucketing-vectors.json'];
const lines = [`source: ${source.replace(/^.*saas-products\//, '')}`];

for (const file of files) {
  copyFileSync(join(source, file), join(root, 'spec', file));
  const sha = createHash('sha256').update(readFileSync(join(root, 'spec', file))).digest('hex');
  lines.push(`${sha}  ${file}`);
}

writeFileSync(join(root, 'spec', 'SOURCE'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
