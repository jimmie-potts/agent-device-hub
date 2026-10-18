// The code table owns log levels (ADR 0012 amendment of 2026-10-17, Hub #1143).
import assert from 'node:assert/strict';
import {levelOf, recordLevel, recordLog, type Logger} from '../src/index.js';
import {it} from './support.js';

function recorder(): {log: Logger; records: [string, string, Readonly<Record<string, unknown>> | undefined][]} {
  const records: [string, string, Readonly<Record<string, unknown>> | undefined][] = [];
  const at = (level: string) => (event: string, fields?: Readonly<Record<string, string | number | boolean>>) => { records.push([level, event, fields]); };
  return {log: {debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error')}, records};
}

it('levelOf gives registry codes and non-registry events their table level', () => {
  assert.equal(levelOf('invalid-request'), 'info');
  assert.equal(levelOf('internal'), 'error');
  assert.equal(levelOf('operation.completed'), 'info');
  assert.equal(levelOf('operation.failed'), 'warn');
  assert.equal(levelOf('runtime.module.failed'), 'error');
  assert.equal(levelOf('sync.restarted'), 'debug');
});

it('recordLog takes the level from the record code, else from its event', () => {
  const {log, records} = recorder();
  // Hub #1074 285-F3: an ordinary artwork refusal is INFO, not an unconditional WARN.
  recordLog(log, 'operation.failed', {'bunny.operation': 'playback', 'bunny.code': 'invalid-request'});
  recordLog(log, 'operation.failed', {'bunny.code': 'internal'});
  recordLog(log, 'operation.failed', {'bunny.operation': 'startup'});
  recordLog(log, 'operation.completed', {'bunny.outcome': 'succeeded'});
  recordLog(log, 'command.completed', {'bunny.code': 'not-a-code'});
  assert.deepEqual(records.map(([level, event]) => `${level} ${event}`),
    ['info operation.failed', 'error operation.failed', 'warn operation.failed', 'info operation.completed', 'info command.completed']);
});

it('an event outside the table cannot be recorded', () => {
  const {log} = recorder();
  const forbidden = (): void => {
    // @ts-expect-error a new event needs a level in the table first.
    recordLog(log, 'assistant.unknown');
    // @ts-expect-error levelOf takes only registry codes and table events.
    levelOf('warn');
  };
  assert.equal(typeof forbidden, 'function');
});

it('a failed or uncertain outcome is at least WARN, with or without a code (ADR 0012)', () => {
  assert.equal(recordLevel('command.completed', {'bunny.outcome': 'failed'}), 'warn');
  assert.equal(recordLevel('command.completed', {'bunny.outcome': 'uncertain'}), 'warn');
  assert.equal(recordLevel('command.completed', {'bunny.outcome': 'failed', 'bunny.code': 'internal'}), 'error');
  assert.equal(recordLevel('command.completed', {'bunny.outcome': 'failed', 'bunny.code': 'invalid-request'}), 'warn');
  assert.equal(recordLevel('command.completed', {'bunny.outcome': 'duplicate'}), 'info');
  assert.equal(recordLevel('runtime.edge.refused', {'bunny.code': 'internal'}), 'error');
  assert.equal(recordLevel('runtime.edge.refused', {'bunny.code': 'forbidden'}), 'warn');
});
