// Hub #1015: source evidence catches the forbidden inspection without ever executing it.
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {checkPrivateState} from '../boundaries.js';
import {ChildHome, HOME_REPORT, MAX_HOME_BYTES, homeReport} from '../home.js';

const PRIVATE_HOME = '/synthetic/1015/run/home';
const privateState = (observation: ChildHome): string => checkPrivateState({
  runtime: 'fixtures', simulate: true, dataDir: '/synthetic/1015/run', home: observation.value, defaultState: false,
  stateFiles: [], grantsMode: 0o600, outbound: [],
}).outcome;

const VERIFY_SOURCE = fileURLToPath(new URL('../../../verify/', import.meta.url));
/** Detect the process-environment file name in source, including a template-literal path. */
const inspectsProcessEnvironment = (source: string): boolean => /\/environ\b/.test(source);

void test('runtime verification never inspects a process environment file', () => {
  for (const file of readdirSync(VERIFY_SOURCE, {recursive: true}).map(String).filter(file => file.endsWith('.ts') && !file.startsWith('tests/'))) {
    assert.equal(inspectsProcessEnvironment(readFileSync(join(VERIFY_SOURCE, file), 'utf8')), false, file);
  }
  // An inert string is the negative control; no process-environment file is opened.
  assert.equal(inspectsProcessEnvironment('readFileSync(`/proc/${pid}/environ`, "utf8")'), true);
});

void test('a HOME observation needs the current child and generation, and resets on every spawn', async () => {
  const observation = new ChildHome();
  const first = {}, second = {};
  observation.reset(first, 1);
  assert.equal(observation.value, '');
  assert.equal(observation.hear(first, 1, homeReport(PRIVATE_HOME)), true);
  await observation.settle(5);
  assert.equal(privateState(observation), 'passed');
  observation.reset(second, 2);
  assert.equal(observation.value, '', 'a new generation cannot inherit its old home');
  observation.hear(first, 2, homeReport(PRIVATE_HOME));
  observation.hear(second, 1, homeReport(PRIVATE_HOME));
  observation.hear(first, 1, homeReport(PRIVATE_HOME));
  await observation.settle(5);
  assert.equal(privateState(observation), 'failed', 'an old child or generation is not evidence');
  observation.hear(second, 2, homeReport(PRIVATE_HOME));
  assert.equal(privateState(observation), 'passed');
});

void test('missing, malformed and outside-run HOME reports keep private-state failing', async () => {
  const child = {};
  const observation = new ChildHome();
  const invalid: unknown[] = [
    null, [], {}, {type: HOME_REPORT}, {type: HOME_REPORT, home: 1}, {type: HOME_REPORT, home: PRIVATE_HOME, other: 'synthetic'},
    {type: HOME_REPORT, home: ''}, {type: HOME_REPORT, home: 'relative'}, {type: HOME_REPORT, home: '/synthetic/1015/outside'},
    {type: HOME_REPORT, home: `${PRIVATE_HOME}/../../outside`}, {type: HOME_REPORT, home: `${PRIVATE_HOME}\n`},
    {type: HOME_REPORT, home: `${PRIVATE_HOME}\0`}, {type: HOME_REPORT, home: `/${'x'.repeat(MAX_HOME_BYTES)}`},
    {type: HOME_REPORT, home: `/${'é'.repeat(MAX_HOME_BYTES / 2)}`},
  ];
  for (const report of invalid) {
    observation.reset(child, 1);
    observation.hear(child, 1, report);
    assert.equal(privateState(observation), 'failed');
  }
  observation.reset(child, 2);
  await observation.settle(5);
  assert.equal(observation.value, '', 'a deadline does not invent the launch HOME');
  assert.equal(privateState(observation), 'failed');
  assert.equal(observation.hear(child, 2, {type: 'device.reply'}), false, 'unrelated IPC stays with its owner');
});

void test('the HOME payload contains exactly one bounded selected field and no other environment data', () => {
  assert.deepEqual(homeReport(PRIVATE_HOME), {type: HOME_REPORT, home: PRIVATE_HOME});
  for (const value of [undefined, '', 'relative', `/a/../b`, `/a\n`, `/a\0`, `/${'é'.repeat(MAX_HOME_BYTES / 2)}`]) {
    assert.deepEqual(homeReport(value), {type: HOME_REPORT, home: ''});
  }
  const bounded = `/${'x'.repeat(MAX_HOME_BYTES - 1)}`;
  assert.equal(homeReport(bounded).home, bounded);
});

void test('startup observation handles a report arriving after readiness without retaining a timer', async () => {
  const child = {};
  const observation = new ChildHome();
  observation.reset(child, 1);
  const waiting = observation.settle(1000);
  observation.hear(child, 1, homeReport(PRIVATE_HOME));
  await waiting;
  assert.equal(privateState(observation), 'passed');
});
