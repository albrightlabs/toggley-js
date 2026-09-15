// Fails when spec/*.json no longer match the checksums in spec/SOURCE.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const spec = join(dirname(fileURLToPath(import.meta.url)), '..', 'spec');
let failed = false;

for (const line of readFileSync(join(spec, 'SOURCE'), 'utf8').split('\n')) {
  const match = line.match(/^([0-9a-f]{64})\s+(\S+)$/);
  if (!match) continue;
  const actual = createHash('sha256').update(readFileSync(join(spec, match[2]))).digest('hex');
  if (actual !== match[1]) {
    console.error(`${match[2]} changed: expected ${match[1]}, got ${actual}. Run npm run sync-vectors.`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
