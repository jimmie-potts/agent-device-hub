// The delivery preflight command line. `main` returns the exit status; the
// entry script only wires it to the process. Exit 0: every applicable gate
// satisfied; 1: unresolved; 2: a read failed; 3: usage or internal error.
import { parseArgs } from 'node:util';

import { redactPaths } from './context.mjs';
import { createReadOnlyClient, fetchTransport, resolveToken } from './github.mjs';
import { FINISH_LINES, runPreflight as defaultRun } from './preflight.mjs';
import { renderText } from './report.mjs';

const REPO = 'jimmie-potts/agent-device-hub';
export const USAGE = `Usage: npm run preflight -- --pr <number> [options]

Reports current evidence and pending gates for one Hub PR. It only reads GitHub
and local proof files; it never merges, comments, labels, approves or installs.

  --pr <number>             the delivery PR (required)
  --head <sha>              expected 40-character head; a different live head is unresolved
  --base <sha>              expected 40-character base; a moved base is unresolved
  --issue <number>          work issue (default: the single Refs/Closes #N in the PR body)
  --finish-line <line>      source (default), installed, real-client or physical
  --counterpart <o/r#n>     owned PR or issue that must be merged or completed (repeatable)
  --receipt <path>          app-verification/1 proof directory or receipt.json (repeatable)
  --ui                      deprecated; accepted and ignored
  --ui-approval <value>     deprecated; accepted and ignored (no approval record is read)
  --json                    print the machine-readable report instead of text
  --help                    show this help

Exit status: 0 satisfied, 1 unresolved, 2 read failure, 3 usage or internal error.
`;

class UsageError extends Error {}

function parse(argv) {
  const fail = message => {
    throw new UsageError(message);
  };
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
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    throw new UsageError(error.message);
  }
  const values = parsed.values;
  if (values.help) return { help: true };
  const number = value => (/^[1-9]\d*$/.test(String(value)) ? Number(value) : null);
  if (!number(values.pr)) fail('--pr needs a PR number');
  if (values.issue !== undefined && !number(values.issue)) fail('--issue needs an issue number');
  for (const key of ['head', 'base']) {
    if (values[key] !== undefined && !/^[0-9a-f]{40}$/.test(values[key])) fail(`--${key} needs a full 40-character commit SHA`);
  }
  if (!FINISH_LINES.includes(values['finish-line'])) fail(`--finish-line must be one of ${FINISH_LINES.join(', ')}`);
  for (const ref of values.counterpart) {
    if (!/^[\w.-]+\/[\w.-]+#\d+$/.test(ref)) fail(`--counterpart ${ref} must look like owner/repository#number`);
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
    },
  };
}

/**
 * Run the preflight for command-line arguments. `run` and `transport` are
 * injectable for tests; by default the live read-only GitHub transport is used.
 */
export async function main({ argv, env = process.env, stdout = process.stdout, stderr = process.stderr, run = defaultRun, transport } = {}) {
  let parsed;
  try {
    parsed = parse(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    stderr.write(`${error.message}\n\n${USAGE}`);
    return 3;
  }
  if (parsed.help) {
    stdout.write(USAGE);
    return 0;
  }
  let reader = transport;
  if (!reader) {
    const token = resolveToken(env);
    reader = token
      ? fetchTransport({ token })
      : async () => { throw new Error('no GitHub credential: set GH_TOKEN or GITHUB_TOKEN, or sign in with gh auth login'); };
  }
  let report;
  try {
    report = await run({ github: createReadOnlyClient(reader), declaration: parsed.declaration });
  } catch (error) {
    // An internal error: report it without local paths.
    stderr.write(`delivery preflight stopped by an internal error: ${redactPaths(error && error.message)}\n`);
    return 3;
  }
  stdout.write(parsed.json ? `${JSON.stringify(report, null, 2)}\n` : renderText(report));
  return report.exitCode;
}
