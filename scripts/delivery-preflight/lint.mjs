// Changed-file lint for the delivery preflight: `eslint --max-warnings=0` on the
// PR's changed source files, run in a local checkout at the PR head, so lint
// findings surface before review dispatch rather than in review (#1139).
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const LINTABLE = /\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/;
const MAX_PROBLEMS = 20;

/** Changed files ESLint should check: added, modified or renamed sources that still exist at the head. */
export function lintTargets(files) {
  return files.filter(file => file.status !== 'removed' && LINTABLE.test(file.filename)).map(file => file.filename);
}

/**
 * Lint `paths` in the checkout at `cwd`. The checkout must sit at `head` with
 * those paths unmodified, or the result would describe a different revision.
 * Returns `{ ran: false, reason }` or `{ ran: true, ok, problems }`.
 */
export function localLint({ head, paths, cwd = process.cwd(), spawn = spawnSync }) {
  const git = args => spawn('git', args, { cwd, encoding: 'utf8' });
  const local = git(['rev-parse', 'HEAD']);
  if (local.status !== 0) return { ran: false, reason: 'the working directory is not a Git checkout' };
  if (local.stdout.trim() !== head) return { ran: false, reason: `the local checkout is at ${local.stdout.trim().slice(0, 12)}, not the PR head ${head.slice(0, 12)}; run the preflight from a checkout of the head` };
  const dirty = git(['status', '--porcelain', '--', ...paths]);
  if (dirty.status !== 0 || dirty.stdout.trim()) return { ran: false, reason: 'changed files have local modifications; lint needs the committed head' };
  const eslint = path.join(cwd, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const run = spawn(process.execPath, [eslint, '--max-warnings=0', '--no-warn-ignored', '--format', 'json', '--', ...paths], {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  let results;
  try {
    results = JSON.parse(run.stdout);
  } catch {
    return { ran: false, reason: `eslint did not produce a report (exit ${run.status ?? run.signal})` };
  }
  const problems = results.flatMap(result => result.messages.map(message => (
    `${path.relative(cwd, result.filePath)}:${message.line ?? 0} ${message.ruleId ?? 'eslint'} ${message.severity === 2 ? 'error' : 'warning'}`
  )));
  return { ran: true, ok: run.status === 0 && problems.length === 0, problems };
}

/** Evaluate the changed-file lint gate for an open PR. */
export async function evaluateLint(ctx, lint) {
  const gate = ctx.gates.lint;
  if (ctx.state !== 'open') {
    gate.notApplicable('applies before review of an open PR');
    return;
  }
  if (!ctx.filesComplete) {
    gate.unresolved('the changed-file list could not be read completely');
    return;
  }
  const paths = lintTargets(ctx.files);
  gate.evidence = { revision: ctx.head, files: paths.length };
  if (!paths.length) {
    gate.notApplicable('no changed JavaScript or TypeScript files');
    return;
  }
  const result = await lint({ head: ctx.head, paths });
  if (!result.ran) {
    gate.unresolved(`changed-file lint did not run: ${result.reason}`);
    return;
  }
  gate.evidence.problems = result.problems.length;
  if (result.ok) {
    gate.note(`eslint --max-warnings=0 passed on ${paths.length} changed file(s) at ${ctx.head.slice(0, 12)}`);
    return;
  }
  gate.unresolved(`eslint --max-warnings=0 failed on changed files at ${ctx.head.slice(0, 12)}`);
  for (const problem of result.problems.slice(0, MAX_PROBLEMS)) gate.note(problem);
}
