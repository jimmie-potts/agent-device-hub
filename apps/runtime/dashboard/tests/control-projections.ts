// Bounded component checks for reply/event ordering and observed playback; no runtime or device.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import type {BrowserContext, Page} from 'playwright';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord, PlaybackState} from '@jimmie-potts/event-contracts/v2/families';

const unknown = {status: 'unknown'} as const;
const no = {supported: false} as const;
const device: DeviceRecord = {
  id: 'wall', kind: 'nanoleaf', revision: 4, configurationRevision: 3, generation: {epoch: 'wall-1', sequence: 2}, availability: 'available',
  capabilities: {power: {supported: true}, brightness: {supported: true, minimum: 0, maximum: 100}, modes: no, scenes: no, media: no, zones: no, moments: no, preview: no},
  desired: {power: {status: 'known', value: true}, brightness: unknown, mode: {status: 'known', value: 'free'}},
  observed: unknown, pending: 0, pendingKinds: [], lastOutcome: unknown, lastTransmission: unknown, externalControl: unknown,
};
type ProbeProps = {kind: 'device'; record: DeviceRecord; operations: OperationRecord[]} |
  {kind: 'placement'; operations: OperationRecord[]} |
  {kind: 'playback'; record: PlaybackState; control: boolean; live: boolean};
const render = async (page: Page, props: ProbeProps): Promise<void> => {
  await page.evaluate(input => {
    (window as unknown as {renderControlProbe: (value: ProbeProps) => void}).renderControlProbe(input);
  }, props);
};

