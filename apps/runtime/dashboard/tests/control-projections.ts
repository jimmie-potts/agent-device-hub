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
    const root = createRoot(document.getElementById('root'));
    window.renderControlProbe = props => flushSync(() => root.render(React.createElement(
      props.kind === 'device' ? DeviceCard : PlaybackCard,
      {owner: 'bunny/modules/nanoleaf', live: true, control: true, operations: [], operationsLive: true,
       refresh: async () => {}, ...props})));
  `, resolveDir: fileURLToPath(new URL('.', import.meta.url)), sourcefile: 'control-projections-entry.js'},
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, logLevel: 'silent'});
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
        assert.equal(await card.locator('dt').filter({hasText: 'Observed status'}).locator('..').locator('dd').innerText(), player.charAt(0).toUpperCase() + player.slice(1));
        assert.equal(await card.getByRole('button').count(), control ? 2 : 0);
      }
    }
    await render(page, {kind: 'playback', control: false, live: true, record: {id: 'music', revision: ++revision, availability: 'available', playback: unknown}});
    await page.getByText('Playback unknown', {exact: true}).waitFor();
    await render(page, {kind: 'playback', control: false, live: false, record: {id: 'music', revision: ++revision, availability: 'unavailable', playback: unknown}});
    await page.getByText('Playback unavailable', {exact: true}).waitFor();
  } finally { await page.close(); }
  console.log(JSON.stringify({journey: 'control-projections', lateReplies: ['accepted', 'uncertain'], completionSurvivesRetirement: true, unresolvedLocked: true, replayed: 0, sameTitlePlaybackStates: 5, readOnly: true}));
}
