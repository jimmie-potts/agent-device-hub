// Changed-file lint for the delivery preflight: `eslint --max-warnings=0` on the
// PR's changed source files, run in a local checkout at the PR head, so lint
// findings surface before review dispatch rather than in review (#1139).
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const LINTABLE = /\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/;
const MAX_PROBLEMS = 20;
// A git query answers in well under this; ESLint over a PR's files can take minutes with type information.
const GIT_TIMEOUT_MS = 30_000;
const ESLINT_TIMEOUT_MS = 10 * 60_000;
// Baseline-only rules (the owned `no-unsafe-*` baseline of docs/static-analysis.md) rank after every other finding.
const BASELINE_RULE = /^@typescript-eslint\/no-unsafe-/;

/** Changed files ESLint should check: added, modified or renamed sources that still exist at the head. */
export function lintTargets(files) {
  return files.filter(file => file.status !== 'removed' && LINTABLE.test(file.filename)).map(file => file.filename);
}

/**
 * Line numbers a unified diff adds or changes, from the PR file list's `patch`; an empty set when there is no patch,
 * as for a binary or very large file.
 */
export function changedLines(patch) {
  const lines = new Set();
  if (typeof patch !== 'string') return lines;
  let line = 0;
  for (const text of patch.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) { line = Number(hunk[1]); continue; }
    if (text.startsWith('+')) { lines.add(line); line += 1; } else if (!text.startsWith('-') && !text.startsWith('\\')) line += 1;
  }
  return lines;
}

/**
 * The order findings are reported in, so the ones a reviewer acts on first survive the cap (#1152): errors before
 * warnings, findings on the PR's changed lines before others, and every other rule before the `no-unsafe-*` baseline.
 */
export function rankProblems(problems, changed = new Map()) {
  const rank = problem => [
    problem.severity === 2 ? 0 : 1,
    changed.get(problem.file)?.has(problem.line) ? 0 : 1,
    BASELINE_RULE.test(problem.ruleId ?? '') ? 1 : 0,
  ];
  return [...problems].sort((a, b) => {
    const [ra, rb] = [rank(a), rank(b)];
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1;
  });
}

const describe = problem => `${problem.file}:${problem.line} ${problem.ruleId ?? 'eslint'} ${problem.severity === 2 ? 'error' : 'warning'}`;

/**
 * Lint `paths` in the checkout at `cwd`. The checkout must sit at `head` with
 * those paths unmodified, or the result would describe a different revision.
 * `changed` maps a path to the line numbers its PR patch touches, for ordering.
 * Returns `{ ran: false, reason }` or `{ ran: true, ok, problems }`.
 */
export function localLint({ head, paths, changed = new Map(), cwd = process.cwd(), spawn = spawnSync }) {
  const git = args => spawn('git', args, { cwd, encoding: 'utf8', timeout: GIT_TIMEOUT_MS });
  const local = git(['rev-parse', 'HEAD']);
  if (local.error?.code === 'ENOENT') return { ran: false, reason: 'git is not installed or not on PATH' };
  if (local.error?.code === 'ETIMEDOUT' || local.signal) return { ran: false, reason: 'git did not answer within 30 seconds' };
  if (local.status !== 0) return { ran: false, reason: 'the working directory is not a Git checkout' };
  if (local.stdout.trim() !== head) return { ran: false, reason: `the local checkout is at ${local.stdout.trim().slice(0, 12)}, not the PR head ${head.slice(0, 12)}; run the preflight from a checkout of the head` };
  const dirty = git(['status', '--porcelain', '--', ...paths]);
  if (dirty.status !== 0 || dirty.stdout.trim()) return { ran: false, reason: 'changed files have local modifications; lint needs the committed head' };
  const eslint = path.join(cwd, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const run = spawn(process.execPath, [eslint, '--max-warnings=0', '--no-warn-ignored', '--format', 'json', '--', ...paths], {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: ESLINT_TIMEOUT_MS,
  });
  if (run.error?.code === 'ETIMEDOUT' || run.signal === 'SIGTERM') return { ran: false, reason: 'eslint did not finish within 10 minutes' };
  let results;
  try {
    results = JSON.parse(run.stdout);
  } catch {
    return { ran: false, reason: `eslint did not produce a report (exit ${run.status ?? run.signal})` };
  }
  const problems = results.flatMap(result => result.messages.map(message => ({
    file: path.relative(cwd, result.filePath), line: message.line ?? 0, ruleId: message.ruleId, severity: message.severity,
  })));
  return { ran: true, ok: run.status === 0 && problems.length === 0, problems: rankProblems(problems, changed).map(describe) };
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
  const changed = new Map(ctx.files.filter(file => paths.includes(file.filename)).map(file => [file.filename, changedLines(file.patch)]));
  const result = await lint({ head: ctx.head, paths, changed });
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
  if (result.problems.length > MAX_PROBLEMS) gate.note(`and ${result.problems.length - MAX_PROBLEMS} more; run eslint on the changed files for the full list`);
}
