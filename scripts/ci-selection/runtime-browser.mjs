#!/usr/bin/env node
// The Runtime dashboard browser suite workflow (Hub #1942) runs the full `test:runtime-dashboard:browser` suite after
// each push to main whose changes the affected-check selector maps to the runtime group, and keeps one open issue for
// its failures. It gates no pull request and is not a required check.
//   node scripts/ci-selection/runtime-browser.mjs select   decide whether this run runs the suite: writes run=true|false
//   node scripts/ci-selection/runtime-browser.mjs run      run the suite's journeys in order: writes journey=<name> when one fails
//   node scripts/ci-selection/runtime-browser.mjs report   after a failed push to main, comment on the open issue or open it
// Like the selector, this module has no dependencies: the select and report steps run it without `npm ci`.
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { selectChecks } from './selection.mjs';

/** The package script this workflow runs, journey by journey. */
export const SUITE = 'test:runtime-dashboard:browser';
/** The fixed title of the one open issue that collects the suite's failures on main. */
export const ISSUE_TITLE = 'Runtime dashboard browser suite fails on main';
// GitHub's comparison lists at most 300 files; a list that long may be truncated.
const COMPARE_FILE_LIMIT = 300;
// The open-issue search reads at most this many pages of 100 before it gives up rather than open a duplicate.
const ISSUE_PAGE_LIMIT = 50;
const SHA = /^[0-9a-f]{40}$/;
const NO_REVISION = '0'.repeat(40);
const JOURNEY = /^[A-Za-z0-9][\w.:-]{0,119}$/;

const api = env => env.GITHUB_API_URL || 'https://api.github.com';
const headers = env => ({
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${env.GITHUB_TOKEN}`,
  'x-github-api-version': '2022-11-28',
});

/** The paths a push changed. A failed or possibly truncated read is incomplete, never empty. */
async function readComparison(env, before, after, fetch) {
  let body;
  try {
    const response = await fetch(`${api(env)}/repos/${env.GITHUB_REPOSITORY}/compare/${before}...${after}`, { method: 'GET', headers: headers(env) });
    if (!response.ok) return { complete: false, detail: `the comparison could not be read: HTTP ${response.status}` };
    body = await response.json();
  } catch (error) {
    return { complete: false, detail: `the comparison could not be read: ${error && error.message ? error.message : 'unknown error'}` };
  }
  if (!body || !Array.isArray(body.files)) return { complete: false, detail: 'the comparison returned no file list' };
  if (body.files.length >= COMPARE_FILE_LIMIT) {
    return { complete: false, detail: `the comparison lists ${body.files.length} files, GitHub's limit of ${COMPARE_FILE_LIMIT}` };
  }
  return { complete: true, paths: body.files.flatMap(file => [file.filename, file.previous_filename].filter(Boolean)) };
}

/**
 * Decide whether this run runs the suite. Pull requests (which trigger this workflow only by changing it) and manual
 * runs always do. A push runs it when the affected-check selector maps the pushed changes to the runtime group, or
 * when those changes are not known exactly: a first push, a force push or an unreadable comparison.
 * Returns {run, reason}.
 */
export async function decideRun({ event, payload, env, fetch }) {
  if (event === 'pull_request') return { run: true, reason: 'a pull request that changes this workflow runs the suite as its proof' };
  if (event === 'workflow_dispatch') return { run: true, reason: 'a manual run always runs the suite' };
  if (event !== 'push') throw new Error(`unsupported event ${JSON.stringify(event)}`);
  const before = payload && payload.before;
  const after = payload && payload.after;
  if (!SHA.test(String(after)) || after !== env.GITHUB_SHA) throw new Error('the push event does not name this run\'s revision');
  if (!SHA.test(String(before)) || before === NO_REVISION) return { run: true, reason: 'the push names no earlier revision to compare' };
  if (payload.forced) return { run: true, reason: 'a force push is not compared, because it may replace revisions' };
  const comparison = await readComparison(env, before, after, fetch);
  if (!comparison.complete) return { run: true, reason: `the pushed changes are not known exactly: ${comparison.detail}` };
  // The pushed range goes through the same mapping as a pull request's comparison, so "runtime" means the same paths.
  // Standalone owners are not evaluated: their changed tests belong to the runtime group's paths.
  const selection = selectChecks({ event: 'pull_request', paths: comparison.paths, complete: true });
  const selected = selection.groups.join(', ') || 'no group';
  return selection.groups.includes('runtime')
    ? { run: true, reason: `the pushed changes select the runtime group (${selected})` }
    : { run: false, reason: `the pushed changes do not select the runtime group (${selected})` };
}

/** The select step: write run=true|false and a one-line job summary. */
export async function runSelect({ env = process.env, fetch = globalThis.fetch } = {}) {
  const event = env.GITHUB_EVENT_NAME;
  const payload = event === 'push' ? JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8')) : null;
  const decision = await decideRun({ event, payload, env, fetch });
  appendFileSync(env.GITHUB_OUTPUT, `run=${decision.run}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(env.GITHUB_STEP_SUMMARY, `### Runtime dashboard browser suite: ${decision.run ? 'runs' : 'not run'}\n\n${decision.reason}.\n`);
  }
  return decision;
}

/**
 * The suite's journeys, in order, from its package script. The script is a plain `&&` chain of `node <file>.ts` and
 * `npm run <script>` commands; anything else is refused, so the runner can never run less than the script does.
 */
