import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import type { BrowserContext, Page } from 'playwright';
import { emptyStatus, UNKNOWN, type CollectionGap, type RunRecord, type RunsPage, type SamplesPage, type VacuumStatus, type Value, } from '../../../../modules/roborock/src/contracts.ts';
const ROOT = '/modules/roborock/content/';
type Command = {
    type: 'mount';
    owner: string;
} | {
    type: 'unmount';
} | {
    type: 'sync';
    owner: string;
    doc: VacuumStatus;
} | {
    type: 'update';
    owner: string;
    doc: VacuumStatus;
} | {
    type: 'failure';
    owner: string;
} | {
    type: 'read';
    owner: string;
    path: string;
    value: unknown;
    latest?: boolean;
} | {
    type: 'now';
    at: number;
};
type Stats = Record<string, {
    syncs: number;
    closes: number;
    reads: string[];
}>;
type Probe = {
    send(command: Command): void;
    stats(): Stats;
};
async function settle(page: Page): Promise<void> {
    await page.evaluate(() => new Promise<void>(resolve => {
        requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); });
    }));
}
async function send(page: Page, command: Command): Promise<void> {
    await page.evaluate(value => {
        (window as unknown as {
            roborockProbe: Probe;
        }).roborockProbe.send(value);
    }, command);
    await settle(page);
}
async function stats(page: Page): Promise<Stats> {
    return page.evaluate(() => (window as unknown as {
        roborockProbe: Probe;
    }).roborockProbe.stats());
}
function status(id: string, battery = 11, observedAtMs: Value<number> = UNKNOWN): VacuumStatus {
    const doc = emptyStatus(id);
    doc.revision = 1;
    doc.availability = 'available';
    doc.activity = 'other';
    doc.observedAtMs = observedAtMs;
    doc.status.batteryPercent = { status: 'known', value: battery };
    return doc;
}
function run(id: number): RunRecord {
    return {
        recordId: id, observedAtMs: id * 1000 + 10000,
        startAtMs: id * 1000, endAtMs: { status: 'known', value: id * 1000 + 7000 },
        durationSeconds: { status: 'known', value: 4 },
        areaMm2: { status: 'known', value: 12000000 }, cleanedAreaMm2: UNKNOWN,
        errorCode: UNKNOWN, complete: UNKNOWN, startType: UNKNOWN,
        cleanType: UNKNOWN, finishReason: UNKNOWN, avoidCount: UNKNOWN, washCount: UNKNOWN,
        battery: { availability: 'partial', samples: 6, clock: 'unqualified' },
        map: { availability: 'unverified', reason: 'candidate-window' },
    };
}
function runs(id: string, ids = [100, 200], next: Value<string> = UNKNOWN): RunsPage {
    return {
        schema: 'roborock-runs/2.0', id, revision: 1, history: 'partial',
        runs: ids.map(run), next,
    };
}
function samples(id: string, selected: number, gaps: CollectionGap[] = [], next: Value<string> = UNKNOWN): SamplesPage {
    return {
        schema: 'roborock-samples/2.0', id, revision: 1, recordId: selected,
        clock: 'unqualified', gaps, next,
        samples: Array.from({ length: 6 }, (_, index) => ({
            observationId: `sample-${index + 1}`,
            observedAtMs: selected * 1000 + (index + 1) * 1000,
            batteryPercent: 90 - index * 5,
        })),
    };
}
async function ready(page: Page, owner: string, doc: VacuumStatus, list = runs(doc.id)): Promise<void> {
    await send(page, { type: 'mount', owner });
    await send(page, { type: 'sync', owner, doc });
    await send(page, { type: 'read', owner, path: `${ROOT}status`, value: doc });
    await send(page, { type: 'read', owner, path: `${ROOT}runs?limit=25`, value: list });
}
async function resolveDetail(page: Page, owner: string, id: string, selected: number): Promise<void> {
    await send(page, {
        type: 'read', owner, path: `${ROOT}run?recordId=${selected}`,
        value: { schema: 'roborock-run/2.0', id, revision: 1, run: run(selected) },
    });
}
async function topology(page: Page): Promise<{
    circles: string[];
    lines: string[][];
}> {
    return page.locator('[aria-label="Battery evidence"] svg').evaluate(svg => ({
        circles: [...svg.querySelectorAll('circle')].map(circle => `${circle.getAttribute('cx')},${circle.getAttribute('cy')}`),
        lines: [...svg.querySelectorAll('polyline')].map(line => (line.getAttribute('points') ?? '').split(' ').filter(point => point.length > 0)),
    }));
}
export async function checkRoborockFrontend(context: BrowserContext): Promise<void> {
    const bundle = await build({
        stdin: {
            resolveDir: fileURLToPath(new URL('.', import.meta.url)),
            sourcefile: 'roborock-frontend-probe.js',
            contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {flushSync} from 'react-dom';
        import {frontend} from '../../../../modules/roborock/src/frontend/index.tsx';
        const Component = frontend.pages.find(page => page.id === 'status')?.Component;
        if (frontend.module !== 'roborock' || Component === undefined) throw new Error('Wrong contribution');
        const root = createRoot(document.getElementById('root'));
        const owners = new Map();
        let now = 10000;
        Date.now = () => now;
        function owner(name) {
          let value = owners.get(name);
          if (value !== undefined) return value;
          value = {syncs: 0, closes: 0, reads: [], pendingReads: [], pendingSyncs: [], changed: undefined};
          value.api = {
            read(path) {
              value.reads.push(path);
              return new Promise(resolve => value.pendingReads.push({path, resolve}));
            },
            sync(families, changed) {
              if (JSON.stringify(families) !== '["roborock-vacuum"]') throw new Error('Wrong families');
              value.syncs++;
              value.changed = changed;
              return new Promise(resolve => value.pendingSyncs.push(resolve));
            },
            command() {throw new Error('Unexpected command');},
            upload() {throw new Error('Unexpected upload');},
            image() {throw new Error('Unexpected image');}
          };
          owners.set(name, value);
          return value;
        }
        function message(doc) {
          const times = [doc.observedAtMs, doc.consumables.observedAtMs, doc.totals.observedAtMs]
            .filter(value => value.status === 'known').map(value => value.value);
          return {
            specversion: '1.0', bunnyprofile: '2.0', id: 'synthetic-message',
            source: 'bunny/modules/roborock', type: 'org.bunny.roborock-vacuum.updated',
            subject: doc.id, time: new Date(Math.max(now, ...times)).toISOString(), kind: 'state',
            datacontenttype: 'application/json',
            dataschema: 'https://bunny.invalid/events/roborock-vacuum/2.0',
            traceparent: '00-11111111111111111111111111111111-1111111111111111-01', data: doc
          };
        }
        window.roborockProbe = {
          stats() {
            return Object.fromEntries([...owners].map(([name, value]) =>
              [name, {syncs: value.syncs, closes: value.closes, reads: [...value.reads]}]));
          },
          send(command) {
            if (command.type === 'now') {now = command.at; return;}
            if (command.type === 'unmount') {flushSync(() => root.render(null)); return;}
            const value = owner(command.owner);
            if (command.type === 'mount') {
              flushSync(() => root.render(React.createElement(Component, {context: {
                module: 'roborock', api: value.api, ui: {}, connected: true,
                control: false, operations: [], operationsLive: true
              }})));
            } else if (command.type === 'sync') {
              const resolve = value.pendingSyncs.shift();
              if (resolve === undefined) throw new Error('No pending sync');
              let closed = false;
              const state = message(command.doc);
              resolve({status: 'synced', copy: {
                states: () => [state],
                get: () => state,
                close: async () => {if (!closed) {closed = true; value.closes++;}}
              }, message: {data: {revision: command.doc.revision}}});
            } else if (command.type === 'read') {
              const indexes = value.pendingReads.flatMap((read, index) =>
                read.path === command.path ? [index] : []);
              const index = command.latest ? indexes.at(-1) : indexes[0];
              if (index === undefined) throw new Error('No pending read');
              const [read] = value.pendingReads.splice(index, 1);
              read.resolve(command.value);
            } else if (command.type === 'update') {
              value.changed?.({type: 'updated', entity: {
                family: 'roborock-vacuum', id: command.doc.id
              }, message: message(command.doc)});
            } else if (command.type === 'failure') {
              value.changed?.({type: 'failed', error: {
                error: {code: 'unavailable', retryable: true}
              }});
            }
          }
        };
      `,
        },
        bundle: true, write: false, metafile: true,
        platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent',
    });
    const output = bundle.outputFiles[0];
    assert.ok(output !== undefined);
    assert.equal(Object.keys(bundle.metafile.inputs).some(path => /modules\/roborock\/src\/(families|store|module|collector|transport|normalize|configuration)\./u.test(path)), false);
    const open = async (): Promise<Page> => {
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        await page.route('**/*', async (route) => {
            const url = new URL(route.request().url());
            if (url.origin !== 'http://roborock-fixture.localhost') {
                await route.abort();
                return;
            }
            if (url.pathname === '/bundle.js') {
                await route.fulfill({ contentType: 'text/javascript', body: output.text });
            }
            else if (url.pathname === '/') {
                await route.fulfill({
                    contentType: 'text/html',
                    body: '<!doctype html><html lang="en"><title>Roborock component fixture</title><div id="root"></div><script type="module" src="/bundle.js"></script></html>',
                });
            }
            else
                await route.abort();
        });
        await page.goto('http://roborock-fixture.localhost/');
        await page.waitForFunction(() => 'roborockProbe' in window);
        return page;
    };
    let page = await open();
    try {
        await send(page, { type: 'mount', owner: 'late-copy' });
        await send(page, { type: 'unmount' });
        await send(page, { type: 'sync', owner: 'late-copy', doc: status('vacuum-late') });
        const late = (await stats(page))['late-copy'];
        assert.ok(late !== undefined);
        assert.equal(late.closes, 1);
        assert.deepEqual(late.reads, []);
        const a = status('vacuum-a', 66);
        await send(page, { type: 'mount', owner: 'a' });
        await send(page, { type: 'sync', owner: 'a', doc: a });
        const b = status('vacuum-b', 11);
        await ready(page, 'b', b);
        await send(page, {
            type: 'read', owner: 'a', path: `${ROOT}status`,
            value: { ...a, owner_note: 'SYNTHETIC_RETIRED_CONTEXT' },
        });
        await send(page, {
            type: 'read', owner: 'a', path: `${ROOT}runs?limit=25`,
            value: { ...runs(a.id), owner_note: 'SYNTHETIC_RETIRED_CONTEXT' },
        });
        await send(page, { type: 'update', owner: 'a', doc: { ...a, revision: 2 } });
        assert.equal(await page.getByText('11 %', { exact: true }).count(), 1);
        assert.equal(await page.getByText('66 %', { exact: true }).count(), 0);
        assert.equal(await page.getByRole('alert').count(), 0);
        const replaced = (await stats(page)).a;
        assert.ok(replaced !== undefined);
        assert.equal(replaced.closes, 1);
        await send(page, { type: 'unmount' });
        const stopped = (await stats(page)).b;
        assert.ok(stopped !== undefined);
        assert.equal(stopped.syncs, 1);
        assert.equal(stopped.closes, 1);
    }
    finally {
        await page.close();
    }
    page = await open();
    try {
        await ready(page, 'unknown', status('vacuum'));
        await page.getByText('Observation age: unknown.', { exact: true }).waitFor();
        assert.equal(await page.locator('[data-evidence-at]').count(), 0);
        await send(page, { type: 'now', at: 1000 });
        await ready(page, 'future', status('vacuum', 11, { status: 'known', value: 20000 }));
        await page.getByText('Observation age: unknown; clock comparison is unqualified.', { exact: true }).waitFor();
        assert.equal(await page.locator('[data-evidence-at]').first().getAttribute('data-evidence-at'), '20000');
        await send(page, { type: 'now', at: 10000 });
        await ready(page, 'age', status('vacuum', 11, { status: 'known', value: 1000 }));
        await page.getByText('Observation age: 9 seconds.', { exact: true }).waitFor();
        await send(page, { type: 'now', at: 13000 });
        await page.getByText('Observation age: 12 seconds.', { exact: true }).waitFor();
        await send(page, { type: 'failure', owner: 'age' });
        await page.getByText('Observation age: 12 seconds; status stream is stale.', { exact: true }).waitFor();
        assert.equal(await page.locator('[data-evidence-at]').first().getAttribute('data-evidence-at'), '1000');
    }
    finally {
        await page.close();
    }
    page = await open();
    try {
        const doc = status('vacuum');
        await ready(page, 'reads', doc, runs(doc.id, [100, 200], { status: 'known', value: 'runs-next' }));
        await page.getByRole('button', { name: 'Inspect run 100', exact: true }).click();
        await settle(page);
        await page.getByRole('button', { name: 'Inspect run 200', exact: true }).click();
        await settle(page);
        await resolveDetail(page, 'reads', doc.id, 200);
        await send(page, {
            type: 'read', owner: 'reads', path: `${ROOT}samples?recordId=200&limit=100`,
            value: samples(doc.id, 200, [], { status: 'known', value: 'samples-next' }),
        });
        await send(page, {
            type: 'read', owner: 'reads', path: `${ROOT}run?recordId=100`,
            value: { schema: 'roborock-run/2.0', id: doc.id, revision: 1, run: run(100), owner_note: 'SYNTHETIC_LATE_DETAIL' },
        });
        await send(page, {
            type: 'read', owner: 'reads', path: `${ROOT}samples?recordId=100&limit=100`,
            value: { ...samples(doc.id, 100), owner_note: 'SYNTHETIC_LATE_SAMPLE' },
        });
        await page.getByText('Run 200', { exact: true }).waitFor();
        assert.equal(await page.getByText('Run 100', { exact: true }).count(), 0);
        assert.equal(await page.getByRole('alert').count(), 0);
        await page.getByRole('button', { name: 'Next samples', exact: true }).click();
        await settle(page);
        // A context-independent history reload retires the selected detail and
        // its pending next-samples response.
        await page.getByRole('button', { name: 'Reload run history', exact: true }).click();
        await settle(page);
        await send(page, {
            type: 'read', owner: 'reads', path: `${ROOT}runs?limit=25`,
            value: runs(doc.id, [200], { status: 'known', value: 'runs-next' }),
        });
        await send(page, {
            type: 'read', owner: 'reads',
            path: `${ROOT}samples?recordId=200&limit=100&cursor=samples-next`,
            value: { ...samples(doc.id, 200), owner_note: 'SYNTHETIC_LATE_PAGE' },
        });
        assert.equal(await page.getByRole('region', { name: 'Run detail' }).count(), 0);
        assert.equal(await page.getByRole('alert').count(), 0);
        await page.getByRole('button', { name: 'Next runs', exact: true }).click();
        await settle(page);
        await page.getByRole('button', { name: 'Reload run history', exact: true }).click();
        await settle(page);
        await send(page, {
            type: 'read', owner: 'reads', path: `${ROOT}runs?limit=25&cursor=runs-next`,
            latest: true, value: runs(doc.id, [300]),
        });
        await send(page, {
            type: 'read', owner: 'reads', path: `${ROOT}runs?limit=25&cursor=runs-next`,
            value: { ...runs(doc.id, [400]), owner_note: 'SYNTHETIC_RETIRED_RUN_PAGE' },
        });
        assert.equal(await page.getByRole('button', { name: 'Inspect run 300', exact: true }).count(), 1);
        assert.equal(await page.getByRole('button', { name: 'Inspect run 400', exact: true }).count(), 0);
        assert.equal(await page.getByRole('alert').count(), 0);
        assert.equal((await page.locator('body').innerText()).includes('SYNTHETIC_'), false);
    }
    finally {
        await page.close();
    }
    const scenarios: readonly {
        name: string;
        gaps: CollectionGap[];
        next: Value<string>;
        groups: number[][];
    }[] = [
        { name: 'no-gap', gaps: [], next: UNKNOWN, groups: [[0, 1, 2, 3, 4, 5]] },
        { name: 'closed-gap', gaps: [{
                    startAtMs: 202500, endAtMs: { status: 'known', value: 203500 }, reason: 'missed-poll',
                }], next: UNKNOWN, groups: [[0, 1], [3, 4, 5]] },
        { name: 'open-gap', gaps: [{
                    startAtMs: 202500, endAtMs: UNKNOWN, reason: 'unavailable',
                }], next: UNKNOWN, groups: [[0, 1]] },
        { name: 'boundary-gap', gaps: [{
                    startAtMs: 202000, endAtMs: { status: 'known', value: 204000 }, reason: 'restart',
                }], next: UNKNOWN, groups: [[4, 5]] },
        { name: 'incomplete-gap-page', gaps: [], next: { status: 'known', value: 'next' }, groups: [] },
    ];
    for (const scenario of scenarios) {
        page = await open();
        try {
            const doc = status('vacuum');
            await ready(page, scenario.name, doc, runs(doc.id, [200]));
            await page.getByRole('button', { name: 'Inspect run 200', exact: true }).click();
            await settle(page);
            await resolveDetail(page, scenario.name, doc.id, 200);
            const value = samples(doc.id, 200, scenario.gaps, scenario.next);
            value.samples.reverse(); // Returned ordering must not fabricate time direction.
            await send(page, {
                type: 'read', owner: scenario.name,
                path: `${ROOT}samples?recordId=200&limit=100`, value,
            });
            const chart = await topology(page);
            assert.equal(chart.circles.length, 6);
            assert.deepEqual(chart.lines, scenario.groups.map(group => group.map(index => {
                const point = chart.circles[index];
                assert.ok(point !== undefined);
                return point;
            })), scenario.name);
            assert.equal(await page.getByRole('table', { name: 'Observed battery samples on this page' }).locator('tbody tr').count(), 6);
            assert.equal(await page.getByRole('table', { name: 'Collection gaps on this page' }).locator('tbody tr').count(), scenario.gaps.length);
            if (scenario.next.status === 'known') {
                await page.getByRole('button', { name: 'Next samples', exact: true }).click();
                await settle(page);
                await send(page, {
                    type: 'read', owner: scenario.name,
                    path: `${ROOT}samples?recordId=200&limit=100&cursor=next`,
                    value: samples(doc.id, 200),
                });
                assert.deepEqual((await topology(page)).lines, [], 'a subsequent page cannot establish the complete gap inventory');
            }
        }
        finally {
            await page.close();
        }
    }
}
