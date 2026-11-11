// Which tracked outcomes open a shared inbox item (Hub #1657, owner decisions D1 and D3). The open rule and Send again
// read one predicate, so an item never opens for an operation whose only possible handling is Dismiss.
import assert from 'node:assert/strict';
import {DEADLINES, historyOnly, resendRefusal, type Operation} from '../src/index.js';
import {it} from './support.js';

const DASHBOARD = 'bunny/parts/dashboard', CORE = 'bunny/core', COMPANIONS = 'bunny/modules/companions';
const AT = 1_000_000;
const operation = (family: string, overrides: Partial<Operation> = {}): Operation => ({
  requestId: `req-${family}`, kind: 'device', key: `bunny.cmd.${family}.target`, family, command: `org.bunny.${family.replace(/-/g, '.')}.requested`,
  dataschema: `https://bunny.invalid/events/${family}/2.0`, target: 'target', data: {}, requestedBy: DASHBOARD,
  status: 'sent', outcomes: [], sentAtMs: AT, deadlineAtMs: AT + DEADLINES.device.outcomeMs, updatedAtMs: AT,
  traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01', ...overrides,
});
/** A rejected reply: the owner refused the command before acting, so it left no effect and holds nothing. */
const refused = (family: string, code: string, overrides: Partial<Operation> = {}): Operation => operation(family, {
  status: 'rejected', result: 'failed', evidence: 'none', reply: code, error: {code: code as 'invalid-state', retryable: false, requestId: `req-${family}`}, ...overrides,
});
const uncertain = (family: string, overrides: Partial<Operation> = {}): Operation => operation(family, {
  status: 'uncertain', result: 'uncertain', evidence: 'none', error: {code: 'uncertain-result', retryable: false, requestId: `req-${family}`}, ...overrides,
});
const ART = {compositionId: 'c'.repeat(64)};

it('a refusal the dashboard could never send again stays in history only', () => {
  const dismissOnly: [string, Operation][] = [
    ['an art-plan moment refused by a display holding a pin', refused('moment-play', 'invalid-state', {requestedBy: CORE, data: {momentId: 'm', art: ART}})],
    ['core-dispatched Music lighting work refused', refused('music-lighting-work', 'invalid-state', {requestedBy: CORE})],
    ['a companion speech line refused', refused('companion-speech-play', 'unavailable', {requestedBy: COMPANIONS})],
    ['a MicroDuck command refused', refused('microduck-auto', 'invalid-state', {command: 'org.bunny.microduck.auto.requested', requestedBy: 'bunny/modules/microduck'})],
    ['an omitted ONN text refused', refused('onn-text', 'invalid-state', {payload: {status: 'omitted', hmac: 'h'}})],
    ['an owner mode change refused for a stale revision', refused('mode-set', 'revision-conflict', {data: {mode: 'quiet', expectedRevision: 4}})],
    ['an assistant mode change refused for a stale revision', refused('mode-set', 'revision-conflict', {requestedBy: COMPANIONS, data: {mode: 'quiet', expectedRevision: 4}})],
  ];
  for (const [name, each] of dismissOnly) {
    assert.ok(resendRefusal(each, DASHBOARD) !== undefined, `Send again refuses ${name}`);
    assert.equal(historyOnly(each), true, `${name} opens no item`);
  }
});

it('an unconfirmed companion speech line stays in history only; its definitive failure still opens an item', () => {
  assert.equal(historyOnly(uncertain('companion-speech-play', {requestedBy: COMPANIONS})), true);
  assert.equal(historyOnly(operation('companion-speech-play', {requestedBy: COMPANIONS, status: 'completed', result: 'uncertain', evidence: 'none'})), true);
  assert.equal(historyOnly(operation('companion-speech-play', {requestedBy: COMPANIONS, status: 'completed', result: 'failed', evidence: 'transmitted',
    error: {code: 'unavailable', retryable: true}})), false, 'a failure after acceptance is not a refusal');
});

it('every other failed, uncertain or conflicting outcome still opens an item', () => {
  const kept: [string, Operation][] = [
    ['an uncertain device write that may set a hold', uncertain('power-set')],
    ['an uncertain mode change', uncertain('mode-set', {kind: 'mode', data: {mode: 'quiet', expectedRevision: 4}})],
    ['an uncertain art-plan moment', uncertain('moment-play', {requestedBy: CORE, data: {art: ART}})],
    ['a conflicting result', operation('music-lighting-work', {requestedBy: CORE, status: 'conflict', result: 'conflict', evidence: 'observed'})],
    ['a failure after acceptance', operation('music-lighting-work', {requestedBy: CORE, status: 'completed', result: 'failed', evidence: 'none', error: {code: 'cancelled', retryable: false}})],
    ['a dashboard media start the dashboard can send again', refused('media-start', 'invalid-state')],
    ['an automation moment without art', refused('moment-play', 'invalid-state', {requestedBy: CORE, data: {momentId: 'm'}})],
    ['an owner art request', refused('art-request', 'unavailable')],
    ['a mode change refused for another reason', refused('mode-set', 'capacity', {data: {mode: 'quiet', expectedRevision: 4}})],
    ['a mode change with no saved revision', refused('mode-set', 'revision-conflict', {data: {mode: 'quiet'}})],
    // A late outcome keeps the operation `rejected` (operations.ts) but contradicts the refusal.
    ['a refused art moment that later reports an uncertain outcome', refused('moment-play', 'invalid-state', {requestedBy: CORE, data: {art: ART},
      outcomes: [{source: 'bunny/modules/pixoo', id: 'late', result: 'uncertain', evidence: 'transmitted', atMs: AT + 10}]})],
    ['a refused lighting work that later reports a failure', refused('music-lighting-work', 'invalid-state', {requestedBy: CORE,
      outcomes: [{source: 'bunny/modules/nanoleaf', id: 'late', result: 'failed', evidence: 'none', atMs: AT + 10}]})],
    ['a command that expired before its owner took it', operation('microduck-auto', {status: 'expired', result: 'failed', evidence: 'none', reply: 'expired',
      command: 'org.bunny.microduck.auto.requested', error: {code: 'expired', retryable: true}})],
  ];
  for (const [name, each] of kept) assert.equal(historyOnly(each), false, `${name} opens an item`);
});

it('Send again judges the handler: an owner art request is the dashboard\'s alone', () => {
  const request = refused('art-request', 'unavailable');
  assert.equal(resendRefusal(request, DASHBOARD), undefined);
  assert.equal(resendRefusal(request, 'bunny/parts/operator')?.error.code, 'forbidden');
  assert.equal(resendRefusal(refused('power-set', 'unavailable'), 'bunny/parts/operator'), undefined);
});
