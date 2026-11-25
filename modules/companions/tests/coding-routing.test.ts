import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {CodingHarnessReadiness, CodingLimitWindow} from '@jimmie-potts/event-contracts/v2/coding';
import {chooseCodingHarness} from '../src/coding/routing.js';

const health = (harness: string, limits: CodingLimitWindow[] | null = null): CodingHarnessReadiness => ({
  harness, installed: 'yes', signedIn: 'yes', version: '1.0', plan: 'plus', limits, limitsObservedAtMs: null, checkedAtMs: 1,
  capabilities: {steering: 'unsupported', resume: 'unsupported', review: true},
});
const exhausted = (resetsAtMs: number | null): CodingLimitWindow[] => [{window: 'primary', status: 'rejected', resetsAtMs, utilization: null}];

void test('Auto preserves the uncertainty of quotas and uses the other eligible subscription', () => {
  assert.deepEqual(chooseCodingHarness('auto', [health('claude-code', exhausted(null)), health('codex')], 100),
    {harness: 'codex', reason: 'Claude Code quota exhausted (reset unknown). Codex quota unknown.'});
  assert.deepEqual(chooseCodingHarness('auto', [health('claude-code'), health('codex', exhausted(200))], 100),
    {harness: 'claude-code', reason: 'Preferred Claude Code selected. Claude Code quota unknown.'});
  assert.match(chooseCodingHarness('auto', [health('claude-code', exhausted(null)), health('codex', exhausted(200))], 100).reason,
    /Claude Code quota exhausted \(reset unknown\).*Codex quota exhausted/);
});

void test('pinning a harness never falls back and an elapsed reset does not assert quota availability', () => {
  assert.deepEqual(chooseCodingHarness('codex', [health('claude-code')], 100), {reason: 'Codex is not advertised.'});
  assert.deepEqual(chooseCodingHarness('claude-code', [health('claude-code', exhausted(50)), health('codex')], 100),
    {harness: 'claude-code', reason: 'Claude Code selected explicitly. Claude Code quota unknown.'});
});