export function journeys(command) {
  if (typeof command !== 'string' || !command) throw new Error(`package.json has no ${SUITE} script`);
  return command.split(' && ').map(part => {
    const file = part.match(/^node ([\w./-]+\.ts)$/);
    if (file) return { name: file[1].split('/').at(-1), command: 'node', args: [file[1]] };
    const script = part.match(/^npm run ([\w:-]+)$/);
    if (script) return { name: script[1], command: 'npm', args: ['run', script[1]] };
    throw new Error(`${SUITE} has a command this runner does not read: ${JSON.stringify(part)}`);
  });
}

/**
 * The run step: run each journey as the package script would, stopping at the first failure. A failure writes
 * journey=<name> for the report job. Returns the exit code.
 */
export function runSuite({ env = process.env, spawn = spawnSync, scripts } = {}) {
  const list = journeys((scripts ?? JSON.parse(readFileSync('package.json', 'utf8')).scripts)[SUITE]);
  for (const [index, journey] of list.entries()) {
    console.log(`\nJourney ${index + 1} of ${list.length}: ${journey.name}`);
    const result = spawn(journey.command, journey.args, { env, stdio: 'inherit' });
    if (result.status !== 0 || result.error) {
      const how = result.error ? 'could not start' : result.signal ? `ended by ${result.signal}` : `exited with status ${result.status}`;
      console.log(`::error title=Runtime dashboard browser suite::${journey.name} ${how}`);
      if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `journey=${journey.name}\n`);
      return 1;
    }
  }
  console.log(`\nAll ${list.length} journeys passed.`);
  return 0;
}

async function request(env, fetch, method, route, body) {
  const response = await fetch(`${api(env)}${route}`, {
    method,
    headers: body ? { ...headers(env), 'content-type': 'application/json' } : headers(env),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new Error(`${method} ${route.split('?')[0]} failed: HTTP ${response.status}`);
  return response.json();
}

/** The open issue with the fixed title, or null. Reads every page of open issues; pull requests are not issues. */
async function openIssue(env, fetch) {
  const matches = [];
  for (let page = 1; page <= ISSUE_PAGE_LIMIT; page += 1) {
    const items = await request(env, fetch, 'GET', `/repos/${env.GITHUB_REPOSITORY}/issues?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(items)) throw new Error('the open-issue list is not a list');
    matches.push(...items.filter(item => item && !item.pull_request && item.title === ISSUE_TITLE && Number.isSafeInteger(item.number)));
    if (items.length < 100) return matches.length ? matches.reduce((a, b) => (a.number < b.number ? a : b)) : null;
  }
  throw new Error(`more than ${ISSUE_PAGE_LIMIT * 100} open issues; refusing to open a possible duplicate`);
}

/**
 * The report job. After a push to main whose suite job did not succeed, comment on the open issue with the fixed
 * title, or open it. The text names only the commit, the run and the failing journey. Other runs file nothing.
 * Returns {action: 'none' | 'commented' | 'opened', number?, reason?}.
 */
export async function report({ env = process.env, fetch = globalThis.fetch } = {}) {
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main') {
    return { action: 'none', reason: `a ${env.GITHUB_EVENT_NAME} run on ${env.GITHUB_REF} files no issue` };
  }
  if (env.SUITE_RESULT === 'success') return { action: 'none', reason: 'the suite passed' };
  if (!SHA.test(env.GITHUB_SHA ?? '') || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? '')
    || !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '')) {
    throw new Error('the run does not name its revision, run and repository');
  }
  const run = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`;
  const journey = JOURNEY.test(env.FAILED_JOURNEY ?? '') ? `\`${env.FAILED_JOURNEY}\`` : 'none recorded (the job failed outside a journey or reached its time limit)';
  const facts = [`- Commit: ${env.GITHUB_SHA}`, `- Run: ${run}`, `- Failing journey: ${journey}`].join('\n');
  const existing = await openIssue(env, fetch);
  if (existing) {
    await request(env, fetch, 'POST', `/repos/${env.GITHUB_REPOSITORY}/issues/${existing.number}/comments`, {
      body: `The runtime dashboard browser suite failed again on main.\n\n${facts}\n`,
    });
    return { action: 'commented', number: existing.number };
  }
  const created = await request(env, fetch, 'POST', `/repos/${env.GITHUB_REPOSITORY}/issues`, {
    title: ISSUE_TITLE,
    body: 'The runtime dashboard browser suite failed after a push to main. The Runtime dashboard browser suite workflow '
      + '(`.github/workflows/runtime-dashboard-browser.yml`) opened this issue and comments on it while it stays open.\n\n'
      + `${facts}\n`,
  });
  return { action: 'opened', number: created && created.number };
}

async function main(argv) {
  const [command] = argv;
  if (command === 'select') {
    const decision = await runSelect();
    console.log(`${decision.run ? 'Runs' : 'Does not run'} the suite: ${decision.reason}`);
    return 0;
  }
  if (command === 'run') return runSuite();
  if (command === 'report') {
    const outcome = await report();
    console.log(outcome.action === 'none' ? `No issue: ${outcome.reason}` : `${outcome.action === 'opened' ? 'Opened' : 'Commented on'} issue #${outcome.number}`);
    return 0;
  }
  console.error('usage: node scripts/ci-selection/runtime-browser.mjs select|run|report');
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    console.error(`::error::${String(error && error.message ? error.message : error).replace(/[\r\n%]/g, ' ')}`);
    process.exitCode = 1;
  });
}
