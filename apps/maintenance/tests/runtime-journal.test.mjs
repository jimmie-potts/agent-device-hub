// After the cutover (#840), maintenance intake reads the B.U.N.N.Y. runtime's journal (Hub #903). These tests run the
// built runtime, put its own stderr lines into synthetic journald rows and give them to intake: every line is a
// diagnostic-contract record, and the runtime's fatal failure becomes a finding.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, realpath, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {collectJournal} from '../dist/journal.js';
import {shippedModules} from '../../runtime/dist/src/index.js';
import {writeSimulatedConfiguration} from '../../runtime/dist/tests/fixtures/simulated.js';

const MAIN = fileURLToPath(new URL('../../runtime/dist/src/main.js', import.meta.url));
const UNIT = 'bunny-runtime.service';

/** Runs the runtime with `args` and returns its exit code and stderr lines; `stop` sends SIGTERM once it is ready. */
async function runtime(args, stop) {
  const child = spawn(process.execPath, [MAIN, '--port', '0', ...args], {stdio: ['ignore', 'pipe', 'pipe']});
  let stderr = '';
  let stdout = '';
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.stdout.setEncoding('utf8').on('data', chunk => {
    stdout += chunk;
    if (stop && stdout.includes('\n')) child.kill('SIGTERM');
  });
  const [code] = await once(child, 'exit');
  return {code, lines: stderr.split('\n').filter(line => line !== '')};
}

/** Each line as the MESSAGE of a journald row of the runtime's unit, at the record's own time. */
const rows = lines => lines.map((line, index) => JSON.stringify({
  _SYSTEMD_USER_UNIT: UNIT, __REALTIME_TIMESTAMP: String(Date.parse(JSON.parse(line).timestamp) * 1000), __CURSOR: `s=synthetic;i=${index}`, MESSAGE: line,
}) + '\n').join('');
async function* chunks(text) { yield Buffer.from(text); }
const window = lines => {
  const times = lines.map(line => Date.parse(JSON.parse(line).timestamp));
  return {since: Math.min(...times), until: Math.max(...times) + 1};
};
const options = (lines, services = ['runtime']) => ({units: [UNIT], services, ...window(lines), maxRows: 100, maxBytes: 1024 * 1024});

/** A clean run of every shipped module, simulated, that stops on SIGTERM, then a start refused for a relative state directory. */
async function journal() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'bunny-intake-runtime-')));
  try {
    // Every shipped module that takes a configuration gets its simulated section. Without it the runtime refuses such a
    // module at ERROR, which intake would rightly take as a finding.
    const config = await writeSimulatedConfiguration(join(dir, 'config'), shippedModules);
    const clean = await runtime(['--state-dir', join(dir, 'state'), '--simulate', '--config', config], true);
    assert.equal(clean.code, 0);
    const refused = await runtime(['--state-dir', 'relative/state'], false);
    assert.equal(refused.code, 1);
    return [...clean.lines, ...refused.lines];
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
}

test('intake accepts every line the runtime writes, and the runtime\'s fatal failure becomes a finding', async () => {
  const lines = await journal();
  assert.ok(lines.length >= 3, 'a start, a stop and a failure');
  const result = await collectJournal(chunks(rows(lines)), options(lines));
  assert.equal(result.coverage.rejected, 0);
  assert.deepEqual(result.accepted.map(entry => entry.message), lines, 'every line is a contract record');
  assert.deepEqual(result.findings.map(({fingerprint: _fingerprint, ...finding}) => finding), [
    {service: 'runtime', scope: 'bunny.runtime', event: 'runtime.failed', operation: 'maintenance', outcome: 'uncertain', reason: 'none', count: 1},
  ]);
  assert.equal(result.coverage.status, 'partial');
});

test('intake refuses a runtime line from before the runtime joined the contract, or labeled with an earlier profile', async () => {
  const lines = await journal();
  const failed = JSON.parse(lines.find(line => JSON.parse(line).event_name === 'runtime.failed'));
  // The record #880 wrote: OpenTelemetry field names, but no schema version, body, scope version or full resource.
  const before = JSON.stringify({timestamp: failed.timestamp, severity_text: 'FATAL', severity_number: 21, event_name: 'runtime.failed',
    resource: {'service.namespace': 'bunny', 'service.name': 'runtime'}, scope: {name: 'bunny.runtime'}, attributes: failed.attributes});
  const earlier = JSON.stringify({...failed, schema_version: '1.1'});
  const result = await collectJournal(chunks(rows([before, earlier])), options([before, earlier]));
  assert.deepEqual([result.accepted.length, result.findings.length, result.coverage.rejected], [0, 0, 2]);
});

test('intake reads the runtime only once its configuration names the runtime\'s service', async () => {
  const lines = await journal();
  const hubOnly = await collectJournal(chunks(rows(lines)), options(lines, ['hub']));
  assert.deepEqual([hubOnly.accepted.length, hubOnly.coverage.rejected], [0, lines.length]);
});
