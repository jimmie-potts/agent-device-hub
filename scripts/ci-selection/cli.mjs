#!/usr/bin/env node
// The Checks workflow's entry points for affected PR checks (Hub #1080):
//   node scripts/ci-selection/cli.mjs select   the select job: write the selection to GITHUB_OUTPUT
//   node scripts/ci-selection/cli.mjs gate     the final gate: fail unless every selected job succeeded
// Both write a short job summary. They read only the event payload, one comparison and the `needs` context.
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { GROUPS, NOTICE_TITLE, gateVerdict, noticeMessage, selectChecks } from './selection.mjs';

// GitHub's comparison lists at most 300 files; a list that long may be truncated.
export const COMPARE_FILE_LIMIT = 300;

/** Read the event's exact comparison. Returns {paths, complete, detail}; a failed read is incomplete, never empty. */
async function comparisonPaths(env, payload, fetch) {
  const pull = payload && payload.pull_request;
  const base = pull && pull.base && pull.base.sha;
  const head = pull && pull.head && pull.head.sha;
  if (!/^[0-9a-f]{40}$/.test(String(base)) || !/^[0-9a-f]{40}$/.test(String(head))) {
    return { paths: [], complete: false, detail: 'the event names no base and head revision' };
  }
  const url = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${env.GITHUB_REPOSITORY}/compare/${base}...${head}`;
  let response;
  let body;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${env.GITHUB_TOKEN}`, 'x-github-api-version': '2022-11-28' },
    });
    if (!response.ok) return { paths: [], complete: false, detail: `the comparison could not be read: HTTP ${response.status}` };
    body = await response.json();
  } catch (error) {
    return { paths: [], complete: false, detail: `the comparison could not be read: ${error && error.message ? error.message : 'unknown error'}` };
  }
  if (!body || !Array.isArray(body.files)) return { paths: [], complete: false, detail: 'the comparison returned no file list' };
  const paths = body.files.flatMap(file => [file.filename, file.previous_filename].filter(Boolean));
  if (body.files.length >= COMPARE_FILE_LIMIT) {
    return { paths, complete: false, detail: `the comparison lists ${body.files.length} files, GitHub's limit of ${COMPARE_FILE_LIMIT}` };
  }
  return { paths, complete: true };
}

function summary(env, lines) {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

function describe(selection) {
  const lines = [
    `### Affected checks: ${selection.mode === 'full' ? 'full coverage' : 'selected groups'}`,
    '',
    `Selected: ${selection.groups.join(', ') || 'none (build, typecheck and lint only)'}`,
    `Omitted (no changed path selects them): ${selection.omitted.join(', ') || 'none'}`,
    '',
  ];
  for (const item of selection.full) lines.push(`- full coverage: ${item.path ? `\`${item.path}\` is ` : ''}${item.reason}`);
  for (const item of selection.reasons) lines.push(`- \`${item.path}\`: ${item.groups.join(', ') || 'no group'} (${item.reason})`);
  return lines;
}

/** The select job. Returns the selection after writing it to GITHUB_OUTPUT and the job summary. */
export async function runSelect({ env = process.env, fetch = globalThis.fetch } = {}) {
  const event = env.GITHUB_EVENT_NAME;
  let input = { paths: [], complete: true };
  if (event === 'pull_request') {
    const payload = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    input = await comparisonPaths(env, payload, fetch);
  }
  const selection = selectChecks({ event, ...input });
  const outputs = { mode: selection.mode, groups: JSON.stringify(selection.groups), ...Object.fromEntries(Object.entries(selection.jobs).map(([id, run]) => [id, String(run)])) };
  appendFileSync(env.GITHUB_OUTPUT, Object.entries(outputs).map(([key, value]) => `${key}=${value}\n`).join(''));
  summary(env, describe(selection));
  return selection;
}

/** The final gate. Returns the verdict after writing the job summary; the caller exits non-zero unless it is ok. */
export async function runGate({ env = process.env } = {}) {
  let verdict;
  try {
    verdict = gateVerdict(JSON.parse(env.NEEDS));
  } catch {
    verdict = { ok: false, problems: ['the needs context is not readable JSON'], lines: [] };
  }
  summary(env, [
    `### Selected checks gate: ${verdict.ok ? 'passed' : 'failed'}`,
    '',
    ...verdict.lines.map(line => `- ${line}`),
    ...verdict.problems.filter(problem => !verdict.lines.includes(problem)).map(problem => `- ${problem}`),
  ]);
  return verdict;
}

async function main(argv) {
  const [command] = argv;
  if (command === 'select') {
    const selection = await runSelect();
    console.log(`${selection.mode}: ${selection.groups.join(', ') || 'no group'} (of ${GROUPS.join(', ')})`);
    // The delivery preflight reads this annotation back and checks that the hosted selection covers its own.
    console.log(`::notice title=${NOTICE_TITLE}::${noticeMessage(selection)}`);
    return 0;
  }
  if (command === 'gate') {
    const verdict = await runGate();
    for (const line of verdict.lines) console.log(line);
    for (const problem of verdict.problems) console.error(`::error::${problem}`);
    return verdict.ok ? 0 : 1;
  }
  console.error('usage: node scripts/ci-selection/cli.mjs select|gate');
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    console.error(`::error::${error && error.message ? error.message : error}`);
    process.exitCode = 1;
  });
}
