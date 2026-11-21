#!/usr/bin/env node
// The Runtime dashboard browser suite workflow (Hub #1942) runs the full `test:runtime-dashboard:browser` suite after
// each push to main whose changes the affected-check selector maps to the runtime group, and keeps one open issue for
// its failures. It gates no pull request and is not a required check. Since #2015 the suite is a fixed set of journey
// groups, `test:runtime-dashboard:browser:<group>`, and each group runs in its own parallel job.
//   node scripts/ci-selection/runtime-browser.mjs select         decide whether this run runs the suite: writes run=true|false
//   node scripts/ci-selection/runtime-browser.mjs run [group]    run one group's journeys in order, or every group's: writes
//                                                                passed_<group>=true, or journey_<group>=<name> when one fails
//   node scripts/ci-selection/runtime-browser.mjs report         after a failed push to main, comment on the open issue or open it
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
// A group's name is its number, which also names its job and its outputs.
const GROUP_ENTRY = new RegExp(`^npm run ${SUITE}:([1-9][0-9]?)$`);
// The login of issues the workflow's GITHUB_TOKEN opens. Anyone can open an issue with the same title in this public
// repository, so only the workflow's own issue collects the comments.
export const ISSUE_AUTHOR = 'github-actions[bot]';

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
 * One group's journeys, in order, from its package script. The script is a plain `&&` chain of `node <file>.ts` and
 * `npm run <script>` commands; anything else is refused, so the runner can never run less than the script does.
 */
export function journeys(command, script = SUITE) {
  if (typeof command !== 'string' || !command) throw new Error(`package.json has no ${script} script`);
  return command.split(' && ').map(part => {
    const file = part.match(/^node ([\w./-]+\.ts)$/);
    if (file) return { name: file[1].split('/').at(-1), command: 'node', args: [file[1]] };
    const nested = part.match(/^npm run ([\w:-]+)$/);
    if (nested && nested[1] !== SUITE && !nested[1].startsWith(`${SUITE}:`)) return { name: nested[1], command: 'npm', args: ['run', nested[1]] };
    throw new Error(`${script} has a command this runner does not read: ${JSON.stringify(part)}`);
  });
}

/**
 * The suite's groups, in order, with their journeys. The suite script is a plain `&&` chain of
 * `npm run test:runtime-dashboard:browser:<group>`, and every journey belongs to exactly one group. Returns
 * [{name, journeys}]; anything else is refused.
 */
export function groups(scripts) {
  const command = scripts && scripts[SUITE];
  if (typeof command !== 'string' || !command) throw new Error(`package.json has no ${SUITE} script`);
  const list = command.split(' && ').map(part => {
    const entry = part.match(GROUP_ENTRY);
    if (!entry) throw new Error(`${SUITE} has a command this runner does not read as a group: ${JSON.stringify(part)}`);
    return { name: entry[1], journeys: journeys(scripts[`${SUITE}:${entry[1]}`], `${SUITE}:${entry[1]}`) };
  });
  const names = list.map(group => group.name);
  if (new Set(names).size !== names.length) throw new Error(`${SUITE} names a group more than once`);
  const seen = new Map();
  for (const group of list) {
    for (const journey of group.journeys) {
      if (seen.has(journey.name)) throw new Error(`${journey.name} is in group ${seen.get(journey.name)} and group ${group.name}`);
      seen.set(journey.name, group.name);
    }
  }
  return list;
}

const packageScripts = () => JSON.parse(readFileSync('package.json', 'utf8')).scripts;

/**
 * The run step: run one group's journeys, or every group's in order when no group is named, as the package scripts
 * would, stopping at the first failure. A group whose journeys all pass writes passed_<group>=true; a failure writes
 * journey_<group>=<name>. The job's outputs carry both to the report job. Returns the exit code.
 */
