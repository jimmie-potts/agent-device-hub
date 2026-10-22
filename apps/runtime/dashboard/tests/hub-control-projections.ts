// Real adapters with controlled copies/replies: inspect race states without timers or live services.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import type {BrowserContext, Route} from 'playwright';
import type {InboxItem, ModeState, OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {modeChildRequestId} from '../../src/core/mode-participants.ts';

type Props = {record: ModeState; operations: OperationRecord[]; items: InboxItem[]; live: boolean; operationsSynced: boolean; inboxSynced: boolean; control: boolean};

export async function checkHubCardProjections(context: BrowserContext): Promise<void> {
  const bundle = await build({stdin: {contents: `
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {HubMode} from '../src/hub-mode.tsx'; import {InboxPanel} from '../src/inbox.tsx';
    function Probe(props){const [focus,setFocus]=useState();return React.createElement(React.Fragment,null,
      React.createElement(HubMode,{...props,onCheckInbox:id=>setFocus(previous=>({id,serial:(previous?.serial??0)+1}))}),
      React.createElement(InboxPanel,{items:props.items,live:props.live&&props.inboxSynced,control:props.control,focus}));}
    const root=createRoot(document.getElementById('root'));window.renderHubControls=props=>flushSync(()=>root.render(React.createElement(Probe,props)));
  `, resolveDir: fileURLToPath(new URL('.', import.meta.url)), sourcefile: 'hub-controls-entry.js'}, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', loader: {'.css': 'empty'}, logLevel: 'silent'});
  assert.ok(bundle.outputFiles[0]);
  const javascript = bundle.outputFiles[0].text, page = await context.newPage(); page.setDefaultTimeout(5000);
  const commands: {family: string; data: {expectedRevision: number}; requestId: string}[] = [];
  let held: Route | undefined;
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== 'http://hub-controls.localhost') {await route.abort(); return;}
    if (url.pathname === '/') {await route.fulfill({contentType: 'text/html', body: '<main id="root"></main><script type="module" src="/probe.js"></script>'}); return;}
    if (url.pathname === '/probe.js') {await route.fulfill({contentType: 'application/javascript', body: javascript}); return;}
    if (url.pathname.startsWith('/api/v2/commands/')) {
      const data = request.postDataJSON() as {data: {expectedRevision: number}; requestId: string};
      commands.push({family: url.pathname.split('/').at(-1) ?? '', ...data}); held = route; return;
    }
    await route.abort();
  });
  const render = async (props: Props): Promise<void> => {
    await page.evaluate(value => {(window as unknown as {renderHubControls: (props: Props) => void}).renderHubControls(value);}, props);
  };
  try {
    await page.goto('http://hub-controls.localhost/');
    await page.waitForFunction(() => typeof (window as unknown as {renderHubControls?: unknown}).renderHubControls === 'function');
    const parent: OperationRecord = {id: 'parent', requestId: 'mode-one', revision: 1, kind: 'mode', family: 'mode-set', command: 'org.bunny.mode.set.requested', target: 'hub', requestedBy: 'bunny/parts/dashboard', status: 'completed', result: 'succeeded', evidence: 'observed', sentAtMs: 1, updatedAtMs: 1, deadlineAtMs: 1000};
    const child: OperationRecord = {...parent, id: 'child', requestId: await modeChildRequestId(parent.requestId, 'wall'), family: 'device-mode-set', command: 'org.bunny.device-mode.set.requested', target: 'wall', requestedBy: 'bunny/core', result: 'failed', evidence: 'none'};
    const item: InboxItem = {id: 'issue', revision: 2, createdAtMs: 1, dismissedBy: [], item: {kind: 'operation', requestId: child.requestId, target: 'wall', command: child.command, result: 'failed', evidence: 'none'}};
    const props: Props = {record: {id: 'hub', mode: 'work', revision: 3, selectedAtMs: 1}, operations: [parent, child], items: [item], live: true, operationsSynced: true, inboxSynced: true, control: true};
    const warning = page.getByRole('button', {name: 'Check Inbox', exact: true});
    await render({...props, operations: []}); await warning.waitFor();
    await page.getByRole('status').filter({hasText: 'Its link to a Hub selection is unavailable'}).waitFor();
    assert.match(await warning.getAttribute('title') ?? '', /unavailable/);
    await page.reload();
    await page.waitForFunction(() => typeof (window as unknown as {renderHubControls?: unknown}).renderHubControls === 'function');
    await render({...props, operations: []}); await warning.waitFor();
    assert.equal(commands.length, 0, 'a fresh mount with retired evidence retains review without sending');
    await render(props); await warning.waitFor(); assert.equal(commands.length, 0);
    await render({...props, live: false, operationsSynced: false, inboxSynced: false});
    assert.equal(await warning.count(), 1, 'stale copies retain the warning');
    assert.equal(await page.getByRole('button', {name: 'Work', exact: true}).isDisabled(), true);
    await render(props); await warning.click();
    assert.equal(commands.length, 0, 'inspection sends no command');
    await page.getByRole('button', {name: 'Dismiss', exact: true}).click();
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('.inbox-item button')?.disabled === true);
    assert.equal(commands.length, 1); assert.equal(commands[0]?.data.expectedRevision, 2); assert.ok(held);
    await held.fulfill({contentType: 'application/json', body: JSON.stringify({schema: 'command-reply/2.0', status: 'accepted', requestId: commands[0]?.requestId})});
    await page.getByText('Accepted. Waiting for the shared item removal.', {exact: true}).waitFor();
    assert.equal(await page.getByRole('button', {name: 'Dismiss', exact: true}).isDisabled(), true);
    assert.equal(await warning.count(), 1, 'accepted handling is not synced removal');
    await render({...props, items: []}); await warning.waitFor({state: 'detached'});
    await render({...props, items: [{...item, revision: 4}]}); await warning.waitFor(); await warning.click();
    await page.getByRole('button', {name: 'Send again', exact: true}).click();
    await page.waitForFunction(() => document.querySelector<HTMLButtonElement>('.inbox-item button')?.disabled === true);
    assert.equal(commands.length, 2);
    await held.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: {code: 'uncertain-result', retryable: false, requestId: commands[1]?.requestId}})});
    await page.getByRole('status').filter({hasText: 'uncertain-result.'}).waitFor();
    await render({...props, items: [{...item, revision: 4}]});
    assert.equal(await page.getByRole('button', {name: 'Send again', exact: true}).isDisabled(), true);
    assert.equal(commands.length, 2, 'resync does not retry an uncertain action');
    await render({...props, control: false}); assert.equal(await page.locator('.inbox-item button').count(), 0);
    assert.equal(await page.getByRole('button', {name: 'Work', exact: true}).isDisabled(), true);
  } finally {await page.close();}
}
