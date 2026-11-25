#!/usr/bin/env node
// What a failed hosted test job keeps (#2059). Tests write into TEST_EVIDENCE_DIR: the browser journeys' screenshots and
// dumps (apps/runtime/dashboard/tests/browser-artifacts.ts) and the JUnit files of junit-file.mjs. When a job fails, the
// failure-evidence action copies part of that directory with this script and uploads the copy:
//   node scripts/ci-selection/failure-evidence.mjs <evidence directory> <upload directory>
// Only image, text and result files are copied, never a symbolic link, a hard link (which could name a file outside
// the folder) or a hidden file or folder (which the upload would drop), and at most LIMIT_BYTES in all: JUnit files
// first, then the newest files, because a journey writes its failure screenshot last. MANIFEST.txt lists every file
// and whether it was kept, so an omitted file is visible. Uploaded artifacts are public; journeys and tests write
// synthetic fixtures only (ADR 0011).
import { copyFileSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const LIMIT_BYTES = 50 * 1024 * 1024;
export const KEPT_TYPES = new Set(['.png', '.jpg', '.jpeg', '.webp', '.xml', '.json', '.txt', '.html', '.log']);

/** Every regular file under `root` with one link, without following a symbolic link; a missing root has none. */
function files(root) {
  const found = [], skipped = [];
  const walk = folder => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name), name = relative(root, path);
      if (entry.name.startsWith('.')) skipped.push({ name, reason: 'hidden, not uploaded' });
      else if (entry.isDirectory()) walk(path);
      else if (!entry.isFile()) skipped.push({ name, reason: 'not a regular file' });
      else {
        const stat = lstatSync(path);
        if (stat.nlink > 1) skipped.push({ name, reason: 'hard link' });
        else found.push({ path, name, size: stat.size, modified: stat.mtimeMs });
      }
    }
  };
  try { walk(root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { found, skipped };
}

/** Copies the kept part of `source` into `target` and returns the manifest's rows. */
export function stage(source, target, { limit = LIMIT_BYTES } = {}) {
  const { found, skipped } = files(source);
  const junit = file => file.name.split(sep)[0] === 'junit' && extname(file.name) === '.xml';
  const order = [...found].sort((a, b) => Number(junit(b)) - Number(junit(a)) || b.modified - a.modified || a.name.localeCompare(b.name));
  const rows = skipped.map(file => ({ ...file, size: 0 }));
  let total = 0;
  for (const file of order) {
    if (!KEPT_TYPES.has(extname(file.name).toLowerCase())) { rows.push({ name: file.name, size: file.size, reason: 'file type not kept' }); continue; }
    if (total + file.size > limit) { rows.push({ name: file.name, size: file.size, reason: 'over the size limit' }); continue; }
    mkdirSync(dirname(join(target, file.name)), { recursive: true });
    copyFileSync(file.path, join(target, file.name));
    total += file.size;
    rows.push({ name: file.name, size: file.size, reason: 'kept' });
  }
  mkdirSync(target, { recursive: true });
  const lines = rows.sort((a, b) => a.name.localeCompare(b.name)).map(row => `${row.reason}\t${row.size}\t${row.name}`);
  writeFileSync(join(target, 'MANIFEST.txt'), `Failure evidence (#2059): ${rows.filter(row => row.reason === 'kept').length} of ${rows.length} files kept, `
    + `${total} of at most ${limit} bytes.\n${found.length + skipped.length === 0 ? 'The tests wrote no evidence before the job failed.\n' : ''}`
    + (lines.length ? `\n${lines.join('\n')}\n` : ''));
  return rows;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [source, target] = process.argv.slice(2);
  if (!source || !target) { console.error('usage: failure-evidence.mjs <evidence directory> <upload directory>'); process.exit(2); }
  const rows = stage(source, target);
  console.log(`Failure evidence: kept ${rows.filter(row => row.reason === 'kept').length} of ${rows.length} files from ${source}; see MANIFEST.txt in the artifact.`);
}
