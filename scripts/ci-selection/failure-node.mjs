// Runs beside Node's default spec reporter. Only final failure events carry a result into the public summary.
// Node emits case results in reporter order, followed by the summary naming their test file. A shared registration
// helper can be the case's reported source location, so take module identity from the file summary.
import {writeFileSync} from 'node:fs';
import {relative} from 'node:path';
import {nodeFields} from './failure-fields.mts';

const directories = new Map([
  ['apps/runtime/dist/tests', 'runtime'], ['apps/runtime/dist/tests/scenarios', 'scenario'],
  ['apps/runtime/dist/verify/tests', 'catalog'], ['modules/presence-pro/dist/tests', 'presence'],
]);

export default async function* failures(events) {
  const cases = [], pending = [];
  let ordinal = 0, fileNumber = 0, omitted = false;
  for await (const {type, data} of events) {
    if (type === 'test:pass' || type === 'test:fail') ordinal++;
    if (type === 'test:fail' && !data.todo && !data.skip && data.details?.error?.failureType !== 'subtestsFailed') {
      if (cases.length + pending.length >= 10) omitted = true;
      else pending.push({file: data.file, line: data.line, column: data.column, caseId: data.testId, ordinal,
        duration: Math.round(data.details?.duration_ms)});
    }
    if (type !== 'test:summary') continue;
    if (data.file) fileNumber++;
    const match = typeof data.file === 'string' && /^(.*)\/([^/]+)\.test\.js$/.exec(relative(process.cwd(), data.file));
    for (const item of pending.splice(0)) {
      const declaredHere = data.file && item.file === data.file;
      cases.push(nodeFields({suite: match && directories.get(match[1]), module: match && match[2],
        caseId: item.caseId, ordinal: item.ordinal, fileNumber: data.file ? fileNumber : undefined, line: declaredHere ? item.line : undefined,
        column: declaredHere ? item.column : undefined, duration: item.duration}));
    }
    if (!data.file && !data.success && !process.env.NODE_TEST_CONTEXT) {
      try {
        writeFileSync(process.env.BUNNY_CI_NODE_RECORD, JSON.stringify({cases, omitted}), {mode: 0o600, flag: 'wx'});
      } catch { /* Diagnostics never change the result of the ordinary reporter. */ }
    }
  }
  yield '';
}