export function runSuite({ env = process.env, spawn = spawnSync, scripts, group } = {}) {
  const all = groups(scripts ?? packageScripts());
  const selected = group === undefined ? all : all.filter(item => item.name === group);
  if (!selected.length) throw new Error(`${SUITE} has no group ${JSON.stringify(group)}; its groups are ${all.map(item => item.name).join(', ')}`);
  const total = selected.reduce((count, item) => count + item.journeys.length, 0);
  const output = line => { if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${line}\n`); };
  let index = 0;
  for (const item of selected) {
    for (const journey of item.journeys) {
      index += 1;
      console.log(`\nJourney ${index} of ${total}, group ${item.name}: ${journey.name}`);
      const result = spawn(journey.command, journey.args, { env, stdio: 'inherit' });
      if (result.status !== 0 || result.error) {
        const how = result.error ? 'could not start' : result.signal ? `ended by ${result.signal}` : `exited with status ${result.status}`;
        console.log(`::error title=Runtime dashboard browser suite::${journey.name} ${how}`);
        output(`journey_${item.name}=${journey.name}`);
        return 1;
      }
    }
    output(`passed_${item.name}=true`);
  }
  console.log(`\nAll ${total} journeys passed.`);
  return 0;
}

/** The suite job's outputs, as `toJSON(needs.suite.outputs)` gives them; anything unreadable records nothing. */
export function suiteOutputs(text) {
  try {
    const value = JSON.parse(text ?? '');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

/**
 * What each group recorded: [{name, passed, journey}], where journey is the failing journey's name when the group
 * recorded one of its own journeys, otherwise null.
 */
export function groupResults(list, outputs) {
  return list.map(group => {
    const journey = outputs[`journey_${group.name}`];
    const known = typeof journey === 'string' && JOURNEY.test(journey) && group.journeys.some(item => item.name === journey);
    return { name: group.name, passed: outputs[`passed_${group.name}`] === 'true', journey: known ? journey : null };
  });
}

/** One line per group that did not record a pass: its failing journey, or that it recorded none. */
function failures(results) {
  const lines = results.filter(result => !result.passed).map(result => `- Failing journey in group ${result.name}: `
    + (result.journey ? `\`${result.journey}\`` : 'none recorded (the group failed outside a journey or reached its time limit)'));
  return lines.length ? lines : ['- Failing journey: none recorded (every group recorded a pass)'];
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

/**
 * The open issue with the fixed title that the workflow itself opened, or null. Reads every page of open issues; pull
 * requests and issues by anyone else are ignored.
 */
async function openIssue(env, fetch) {
  const matches = [];
  for (let page = 1; page <= ISSUE_PAGE_LIMIT; page += 1) {
    const items = await request(env, fetch, 'GET', `/repos/${env.GITHUB_REPOSITORY}/issues?state=open&per_page=100&page=${page}`);
    if (!Array.isArray(items)) throw new Error('the open-issue list is not a list');
    matches.push(...items.filter(item => item && !item.pull_request && item.title === ISSUE_TITLE && item.user?.login === ISSUE_AUTHOR
      && Number.isSafeInteger(item.number)));
    if (items.length < 100) return matches.length ? matches.reduce((a, b) => (a.number < b.number ? a : b)) : null;
  }
  throw new Error(`more than ${ISSUE_PAGE_LIMIT * 100} open issues; refusing to open a possible duplicate`);
}

/**
 * The report job, after every group has finished. After a push to main whose suite job did not succeed, comment on the
 * open issue with the fixed title, or open it. The text names only the commit, the run and each group's failing
 * journey. Other runs file nothing. Returns {action: 'none' | 'commented' | 'opened', number?, reason?}.
 */
export async function report({ env = process.env, fetch = globalThis.fetch, scripts } = {}) {
  if (env.GITHUB_EVENT_NAME !== 'push' || env.GITHUB_REF !== 'refs/heads/main') {
    return { action: 'none', reason: `a ${env.GITHUB_EVENT_NAME} run on ${env.GITHUB_REF} files no issue` };
  }
  if (env.SUITE_RESULT === 'success') return { action: 'none', reason: 'the suite passed' };
  if (!SHA.test(env.GITHUB_SHA ?? '') || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? '') || !/^[1-9]\d*$/.test(env.GITHUB_RUN_ATTEMPT ?? '')
    || !/^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '')) {
    throw new Error('the run does not name its revision, run and repository');
  }
  const run = `${env.GITHUB_SERVER_URL || 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`;
  const results = groupResults(groups(scripts ?? packageScripts()), suiteOutputs(env.SUITE_OUTPUTS));
  const facts = [`- Commit: ${env.GITHUB_SHA}`, `- Run: ${run}`, ...failures(results)].join('\n');
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
  if (command === 'run' && argv.length <= 2) return runSuite({ group: argv[1] });
  if (command === 'report') {
    // Every run logs what each group recorded, as evidence that the groups' outputs reached this job.
    const results = groupResults(groups(packageScripts()), suiteOutputs(process.env.SUITE_OUTPUTS));
    console.log(`Group results: ${results.map(result => `${result.name} ${result.passed ? 'passed' : result.journey ? `failed in ${result.journey}` : 'recorded nothing'}`).join('; ')}`);
    const outcome = await report();
    console.log(outcome.action === 'none' ? `No issue: ${outcome.reason}` : `${outcome.action === 'opened' ? 'Opened' : 'Commented on'} issue #${outcome.number}`);
    return 0;
  }
  console.error('usage: node scripts/ci-selection/runtime-browser.mjs select|run [group]|report');
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    console.error(`::error::${String(error && error.message ? error.message : error).replace(/[\r\n%]/g, ' ')}`);
    process.exitCode = 1;
  });
}
