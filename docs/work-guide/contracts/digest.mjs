// Hash the exact definition bundle; approval receipts live outside this bundle.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const artifacts = ['README.md', 'guide-records.schema.json', 'reference.mjs',
  'journey.md', 'digest.mjs', 'fixtures/valid.json', 'fixtures/cases.json', 'fixtures/search.json'];
export function definitionDigest(specPath) {
  const hash = createHash('sha256');
  for (const path of artifacts) {
    hash.update(path + '\0');
    hash.update(readFileSync(new URL(path, import.meta.url)));
    hash.update('\0');
  }
  // OpenSpec promotes ADDED Requirements to Requirements on archive.
  const spec = readFileSync(specPath, 'utf8')
    .replace(/^# guide-records Specification\n\n/, '')
    .replace(/^## ADDED Requirements$/m, '## Requirements').trimEnd() + '\n';
  hash.update('guide-records/spec.md\0' + spec + '\0');
  return hash.digest('hex');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Pass the canonical delta or main spec path');
  process.stdout.write(definitionDigest(process.argv[2]) + '\n');
}
