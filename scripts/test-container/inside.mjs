// In-container entrypoint of `npm run test:container` (Hub #1638): copy the read-only snapshot over the prebuilt
// dependencies, record it in a temporary Git commit, build unless told not to, then run one package script.
// Usage (from scripts/test-container.mjs): inside.mjs build|no-build <package script> [arguments...]
import {spawnSync} from 'node:child_process';
import {constants} from 'node:os';

export function steps(mode, script, args) {
  if (mode !== 'build' && mode !== 'no-build') throw new Error('usage: inside.mjs build|no-build <package script> [arguments...]');
  if (typeof script !== 'string' || script === '') throw new Error('usage: inside.mjs build|no-build <package script> [arguments...]');
  return [
    // A plain copy makes root the owner of every file and keeps the snapshot's executable bits.
    ['cp', ['-R', '/snapshot/.', '/work/source/']],
    ['git', ['init', '-q']],
    ['git', ['add', '.']],
    ['git', ['-c', 'user.name=Disposable test job', '-c', 'user.email=checks@invalid', 'commit', '-q', '-m', 'Current task source snapshot']],
    ...(mode === 'build' ? [['npm', ['run', 'build']]] : []),
    ['npm', ['run', script, ...(args.length ? ['--', ...args] : [])]],
  ];
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [mode, script, ...args] = process.argv.slice(2);
  let status = 0;
  for (const [program, programArgs] of steps(mode, script, args)) {
    const result = spawnSync(program, programArgs, {stdio:'inherit', cwd:'/work/source'});
    if (result.error) throw result.error;
    status = result.status ?? 128 + (constants.signals[result.signal] ?? 0);
    if (status !== 0) break;
  }
  process.exitCode = status;
}
