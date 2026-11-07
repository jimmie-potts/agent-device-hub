import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectChecks, gateVerdict, noticeMessage, readNotice } from '../scripts/ci-selection/selection.mjs';

const presentation = ['apps/runtime/dashboard/src/music.css'];
const select = paths => selectChecks({ event: 'pull_request', paths, complete: true });

test('ordinary presentation keeps core consumers and admits without broad catalog jobs', () => {
  const result = select(presentation);
  assert.equal(result.mode, 'focused');
  assert.deepEqual(result.groups, ['runtime', 'maintenance']);
  // The runtime's unit and scenario suites keep running for presentation changes, in their own jobs since #1506.
  assert.deepEqual(result.jobs, { 'runtime-unit': true, 'runtime-scenarios': true, firmware: false, 'app-verify': false, 'runtime-verify': false });
});

test('safety, backend, shared and unknown changes retain broad coverage', () => {
  for (const path of ['apps/runtime/src/core/state.ts', 'modules/wemo/src/queue.ts',
    'apps/runtime/dashboard/src/credentials.ts', 'apps/runtime/dashboard/src/signin.ts',
    'apps/runtime/dashboard/src/actions.ts', 'apps/runtime/dashboard/src/attempts.ts',
    'apps/runtime/dashboard/src/connection.ts', 'apps/runtime/dashboard/src/device-controls.tsx',
    'apps/runtime/dashboard/src/new-display.css', 'modules/wemo/src/frontend/fresh-panel.tsx', 'packages/sdk/src/store.ts',
    'scripts/ci-selection/selection.mjs', '.github/workflows/checks.yml', 'AGENTS.md', 'docs/sdlc.md', 'docs/development.md', 'new-owner/code.ts']) {
    const result = select([...presentation, path]);
    assert.notEqual(result.mode, 'focused', path);
    assert.equal(result.jobs['app-verify'], true, path);
    assert.equal(result.jobs['runtime-verify'], true, path);
  }
  assert.equal(selectChecks({ event: 'release_qualification', paths: presentation, complete: true }).mode, 'full');
  assert.equal(selectChecks({ event: 'pull_request', paths: presentation, complete: false }).mode, 'full');
});

test('focused hosted evidence binds job decisions as well as core groups', () => {
  const result = select(presentation);
  const notice = readNotice(noticeMessage(result));
  assert.deepEqual(notice.jobs, result.jobs);
  assert.equal(readNotice(JSON.stringify({ mode: 'focused', groups: result.groups })), null);
});

test('focused gate rejects missing and failed core checks and mismatched job output', () => {
  const selection = select(presentation);
  const outputs = { mode: selection.mode, groups: JSON.stringify(selection.groups),
    ...Object.fromEntries(Object.entries(selection.jobs).map(([key, value]) => [key, String(value)])) };
  const needs = { select: { result: 'success', outputs }, core: { result: 'success' },
    'runtime-unit': { result: 'success' }, 'runtime-scenarios': { result: 'success' },
    firmware: { result: 'skipped' }, 'app-verify': { result: 'skipped' }, 'runtime-verify': { result: 'skipped' } };
  assert.equal(gateVerdict(needs).ok, true);
  for (const job of ['core', 'runtime-unit', 'runtime-scenarios']) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      assert.equal(gateVerdict({ ...needs, [job]: { result } }).ok, false, `${job}: ${result}`);
    }
  }
  const missing = { ...needs }; delete missing.core;
  assert.equal(gateVerdict(missing).ok, false);
  assert.equal(gateVerdict({ ...needs, select: { result: 'success', outputs: { ...outputs, 'app-verify': 'true' } } }).ok, false);
});

test('existing module presentation assets use their actual src/frontend paths', () => {
  for (const path of ['modules/wispr/src/frontend/wispr.css',
    'modules/reachy-mini/src/frontend/reachy.css', 'modules/nanoleaf/src/frontend/wall.css']) {
    const result = select([path]);
    assert.equal(result.mode, 'focused', path);
    assert.deepEqual(result.groups, ['runtime', 'maintenance', 'modules'], path);
    assert.equal(result.jobs['app-verify'], false, path);
    assert.equal(result.jobs['runtime-verify'], false, path);
    assert.equal(result.jobs['runtime-unit'], true, path);
    assert.equal(result.jobs['runtime-scenarios'], true, path);
  }
});