export async function checkControlProjections(context: BrowserContext): Promise<void> {
  // Use the real components. The small entry only supplies props and commits renders synchronously.
  const bundle = await build({stdin: {contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import {flushSync} from 'react-dom';
    import {DeviceCard, PlaybackCard} from '../src/device-controls.tsx';
    import {useAttempt} from '../src/command-control.tsx';
    function PlacementProbe({operations}) {
      const command = useAttempt('playback', operations.filter(op => op.family === 'playback-layout-set'), true, undefined, 'core/playback-layout');
      return React.createElement(React.Fragment, null,
        React.createElement('button', {disabled: command.locked, onClick: () => command.run({family: 'playback-layout-set', target: 'playback', requestId: crypto.randomUUID(), data: {expectedRevision: 0, assignments: []}})}, 'Save placement'),
        React.createElement('p', {'data-placement-status': true}, command.text),
        React.createElement(PlaybackCard, {record: {id: 'playback', revision: 1, availability: 'available', playback: {status: 'known', player: 'playing', title: 'Collision fixture', controls: ['pause', 'next', 'previous']}}, live: true, control: true, operations, operationsLive: true}));
    }
    const root = createRoot(document.getElementById('root'));
    window.renderControlProbe = props => flushSync(() => root.render(React.createElement(
      props.kind === 'placement' ? PlacementProbe : props.kind === 'device' ? DeviceCard : PlaybackCard,
      {owner: 'bunny/modules/nanoleaf', live: true, control: true, operations: [], operationsLive: true,
       refresh: async () => {}, ...props})));
  `, resolveDir: fileURLToPath(new URL('.', import.meta.url)), sourcefile: 'control-projections-entry.js'},
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, loader: {'.css': 'empty'}, logLevel: 'silent'});
  assert.ok(bundle.outputFiles[0]);
  const javascript = bundle.outputFiles[0].text;
  const open = async (): Promise<Page> => {
    const page = await context.newPage(); page.setDefaultTimeout(5000);
    // Every request is fulfilled or aborted here. This origin never reaches a server.
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://controls.localhost') { await route.abort(); return; }
      if (url.pathname === '/bundle.js') await route.fulfill({contentType: 'text/javascript', body: javascript});
      else if (url.pathname === '/') await route.fulfill({contentType: 'text/html', body: '<!doctype html><html lang="en"><title>Control projection fixture</title><div id="root"></div><script type="module" src="/bundle.js"></script></html>'});
      else await route.abort();
    });
    await page.goto('http://controls.localhost/');
    await page.waitForFunction(() => 'renderControlProbe' in window);
    return page;
  };
  for (const response of ['accepted', 'uncertain'] as const) {
    const page = await open();
    let release = (): void => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    let receive = (_value: string): void => {};
    const arrived = new Promise<string>(resolve => { receive = resolve; });
    const requests: string[] = [];
    try {
      await page.route('**/api/v2/commands/power-set', async route => {
        const body: unknown = route.request().postDataJSON();
        assert.ok(typeof body === 'object' && body !== null && 'requestId' in body && typeof body.requestId === 'string');
        const requestId = body.requestId; requests.push(requestId);
        if (requests.length === 1) { receive(requestId); await gate; }
        await route.fulfill({status: 200, contentType: 'application/json', body: response === 'accepted'
          ? JSON.stringify({schema: 'command-reply/2.0', status: 'accepted', requestId}) : '{}'});
      });
      await render(page, {kind: 'device', record: device, operations: []});
      const card = page.locator('[data-device="wall"]');
      const button = card.getByRole('button', {name: 'Turn off', exact: true});
      await button.click();
      const requestId = await arrived;
      const completed: OperationRecord = {
        id: '1'.repeat(64), revision: 9, requestId, kind: 'device', family: 'power-set', command: 'power-set', target: 'wall',
        requestedBy: 'bunny/parts/dashboard', status: 'completed', result: 'succeeded', evidence: 'transmitted', sentAtMs: 1, updatedAtMs: 2, deadlineAtMs: 50,
      };
      await render(page, {kind: 'device', record: device, operations: [completed]});
      await page.waitForFunction(() => sessionStorage.getItem('bunny-device-attempts') === '[]');
      release();
      await page.waitForFunction(() => document.querySelector('fieldset')?.disabled === false);
      // Retire the projection only after the delayed reply has settled, without a replacement event.
      await render(page, {kind: 'device', record: device, operations: []});
      assert.match(await card.locator('p[role="status"]').innerText(), /Completed: succeeded.*physical effect was not observed/, `${response} reply cannot erase completion`);
      assert.equal(await button.isDisabled(), false, 'retirement retains definitive evidence');
      assert.equal(await card.locator('output').innerText(), 'Unknown');
      await button.click();
      await card.locator('p[role="status"]').filter({hasText: response === 'accepted' ? 'Accepted. Waiting for completion.' : 'Uncertain result.'}).waitFor();
      assert.equal(await button.isDisabled(), true, 'a new unresolved request keeps its own lock');
      await card.getByRole('button', {name: 'Refresh current state'}).click();
      assert.equal(await button.isDisabled(), true);
      assert.equal(requests.length, 2, 'neither completion retirement nor refresh replays a command');
      assert.notEqual(requests[0], requests[1]);
    } finally { release(); await page.close(); }
  }
  const page = await open();
  try {
    let revision = 0;
    for (const control of [true, false]) {
      for (const player of ['playing', 'paused', 'stopped', 'inactive', 'unknown'] as const) {
        await render(page, {kind: 'playback', control, live: true, record: {id: 'music', revision: ++revision, availability: 'available',
          playback: {status: 'known', player, title: 'Same title', artist: 'Same artist', album: 'Same album', controls: ['play', 'pause']}}});
        const card = page.getByRole('article', {name: 'Music music'});
        assert.equal(await card.getByText('Same title', {exact: true}).count(), 1);
        assert.equal(await card.locator('.music-heading').getByText(player.charAt(0).toUpperCase() + player.slice(1), {exact: true}).count(), 1);
        assert.equal(await card.locator('fieldset button').count(), 3);
        assert.equal(await card.getByRole('button', {name: player === 'playing' ? 'Pause' : 'Play', exact: true}).isEnabled(), control);
      }
    }
    await render(page, {kind: 'playback', control: false, live: true, record: {id: 'music', revision: ++revision, availability: 'available', playback: unknown}});
    await page.getByText('Playback unknown', {exact: true}).waitFor();
    await render(page, {kind: 'playback', control: false, live: false, record: {id: 'music', revision: ++revision, availability: 'unavailable', playback: unknown}});
    await page.getByText('Playback unavailable', {exact: true}).waitFor();
  } finally { await page.close(); }
  const collision = await open();
  try {
    const requests: {requestId: string; family: string}[] = [];
    await collision.route('**/api/v2/commands/*', async route => {
      const body = route.request().postDataJSON() as {requestId: string};
      requests.push({requestId: body.requestId, family: new URL(route.request().url()).pathname.split('/').at(-1) ?? ''});
      await route.fulfill({status: 200, contentType: 'application/json', body: '{}'});
    });
    await render(collision, {kind: 'placement', operations: []});
    const save = collision.getByRole('button', {name: 'Save placement', exact: true});
    const pause = collision.getByRole('button', {name: 'Pause', exact: true});
    await save.click(); await collision.locator('[data-placement-status]').filter({hasText: /Uncertain/}).waitFor();
    assert.equal(await pause.isEnabled(), true, 'a layout save cannot alias a configured playback ID');
    await pause.click(); await collision.getByRole('status').filter({hasText: /Uncertain/}).waitFor();
    assert.equal(requests.length, 2);
    await collision.reload(); await collision.waitForFunction(() => 'renderControlProbe' in window);
    await render(collision, {kind: 'placement', operations: []});
    assert.equal(await save.isDisabled(), true); assert.equal(await pause.isDisabled(), true);
    assert.equal(requests.length, 2, 'neither retained identity is replayed on reload');
    const layoutRequest = requests.find(request => request.family === 'playback-layout-set'); assert.ok(layoutRequest);
    await render(collision, {kind: 'placement', operations: [{id: '2'.repeat(64), revision: 2, requestId: layoutRequest.requestId, kind: 'device', family: 'playback-layout-set',
      command: 'org.bunny.playback-layout.set.requested', target: 'playback', requestedBy: 'bunny/parts/dashboard', status: 'completed', result: 'succeeded', evidence: 'observed', sentAtMs: 1, updatedAtMs: 2, deadlineAtMs: 50}]});
    assert.equal(await save.isEnabled(), true); assert.equal(await pause.isDisabled(), true, 'layout completion never unlocks unresolved playback');
  } finally {await collision.close();}
  console.log(JSON.stringify({journey: 'control-projections', lateReplies: ['accepted', 'uncertain'], completionSurvivesRetirement: true, unresolvedLocked: true, replayed: 0, sameTitlePlaybackStates: 5, readOnly: true}));
}
