#!/usr/bin/env node
// Read-only delivery preflight for one Hub PR. See docs/development.md
// "Delivery preflight". Exit 0: every applicable gate satisfied; 1: unresolved;
// 2: a read failed; 3: usage or internal error.
import { parseArgs } from 'node:util';

import { createReadOnlyClient, fetchTransport, resolveToken } from './delivery-preflight/github.mjs';
import { FINISH_LINES, runPreflight } from './delivery-preflight/preflight.mjs';
import { renderText } from './delivery-preflight/report.mjs';

const REPO = 'jimmie-potts/agent-device-hub';
const USAGE = `Usage: npm run preflight -- --pr <number> [options]

Reports current evidence and pending gates for one Hub PR. It only reads GitHub
and local proof files; it never merges, comments, labels, approves or installs.

  --pr <number>             the delivery PR (required)
  --head <sha>              expected 40-character head; a different live head is unresolved
  --base <sha>              expected 40-character base; a moved base is unresolved
  --issue <number>          work issue (default: the single Refs/Closes #N in the PR body)
  --finish-line <line>      source (default), installed, real-client or physical
  --counterpart <o/r#n>     owned PR or issue that must be merged or completed (repeatable)
  --receipt <path>          app-verification/1 proof directory or receipt.json (repeatable)
  --ui                      declare a non-guide UI change the path list does not detect
  --ui-approval <url>       PR comment or review recording approval of a named candidate
  --guide-receipt <path>    guide-verification.json for the guide-only CI exception (repeatable)
  --guide-record <url>      PR comment recording that exception's evidence for one revision
                            (repeatable: a merged guide-only PR needs one for its head and
                            one for its merge commit)
  --json                    print the machine-readable report instead of text
  --help                    show this help

Exit status: 0 satisfied, 1 unresolved, 2 read failure, 3 usage or internal error.
`;

function usageError(message) {
  process.stderr.write(`${message}\n\n${USAGE}`);
  process.exit(3);
}

function parse(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      options: {
        pr: { type: 'string' },
        head: { type: 'string' },
        base: { type: 'string' },
        issue: { type: 'string' },
        'finish-line': { type: 'string', default: 'source' },
        counterpart: { type: 'string', multiple: true, default: [] },
        receipt: { type: 'string', multiple: true, default: [] },
        ui: { type: 'boolean', default: false },
        'ui-approval': { type: 'string' },
        'guide-receipt': { type: 'string', multiple: true, default: [] },
        'guide-record': { type: 'string', multiple: true, default: [] },
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    usageError(error.message);
  }
  const values = parsed.values;
  if (values.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const number = value => (/^[1-9]\d*$/.test(String(value)) ? Number(value) : null);
  if (!number(values.pr)) usageError('--pr needs a PR number');
  if (values.issue !== undefined && !number(values.issue)) usageError('--issue needs an issue number');
  for (const key of ['head', 'base']) {
    if (values[key] !== undefined && !/^[0-9a-f]{40}$/.test(values[key])) usageError(`--${key} needs a full 40-character commit SHA`);
  }
  if (!FINISH_LINES.includes(values['finish-line'])) usageError(`--finish-line must be one of ${FINISH_LINES.join(', ')}`);
  for (const ref of values.counterpart) {
    if (!/^[\w.-]+\/[\w.-]+#\d+$/.test(ref)) usageError(`--counterpart ${ref} must look like owner/repository#number`);
  }
  const record = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+#(?:issuecomment-\d+|pullrequestreview-\d+|discussion_r\d+)$/;
  for (const [key, urls] of [['ui-approval', values['ui-approval'] === undefined ? [] : [values['ui-approval']]], ['guide-record', values['guide-record']]]) {
    if (urls.some(url => !record.test(url))) usageError(`--${key} must be a PR comment or review URL`);
  }
  return {
    json: values.json,
    declaration: {
      repo: REPO,
      pr: number(values.pr),
      head: values.head,
      base: values.base,
      issue: values.issue === undefined ? undefined : number(values.issue),
      finishLine: values['finish-line'],
      counterparts: values.counterpart,
      receipts: values.receipt,
      ui: values.ui,
      uiApproval: values['ui-approval'],
      guideReceipts: values['guide-receipt'],
      guideRecords: values['guide-record'],
    },
  };
}

const { json, declaration } = parse(process.argv.slice(2));
const token = resolveToken();
const transport = token
  ? fetchTransport({ token })
  : async () => { throw new Error('no GitHub credential: set GH_TOKEN or GITHUB_TOKEN, or sign in with gh auth login'); };
let report;
try {
  report = await runPreflight({ github: createReadOnlyClient(transport), declaration });
} catch (error) {
  // An internal error: report it without local paths.
  const message = String(error && error.message).replace(/(?:~|\/)[^\s'"]*\/[^\s'"]*/g, '[path]');
  process.stderr.write(`delivery preflight stopped by an internal error: ${message}\n`);
  process.exit(3);
}
process.stdout.write(json ? `${JSON.stringify(report, null, 2)}\n` : renderText(report));
process.exitCode = report.exitCode;
