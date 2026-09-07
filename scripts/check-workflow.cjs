// Validate both scopes, including when the first scope fails.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const wrapper = path.join(__dirname, 'openspec.cjs');
for (const scope of ['--all', '--archived']) {
  const result = spawnSync(process.execPath, [wrapper, 'validate', scope, '--strict', '--json', '--no-interactive'], {
    stdio: 'inherit',
  });
  if (result.error) process.stderr.write(`${result.error.message}\n`);
  if (result.signal) process.stderr.write(`Workflow validation stopped by ${result.signal}.\n`);
  if (result.status !== 0) process.exitCode = 1;
}
