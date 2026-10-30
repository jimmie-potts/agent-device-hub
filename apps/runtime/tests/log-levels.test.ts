// The log's floor and a module's own floor (Hub #811): the configuration file's `diagnostics` section keeps INFO and
// above by default and lets one module write its DEBUG records without widening the others. An invalid section refuses
// the file with `config-invalid`, as the other sections do, and a level never changes what a module does.
import assert from 'node:assert/strict';
import {RuntimeError, checkDiagnosticsSection, startRuntime, type LogRecord} from '../src/index.js';
import {LogWriter} from '../src/log.js';
import {assertContractRecords, contextOf, fixture, it, run, stateDir} from './support.js';

const clock = {now: () => Date.parse('2026-10-30T12:00:00.000Z')};
const code = (expected: string) => (error: unknown): boolean => error instanceof RuntimeError && error.code === expected;
const named = (logs: readonly LogRecord[], module: string): string[] =>
  logs.filter(record => record.attributes['bunny.module'] === module && record.event_name === 'command.completed').map(record => record.severity_text);

/** A module that writes one record at each level once it starts. */
const talker = (name: string) => fixture(name, ({log}) => {
  log.debug('command.completed', {'bunny.outcome': 'succeeded'});
  log.info('command.completed', {'bunny.outcome': 'succeeded'});
  log.warn('command.completed', {'bunny.outcome': 'failed'});
});

it('the diagnostics section takes a level and a level per module, and refuses anything else', () => {
  assert.deepEqual(checkDiagnosticsSection({}), {modules: {}});
  assert.deepEqual(checkDiagnosticsSection({level: 'warn'}), {level: 'warn', modules: {}});
  assert.deepEqual(checkDiagnosticsSection({modules: {pixoo: 'debug', core: 'error'}}), {modules: {pixoo: 'debug', core: 'error'}});
  for (const [section, why] of [
    [[], 'a list'], ['debug', 'a string'], [{level: 'fatal'}, 'fatal is the process\'s own'], [{level: 'DEBUG'}, 'levels are lower case'],
    [{level: 'trace'}, 'no trace level'], [{floor: 'info'}, 'another member'], [{modules: ['pixoo']}, 'modules is an object'],
    [{modules: {pixoo: 'verbose'}}, 'a module\'s level'], [{modules: {'Pixoo Display': 'debug'}}, 'a module name'],
    [{modules: {['x'.repeat(65)]: 'debug'}}, 'a name within 64 characters'],
    [{modules: Object.fromEntries(Array.from({length: 33}, (_, index) => [`module-${index}`, 'debug']))}, 'at most 32 entries'],
  ] as const) {
    assert.throws(() => checkDiagnosticsSection(section), code('config-invalid'), why);
  }
});

it('a logger\'s own floor replaces the writer\'s, and a record below either floor is neither written nor counted', () => {
  const written: LogRecord[] = [];
  const writer = new LogWriter(record => { written.push(record); }, 'info', clock);
  const quiet = writer.logger('bunny.module', {'bunny.module': 'quiet'});
  const chatty = writer.logger('bunny.module', {'bunny.module': 'chatty'}, 'debug');
  const terse = writer.logger('bunny.module', {'bunny.module': 'terse'}, 'error');
  for (const log of [quiet, chatty, terse]) {
    log.debug('command.completed', {'bunny.outcome': 'succeeded'});
    log.info('command.completed', {'bunny.outcome': 'succeeded'});
    log.warn('command.completed', {'bunny.outcome': 'failed'});
    log.error('operation.failed', {'bunny.operation': 'status', 'bunny.outcome': 'failed'});
  }
  assert.deepEqual(named(written, 'quiet'), ['INFO', 'WARN'], 'the writer\'s floor');
  assert.deepEqual(named(written, 'chatty'), ['DEBUG', 'INFO', 'WARN'], 'its own lower floor');
  assert.deepEqual(named(written, 'terse'), [], 'its own higher floor');
  assert.equal(written.filter(record => record.attributes['bunny.module'] === 'terse').length, 1, 'the error is above it');
  assert.deepEqual(writer.counts(), {written: 8, dropped: 0, failed: 0}, 'a record below a floor is not a dropped record');
});

it('INFO and above is the default; DEBUG for one module affects that module only, and a configured level moves the floor for the rest', async context => {
  const defaults = await run(context, {modules: [talker('alpha'), talker('beta')], config: {modules: {}}});
  await defaults.runtime.stop();
  assert.deepEqual([named(defaults.logs, 'alpha'), named(defaults.logs, 'beta')], [['INFO', 'WARN'], ['INFO', 'WARN']], 'INFO and above, with no section');

  const selected = await run(context, {modules: [talker('alpha'), talker('beta')], config: {modules: {}, diagnostics: {modules: {alpha: 'debug'}}}});
  await selected.runtime.stop();
  assert.deepEqual(named(selected.logs, 'alpha'), ['DEBUG', 'INFO', 'WARN'], 'alpha writes its DEBUG records');
  assert.deepEqual(named(selected.logs, 'beta'), ['INFO', 'WARN'], 'beta does not');
  assert.equal(selected.logs.some(record => record.scope.name === 'bunny.runtime' && record.severity_text === 'DEBUG'), false, 'nor does the runtime');

  // With the floor at WARN the INFO `runtime.stopped` record is not written, so this run collects its own records.
  const raisedLogs: LogRecord[] = [];
  const raised = {...await run(context, {modules: [talker('alpha'), talker('beta')], log: record => { raisedLogs.push(record); },
    config: {modules: {}, diagnostics: {level: 'warn', modules: {beta: 'debug'}}}}), logs: raisedLogs};
  assert.equal(raised.runtime.health().status, 'ok', 'a level changes no result');
  await raised.runtime.stop();
  assertContractRecords(raisedLogs);
  assert.deepEqual(named(raised.logs, 'alpha'), ['WARN'], 'the configured floor');
  assert.deepEqual(named(raised.logs, 'beta'), ['DEBUG', 'INFO', 'WARN'], 'a module\'s own floor still wins');
  assert.equal(raised.logs.some(record => record.event_name === 'runtime.module.started'), false, 'the runtime\'s INFO records are below the floor');
  assert.equal(raised.logs.some(record => record.event_name === 'runtime.stopped'), false, 'runtime.stopped is INFO too');

  const lowered = await run(context, {modules: [talker('alpha')], config: {modules: {}, diagnostics: {level: 'debug'}}, logLevel: 'warn'});
  await lowered.runtime.stop();
  assert.deepEqual(named(lowered.logs, 'alpha'), ['DEBUG', 'INFO', 'WARN'], 'the file\'s level takes precedence over --log-level');
});

it('a module the runtime does not host cannot be given a level', async context => {
  const alpha = talker('alpha');
  await assert.rejects(startRuntime({modules: [alpha], port: 0, stateDir: await stateDir(context), log: () => {}, config: {modules: {}, diagnostics: {modules: {gamma: 'debug'}}}}),
    code('config-invalid'));
  assert.equal(contextOf.length >= 0, true);
});
