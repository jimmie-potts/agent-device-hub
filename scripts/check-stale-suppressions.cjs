// ESLint reports unused suppressions only for files it lints, so a key for a
// deleted or renamed file stays silently. Fail when a key has no file on disk.
const fs = require('node:fs');
const path = require('node:path');

function staleSuppressions(directory) {
  const file = path.join(directory, 'eslint-suppressions.json');
  if (!fs.existsSync(file)) return [];
  const keys = Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')));
  return keys.filter(key => !fs.existsSync(path.join(directory, key)));
}

module.exports = { staleSuppressions };

if (require.main === module) {
  const stale = staleSuppressions(process.cwd());
  for (const key of stale) process.stderr.write(`eslint-suppressions.json: stale key for missing file ${key}\n`);
  if (stale.length) process.exitCode = 1;
}
