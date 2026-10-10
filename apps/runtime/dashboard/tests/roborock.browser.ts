import assert from 'node:assert/strict';
import { AxeBuilder } from '@axe-core/playwright';
import { chromium, type Page, type Route } from 'playwright';
import { changes, feed, startWorld } from './harness.ts';
import { checkRoborockFrontend } from './roborock.frontend.ts';
function latch(): {
    wait: Promise<void>;
    release: () => void;
} {
    let release: () => void = () => { };
    const wait = new Promise<void>(resolve => { release = resolve; });
    return { wait, release };
}
async function frame(page: Page): Promise<void> {
    await page.evaluate(() => new Promise<void>(resolve => {
        requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); });
    }));
}
const browser = await chromium.launch({ headless: true });
const world = await startWorld({ roborock: true });
try {
    // Startup reconciliation is bounded; drive further synthetic polls through
    // the host-held seam instead of waiting for the production cadence.
    for (let i = 0; i < 12; i++)
        await world.roborockRefresh();
    const context = await browser.newContext({
        viewport: { width: 1280, height: 1000 },
        reducedMotion: 'reduce',
    });
    try {
        const errors: string[] = [];
        context.on('weberror', error => { errors.push(error.error().name); });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        const sent = changes(page);
        const url = `${world.url}/#/module/roborock/status`;
        await page.goto(url);
        await feed(page, 'connected');
        const observations = page.getByRole('region', { name: 'Roborock observations' });
        const history = page.getByRole('region', { name: 'Run history' });
        const detail = page.getByRole('region', { name: 'Run detail' });
        await observations.getByText('Availability: available. Activity: other.', { exact: true }).waitFor();
        await history.getByRole('button', { name: 'Next runs', exact: true }).waitFor();
        assert.equal(await history.getByRole('button', { name: 'Next runs', exact: true }).isEnabled(), true);
        assert.equal(await history.locator('button[data-record-id]').count(), 25);
        assert.deepEqual(sent, [], 'opening and inspecting the page sends no commands');
        assert.equal(await observations.getByRole('button', { name: /clean|dock|wash|start|stop/i }).count(), 0);
        const retainedBefore = await world.roborockStatus();
        const mcp = await world.roborockStatusViaMcp();
        assert.deepEqual(mcp, await world.roborockStatus(), 'read-scoped MCP returns the current status document');
        assert.equal(retainedBefore.id, 'vacuum');
        // Real archive pagination, driven by the actual module content reader.
        const firstIds = await history.locator('button[data-record-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-record-id')));
        await history.getByRole('button', { name: 'Next runs', exact: true }).focus();
        await history.getByRole('button', { name: 'Next runs', exact: true }).press('Enter');
        await history.getByRole('button', { name: 'Previous runs', exact: true }).waitFor();
        await page.waitForFunction(() => {
            const rows = document.querySelectorAll('[aria-label="Run history"] button[data-record-id]');
            return rows.length > 0 && rows.length < 25;
        });
        const secondIds = await history.locator('button[data-record-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-record-id')));
        assert.equal(secondIds.some(id => firstIds.includes(id)), false);
        await history.getByRole('button', { name: 'Previous runs', exact: true }).click();
        await page.waitForFunction(() => document.querySelectorAll('[aria-label="Run history"] button[data-record-id]').length === 25);
        // A reconciled historical run has no manufactured battery or current map.
        const historical = history.locator('button[data-record-id]').first();
        const historicalId = await historical.getAttribute('data-record-id');
        assert.ok(historicalId !== null);
        await historical.focus();
        await historical.press('Enter');
        await detail.getByText(`Run ${historicalId}`, { exact: true }).waitFor();
        await detail.getByText('Battery evidence: missing on this page.', { exact: false }).waitFor();
        await detail.getByText('Map coverage is unverified.', { exact: false }).waitFor();
        // A response from a retired selection must not replace the next selection.
        const first = history.locator('button[data-record-id]').nth(0);
        const second = history.locator('button[data-record-id]').nth(1);
        const firstId = await first.getAttribute('data-record-id');
        const secondId = await second.getAttribute('data-record-id');
        assert.ok(firstId !== null && secondId !== null && firstId !== secondId);
        const held = latch();
        const received = latch();
        const completed = latch();
        const delay = async (route: Route): Promise<void> => {
            const request = new URL(route.request().url());
            if (request.searchParams.get('recordId') !== firstId) {
                await route.continue();
                return;
            }
            try {
                const response = await route.fetch();
                received.release();
                await held.wait;
                await route.fulfill({ response });
            }
            catch {
                // The shell may abort an obsolete request after leaving its scope.
            }
            finally {
                completed.release();
            }
        };
        await page.route('**/modules/roborock/content/run?**', delay);
        await second.click();
        await detail.getByText(`Run ${secondId}`, { exact: true }).waitFor();
        await first.click();
        await received.wait;
        await second.click();
        await detail.getByText(`Run ${secondId}`, { exact: true }).waitFor();
        held.release();
        await completed.wait;
        await frame(page);
        assert.equal(await detail.getByText(`Run ${firstId}`, { exact: true }).count(), 0);
        await page.unroute('**/modules/roborock/content/run?**', delay);
        // Synthetic collection actions are host-only. A second cleaning action
        // would create a different simulated start identifier, so recovery uses
        // the poll seam without resetting the active run.
        await world.roborockAction('cleaning');
        await observations.getByText('Availability: available. Activity: cleaning.', { exact: true }).waitFor();
        await world.roborockAction('late');
        await observations.getByText('Availability: unavailable. Activity: cleaning.', { exact: true }).waitFor();
        await world.roborockRefresh();
        await observations.getByText('Availability: available. Activity: cleaning.', { exact: true }).waitFor();
        await new Promise<void>(resolve => { setTimeout(resolve, 20); });
        await world.roborockRefresh();
        await new Promise<void>(resolve => { setTimeout(resolve, 1100); });
        await world.roborockAction('complete');
        await observations.getByText('Availability: available. Activity: other.', { exact: true }).waitFor();
        await history.getByRole('button', { name: 'Reload run history', exact: true }).click();
        const observedRun = history.locator('button[data-record-id]').first();
        const observedId = await observedRun.getAttribute('data-record-id');
        assert.ok(observedId !== null && observedId !== historicalId);
        await observedRun.click();
        await detail.getByText(`Run ${observedId}`, { exact: true }).waitFor();
        await detail.getByRole('table', { name: 'Observed battery samples on this page' }).waitFor();
        await detail.getByRole('table', { name: 'Collection gaps on this page' }).waitFor();
        assert.ok(await detail.getByRole('table', { name: 'Observed battery samples on this page' }).locator('tbody tr').count() > 0);
        assert.ok(await detail.getByRole('table', { name: 'Collection gaps on this page' }).locator('tbody tr').count() > 0);
        await detail.getByRole('img', { name: /Observed battery percentage/ }).waitFor();
        await detail.getByText('Map coverage is unverified.', { exact: false }).waitFor();
        // The diagram's text alternatives expose the returned evidence. Exact
        // segment topology is also checked by the focused frontend fixture tests.
        const chart = detail.locator('svg[data-battery-segments]');
        const segments = await chart.getAttribute('data-battery-segments');
        assert.ok(segments !== null && /^\d+$/u.test(segments));
        assert.equal(await detail.locator('polyline').count(), Number(segments));
        const beforeEmpty = (await world.roborockStatus()).collection.retainedRuns;
        await world.roborockAction('empty-history');
        const afterEmpty = (await world.roborockStatus()).collection.retainedRuns;
        assert.equal(afterEmpty, beforeEmpty, 'an empty vendor summary preserves retained history');
        // This interception tests the browser empty state only. It is not evidence
        // that the real archive erased or lost historical records.
        const emptyRuns = async (route: Route): Promise<void> => {
            const response = await route.fetch();
            const original: unknown = await response.json();
            assert.ok(typeof original === 'object' && original !== null && 'schema' in original);
            await route.fulfill({
                response,
                json: { ...original, runs: [], next: { status: 'unknown' } },
            });
        };
        await page.route('**/modules/roborock/content/runs?**', emptyRuns);
        await history.getByRole('button', { name: 'Reload run history', exact: true }).click();
        await history.getByText('No retained runs were returned on this page. History completeness is unknown.', { exact: true }).waitFor();
        await page.unroute('**/modules/roborock/content/runs?**', emptyRuns);
        await history.getByRole('button', { name: 'Reload run history', exact: true }).click();
        await history.locator('button[data-record-id]').first().waitFor();
        // Browser validation rejects an extra field inside a known/unknown wrapper.
        const privateMarker = 'SYNTHETIC_PRIVATE_BROWSER_BOUNDARY';
        const poisonedStatus = async (route: Route): Promise<void> => {
            const response = await route.fetch();
            const original = await world.roborockStatus();
            await route.fulfill({
                response,
                json: {
                    ...original,
                    status: {
                        ...original.status,
                        batteryPercent: {
                            ...original.status.batteryPercent,
                            owner_note: privateMarker,
                        },
                    },
                },
            });
        };
        await page.route('**/modules/roborock/content/status', poisonedStatus);
        await observations.getByRole('button', { name: 'Reload observations', exact: true }).click();
        await observations.getByRole('alert').getByText('Read refused: invalid-message.', { exact: true }).waitFor();
        assert.equal((await page.locator('body').innerText()).includes(privateMarker), false);
        await page.unroute('**/modules/roborock/content/status', poisonedStatus);
        await observations.getByRole('button', { name: 'Reload observations', exact: true }).click();
        await observations.getByText('Availability: available. Activity: other.', { exact: true }).waitFor();
        const forbidden = async (route: Route): Promise<void> => {
            await route.fulfill({
                status: 403,
                contentType: 'application/json',
                json: { error: { code: 'forbidden', retryable: false } },
            });
        };
        await page.route('**/modules/roborock/content/status', forbidden);
        await observations.getByRole('button', { name: 'Reload observations', exact: true }).click();
        await observations.getByRole('alert').getByText('Read refused: forbidden.', { exact: true }).waitFor();
        await page.unroute('**/modules/roborock/content/status', forbidden);
        await observations.getByRole('button', { name: 'Reload observations', exact: true }).click();
        await observations.getByText('Availability: available. Activity: other.', { exact: true }).waitFor();
        // Age advances without changing the stored evidence timestamp.
        const evidence = observations.locator('[data-evidence-at]').first();
        const originalEvidence = await evidence.getAttribute('data-evidence-at');
        assert.ok(originalEvidence !== null);
        await page.evaluate(() => {
            const now = Date.now();
            Date.now = () => now + 120000;
        });
        await observations.locator('[data-observation-age]').getByText(/Observation age: 1[2-9]\d seconds/).waitFor();
        assert.equal(await evidence.getAttribute('data-evidence-at'), originalEvidence);
        await world.roborockAction('offline');
        await observations.getByText('Availability: unavailable. Activity: other.', { exact: true }).waitFor();
        assert.equal(await evidence.getAttribute('data-evidence-at'), originalEvidence);
        await world.roborockAction('online');
        await page.reload();
        await feed(page, 'connected');
        await observations.getByText('Availability: available. Activity: other.', { exact: true }).waitFor();
        world.dropDashboardStreams();
        await feed(page, 'connected');
        await observations.getByRole('heading', { name: 'Roborock observations', exact: true }).waitFor();
        assert.equal(world.browserSessions(), 1, 'reconnect uses the existing browser session');
        await page.goto(`${world.url}/#/`);
        await feed(page, 'connected');
        await page.goto(url);
        await feed(page, 'connected');
        await observations.getByText('Availability: available. Activity: other.', { exact: true }).waitFor();
        assert.equal(world.browserSessions(), 1, 're-entry does not create another browser session');
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
        assert.deepEqual((await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()).violations.map(item => item.id), []);
        assert.deepEqual(sent, [], 'inspection never sends product commands');
        assert.equal(world.roborockCalls().every(name => ['status', 'consumables', 'summary', 'record', 'rooms', 'map'].includes(name)), true);
        await checkRoborockFrontend(context);
        assert.deepEqual(errors, []);
        process.stdout.write(`${JSON.stringify({
            passed: true,
            journey: 'roborock',
            transport: 'authenticated synthetic runtime',
            inspectionWrites: 0,
            keyboard: true,
            narrowViewport: true,
            reducedMotion: true,
            axe: 'passed',
            history: 'partial',
            maps: 'unverified',
            clock: 'unqualified',
        })}\n`);
    }
    finally {
        await context.close();
    }
}
finally {
    await world.close();
    await browser.close();
}
