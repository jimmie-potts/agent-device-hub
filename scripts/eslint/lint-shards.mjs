// `npm run lint:js`: ESLint over the whole repository, in path shards that each run in their own process under one
// heap budget (Hub #1636). typescript-eslint's project service keeps a TypeScript program alive for every tsconfig
// project a process touches, so one process over the repository holds about 40 programs at once. A shard holds only
// the programs its files need. Together the shards lint exactly the files `eslint .` lints, each once: a shard skips
// the paths claimed by more specific shards inside it, and the last shard is everything no other shard claims.
// docs/static-analysis.md "Heap budget" records the budget, the measured need and how to re-measure.
//
// Usage: node scripts/eslint/lint-shards.mjs --heap-mb=<MB> [ESLint options...]
// Every other argument is an ESLint option passed to each shard, such as --max-warnings=0 or --prune-suppressions.
// Pass options only: a file or directory argument would be linted again by every shard.
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));

// Each entry is one shard's paths, relative to the repository root. Split a shard when it nears the budget.
export const shards = [
  ['apps/runtime/dashboard'],
  ['apps/runtime'],
  ['modules/pixoo', 'modules/companions'],
  ['modules/nanoleaf', 'modules/tidbyt', 'modules/roborock'],
  ['modules'],
  ['packages', 'controllers'],
];

const inside = (path, parent) => path.startsWith(`${parent}/`);

/** The ESLint arguments for each shard, ending with the rest of the repository. */
export function shardArguments(list = shards) {
  const claimed = list.flat();
  const repeated = claimed.filter((path, index) => claimed.indexOf(path) !== index);
  if (repeated.length > 0) throw new Error(`A lint shard path is listed twice: ${repeated.join(', ')}`);
  const ignore = paths => paths.flatMap(path => ['--ignore-pattern', `${path}/**`]);
  return [
    ...list.map(paths => {
      const own = new Set(paths);
      return [...paths, ...ignore(claimed.filter(path => !own.has(path) && paths.some(parent => inside(path, parent))))];
    }),
    ['.', ...ignore(claimed)],
  ];
}

function main(argv) {
  const budget = argv.find(arg => arg.startsWith('--heap-mb='));
  const heapMb = Number(budget?.slice('--heap-mb='.length));
  if (!Number.isInteger(heapMb) || heapMb <= 0) {
    console.error('lint-shards: pass the heap budget as --heap-mb=<MB>');
    return 2;
  }
  const options = argv.filter(arg => arg !== budget);
  // This path also tells typescript-eslint that each process is a single CLI run, as `eslint .` was.
  const eslint = join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const all = shardArguments();
  let status = 0;
  for (const [index, paths] of all.entries()) {
    const started = performance.now();
    // A command-line heap limit takes precedence over one in NODE_OPTIONS, so the budget holds wherever lint runs.
    const run = spawnSync(process.execPath, [`--max-old-space-size=${heapMb}`, eslint, ...options, ...paths],
      {cwd: root, stdio: 'inherit'});
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const name = `lint shard ${index + 1}/${all.length} (${paths.filter(arg => !arg.startsWith('-') && !arg.includes('*')).join(' ')})`;
    if (run.error) throw run.error;
    if (run.status === 0) {
      console.error(`${name}: passed in ${seconds} s`);
      continue;
    }
    status = Math.max(status, run.status ?? 2);
    console.error(run.signal || run.status === 134
      ? `${name}: ended by ${run.signal ?? 'exit 134'} after ${seconds} s. A heap out of memory error above means the shard ` +
        `outgrew the ${heapMb} MB budget; see docs/static-analysis.md "Heap budget".`
      : `${name}: exit ${run.status} after ${seconds} s`);
  }
  return status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
