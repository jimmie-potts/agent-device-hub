// Music visualizer (#1619): the Audio panel, its full view and the Home card over a real disposable core/gateway with
// the numeric-only capture fixture. No native helper, real capture, light or other device is used. Capture starts and
// stops below go through the existing Music input measurement card; the visualizer itself must send nothing.
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {expect, type Locator, type Page} from 'playwright/test';
import {startWorld, changes, feed} from './harness.ts';
import {musicCaptureProducer} from './music-capture-producer.ts';
import {browserArtifactDirectory} from './browser-artifacts.ts';

const world = await startWorld({musicCapture: true});
let producer: Awaited<ReturnType<typeof musicCaptureProducer>> | undefined;
const browser = await chromium.launch({headless: true});
const evidence = process.env.VISUALIZER_EVIDENCE ?? await browserArtifactDirectory();
await mkdir(evidence, {recursive: true});
const fits = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const canvasImage = (canvas: Locator): Promise<string> => canvas.evaluate(node => (node as HTMLCanvasElement).toDataURL());
let clockRetries = 0;
/**
 * Waits for a surface on a freshly loaded page to go live. Under a loaded runner the page's capture sync can miss the
 * capture clock's round-trip bound (#1580); the surface then rests with exactly that reason, and a reload syncs again.
 * Any other resting reason fails at once. In-page navigation never uses this: it must go live on the same page load.
 */
async function liveAfterLoad(page: Page, canvas: Locator): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {await expect(canvas).toHaveAttribute('data-visualizer-state', 'live', {timeout: 5000}); return;} catch {/* Check the reason below. */}
    const label = await canvas.getAttribute('aria-label') ?? '';
    assert.match(label, /Resting: Measurement timing is unavailable\.$/, `only the capture clock bound may be retried: ${label}`);
    clockRetries += 1; await page.reload(); await feed(page, 'connected');
  }
  await expect(canvas).toHaveAttribute('data-visualizer-state', 'live');
}
/** Display-frame gaps over 120 animation frames, and how many the visualizer canvas painted meanwhile. */
const frameTimes = (page: Page, selector: string) => page.evaluate(async (query: string) => {
  const canvasNode = document.querySelector<HTMLCanvasElement>(query);
  const before = Number(canvasNode?.dataset.visualizerPainted ?? 0), times: number[] = [];
  await new Promise<void>(resolve => {const tick = (time: number): void => {times.push(time); if (times.length < 121) requestAnimationFrame(tick); else resolve();}; requestAnimationFrame(tick);});
  const gaps = times.slice(1).map((time, index) => time - (times[index] ?? time)).sort((a, b) => a - b);
  return {frames: gaps.length, painted: Number(canvasNode?.dataset.visualizerPainted ?? 0) - before, medianMs: gaps[Math.floor(gaps.length / 2)] ?? 0,
    p95Ms: gaps[Math.floor(gaps.length * 0.95)] ?? 0, longestMs: gaps.at(-1) ?? 0, over20ms: gaps.filter(gap => gap > 20).length, over50ms: gaps.filter(gap => gap > 50).length};
}, selector);
try {
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const sent = changes(page);
  const shot = async (name: string): Promise<void> => {await page.screenshot({path: join(evidence, `${name}.png`), fullPage: true});};
  await page.goto(world.url + '/#/audio'); await feed(page, 'connected');
  const panel = page.getByRole('region', {name: 'Music visualizer', exact: true});
  const canvas = panel.locator('canvas'), effect = panel.getByRole('combobox', {name: 'Effect', exact: true});
  const capture = page.getByRole('article', {name: 'Music input measurement', exact: true});
  const startMusic = capture.getByRole('button', {name: 'Start measuring Music', exact: true});

  // Resting before any source, then with the source ready but not measuring.
  await expect(canvas).toHaveAttribute('data-visualizer-state', 'resting');
  await panel.getByText('Resting. Music producer is off.', {exact: true}).waitFor();
  await expect(effect).toHaveValue('spectrum-bars');
  await shot('audio-resting-producer-off-1440');
  producer = await musicCaptureProducer(world.url, world.musicCaptureToken);
  await panel.getByText('Resting. Measurement is not running.', {exact: true}).waitFor();
  await effect.selectOption('bass-pulse'); await effect.selectOption('spectrum-bars');
  assert.equal(sent.length, 0, 'reading, resting and choosing an effect send nothing'); assert.equal(producer.commands.length, 0);

  // Live: the fake stream drives the chosen effect.
  await startMusic.click(); await capture.getByText(/Start: Completed: succeeded/).waitFor();
  await expect(canvas).toHaveAttribute('data-visualizer-state', 'live');
  await expect(canvas).toHaveAttribute('data-visualizer-levels', '0.25 0.25 0.00 0.00');
  const first = Number(await canvas.getAttribute('data-visualizer-sequence'));
  await expect.poll(async () => Number(await canvas.getAttribute('data-visualizer-sequence'))).toBeGreaterThan(first);
  const painted = Number(await canvas.getAttribute('data-visualizer-painted'));
  await expect.poll(async () => Number(await canvas.getAttribute('data-visualizer-painted'))).toBeGreaterThan(painted + 10);
  await panel.getByText('Showing Spectrum bars from measured Music.', {exact: true}).waitFor();
  const steady = await canvasImage(canvas);
  await shot('audio-spectrum-bars-steady-1440');
  producer.bands({bass: 0.05, mid: 0.3, treble: 0.9}); producer.level(0.4);
  await expect(canvas).toHaveAttribute('data-visualizer-levels', '0.40 0.05 0.30 0.90');
  assert.notEqual(await canvasImage(canvas), steady, 'a band change redraws the bars');
  await shot('audio-spectrum-bars-treble-1440');
  producer.bands(undefined); producer.level(0);
  await expect(canvas).toHaveAttribute('data-visualizer-levels', '0.00 0.00 0.00 0.00');
  await expect(canvas).toHaveAttribute('data-visualizer-state', 'live');
  await shot('audio-spectrum-bars-silence-1440');

  await effect.selectOption('bass-pulse'); await expect(canvas).toHaveAttribute('data-visualizer-effect', 'bass-pulse');
  await page.waitForTimeout(400); const quiet = await canvasImage(canvas);
  producer.level(0.9); await expect(canvas).toHaveAttribute('data-visualizer-levels', '0.90 0.90 0.00 0.00');
  assert.notEqual(await canvasImage(canvas), quiet, 'bass flares the pulse');
  await shot('audio-bass-pulse-beat-1440');
  producer.level(0.05); await expect(canvas).toHaveAttribute('data-visualizer-levels', '0.05 0.05 0.00 0.00');
  await page.waitForTimeout(600); await shot('audio-bass-pulse-decayed-1440');

  // The choice survives a reload, per browser.
  await page.reload(); await feed(page, 'connected');
  await expect(effect).toHaveValue('bass-pulse'); await expect(canvas).toHaveAttribute('data-visualizer-effect', 'bass-pulse');
  await liveAfterLoad(page, canvas);
  assert.equal(await page.evaluate(() => localStorage.getItem('bunny.music-visualizer.effect')), 'bass-pulse');

  // Phone widths keep the page intact, live and resting alike.
  for (const width of [390, 320]) {
    await page.setViewportSize({width, height: 900});
    for (const value of ['spectrum-bars', 'bass-pulse']) {
      await effect.selectOption(value); await expect(canvas).toHaveAttribute('data-visualizer-effect', value);
      await expect.poll(() => fits(page)).toBe(true);
      const box = await canvas.boundingBox(); assert.ok(box !== null && box.width <= width && box.width > width * 0.6, `${value} canvas fits ${String(width)} px`);
      await canvas.scrollIntoViewIfNeeded(); await page.screenshot({path: join(evidence, `audio-${value}-live-${String(width)}.png`)});
    }
  }
  await page.setViewportSize({width: 1440, height: 1000});

  // The stream stops and goes stale, and a frame from a foreign generation is ignored: resting, never frozen motion.
  // (A real generation change from live is covered by the unit tests through CaptureProjection.)
  producer.pause();
  await expect(canvas).toHaveAttribute('data-visualizer-state', 'resting');
  await panel.getByText('Resting. Measurements are stale.', {exact: true}).waitFor();
  const resting = await canvasImage(canvas); await page.waitForTimeout(300);
  assert.equal(await canvasImage(canvas), resting, 'the resting scene is still');
  await shot('audio-resting-stale-1440');
  await page.setViewportSize({width: 390, height: 900}); await expect.poll(() => fits(page)).toBe(true);
  await canvas.scrollIntoViewIfNeeded(); await page.screenshot({path: join(evidence, 'audio-resting-stale-390.png')});
  await page.setViewportSize({width: 1440, height: 1000});
  await producer.emit({generation: '22222222-2222-4222-8222-222222222222'}); await page.waitForTimeout(300);
  await expect(canvas).toHaveAttribute('data-visualizer-state', 'resting');
  await producer.start(); await expect(canvas).toHaveAttribute('data-visualizer-state', 'live');

  // The full view fills the window, offers full screen and returns to Audio.
  await panel.getByRole('link', {name: 'Fill window', exact: true}).click();
  await expect(page).toHaveURL(/#\/audio\/visualizer$/);
  const full = page.getByRole('region', {name: 'Music visualizer full view', exact: true}), fullCanvas = full.locator('canvas');
  await expect(fullCanvas).toHaveAttribute('data-visualizer-state', 'live');
  const fullBox = await fullCanvas.boundingBox(); assert.deepEqual(fullBox, {x: 0, y: 0, width: 1440, height: 1000});
  await shot('full-view-bass-pulse-1440');
  if (await page.evaluate(() => document.fullscreenEnabled)) {
    await full.getByRole('button', {name: 'Full screen', exact: true}).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className ?? '')).toContain('music-visualizer-full');
    await full.getByRole('button', {name: 'Leave full screen', exact: true}).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
  }
  await page.keyboard.press('Escape'); await expect(page).toHaveURL(/#\/audio$/);
  await expect(canvas).toHaveAttribute('data-visualizer-state', 'live');
  await panel.getByRole('link', {name: 'Fill window', exact: true}).click(); await expect(fullCanvas).toHaveAttribute('data-visualizer-state', 'live');
  await full.getByRole('button', {name: 'Exit full view', exact: true}).click(); await expect(page).toHaveURL(/#\/audio$/);
  await expect(canvas).toHaveAttribute('data-visualizer-state', 'live');
  assert.deepEqual(sent, ['/api/v2/commands/music-capture-control'], 'only the explicit capture Start was sent');

  // A 4K window: the full view fills 3,840 x 2,160. Frame timings for both live effects are recorded beside a
  // resting-scene and a blank-canvas baseline from the same run, so runner stalls can be told from effect cost.
  // They are evidence, not a gate; whether the TV drops frames is the owner's installed check.
  const tv = await browser.newContext({viewport: {width: 3840, height: 2160}, deviceScaleFactor: 1});
  try {
    const blank = await tv.newPage();
    await blank.setContent('<body style="margin:0;background:#000"><canvas style="display:block;width:100vw;height:100vh"></canvas></body>');
    const blankFrames = await frameTimes(blank, 'canvas'); await blank.close();
    const tvPage = await tv.newPage(); tvPage.setDefaultTimeout(12_000);
    await tvPage.goto(world.url + '/#/audio/visualizer'); await feed(tvPage, 'connected');
    const tvFull = tvPage.getByRole('region', {name: 'Music visualizer full view', exact: true}), tvCanvas = tvFull.locator('canvas');
    await liveAfterLoad(tvPage, tvCanvas);
    assert.deepEqual(await tvCanvas.evaluate(node => [(node as HTMLCanvasElement).width, (node as HTMLCanvasElement).height]), [3840, 2160]);
    assert.equal(await fits(tvPage), true);
    const selector = '.music-visualizer-full canvas', tvEffect = tvFull.getByRole('combobox', {name: 'Effect', exact: true});
    // A separate browser context has its own storage, so it starts on the default effect.
    await tvEffect.selectOption('bass-pulse'); await expect(tvCanvas).toHaveAttribute('data-visualizer-effect', 'bass-pulse');
    const bassFrames = await frameTimes(tvPage, selector);
    await tvPage.screenshot({path: join(evidence, 'full-view-bass-pulse-3840x2160.png')});
    await tvEffect.selectOption('spectrum-bars'); await expect(tvCanvas).toHaveAttribute('data-visualizer-effect', 'spectrum-bars');
    const barsFrames = await frameTimes(tvPage, selector);
    await tvPage.screenshot({path: join(evidence, 'full-view-spectrum-bars-3840x2160.png')});
    producer.pause(); await expect(tvCanvas).toHaveAttribute('data-visualizer-state', 'resting');
    const restingFrames = await frameTimes(tvPage, selector);
    await tvPage.screenshot({path: join(evidence, 'full-view-resting-3840x2160.png')});
    await producer.start(); await expect(tvCanvas).toHaveAttribute('data-visualizer-state', 'live');
    const frames = {blankCanvas: blankFrames, resting: restingFrames, bassPulse: bassFrames, spectrumBars: barsFrames};
    await writeFile(join(evidence, 'full-view-3840x2160-frames.json'), JSON.stringify(frames, null, 2));
    assert.ok(bassFrames.painted > 0 && barsFrames.painted > 0, `the 4K view paints both effects: ${JSON.stringify(frames)}`);
    console.log(JSON.stringify({journey: 'music-visualizer-4k', ...frames}));
  } finally {await tv.close();}
  await expect(canvas).toHaveAttribute('data-visualizer-state', 'live');

  // Home: the card is in the catalog, and is added, moved, saved, reloaded and removed with the existing editor.
  await page.goto(world.url + '/#/'); await feed(page, 'connected');
  const grid = page.locator('.home-layout-grid');
  const order = async (): Promise<string[]> => grid.locator('[data-home-card]').evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.homeCard ?? ''));
  const editHome = page.getByRole('button', {name: 'Edit Home', exact: true}), done = page.getByRole('button', {name: 'Done', exact: true});
  await expect(editHome).toBeEnabled(); assert(!(await order()).includes('music-visualizer'), 'not on Home by default');
  await editHome.click(); await page.getByRole('button', {name: 'Add card', exact: true}).click();
  const picker = page.getByRole('region', {name: 'Add a card', exact: true});
  await picker.getByRole('group', {name: 'Card categories', exact: true}).getByRole('button', {name: 'Audio', exact: true}).click();
  await picker.getByRole('searchbox', {name: 'Search cards', exact: true}).fill('visualizer');
  await expect(picker.getByRole('listitem')).toHaveCount(1);
  await picker.getByRole('button', {name: 'Add Music visualizer', exact: true}).click();
  await picker.getByRole('button', {name: 'Close', exact: true}).click();
  const added = await order(); assert.equal(added.at(-1), 'music-visualizer');
  await page.getByRole('button', {name: 'Move Music visualizer earlier', exact: true}).click();
  const moved = await order(); assert.equal(moved.at(-2), 'music-visualizer');
  await done.click(); await expect(editHome).toBeEnabled();
  assert.equal(sent.at(-1), '/api/v2/commands/home-layout-set');
  await page.reload(); await feed(page, 'connected');
  const card = page.locator('[data-home-card="music-visualizer"]'), cardCanvas = card.locator('canvas');
  await expect(card).toBeVisible(); assert.deepEqual(await order(), moved, 'the saved position survives a reload');
  await expect(card.getByRole('heading', {name: 'Music visualizer', exact: true})).toBeVisible();
  await liveAfterLoad(page, cardCanvas); await expect(cardCanvas).toHaveAttribute('data-visualizer-effect', 'bass-pulse');
  await card.getByText('Showing measured Music.', {exact: false}).waitFor(); await expect(card.getByText('Bass pulse', {exact: true})).toBeVisible();
  await card.scrollIntoViewIfNeeded(); await card.screenshot({path: join(evidence, 'home-card-bass-pulse-live-1440.png')}); await shot('home-bass-pulse-live-1440');
  const audio = await context.newPage(); audio.setDefaultTimeout(12_000); const audioSent = changes(audio);
  await audio.goto(world.url + '/#/audio'); await feed(audio, 'connected');
  await audio.getByRole('region', {name: 'Music visualizer', exact: true}).getByRole('combobox', {name: 'Effect', exact: true}).selectOption('spectrum-bars');
  await expect(cardCanvas).toHaveAttribute('data-visualizer-effect', 'spectrum-bars', {timeout: 5000});
  await expect(card.getByText('Spectrum bars', {exact: true})).toBeVisible();
  await card.screenshot({path: join(evidence, 'home-card-spectrum-bars-live-1440.png')});
  await page.setViewportSize({width: 390, height: 900}); await expect.poll(() => fits(page)).toBe(true);
  await card.scrollIntoViewIfNeeded(); await page.screenshot({path: join(evidence, 'home-card-spectrum-bars-live-390.png')});
  await audio.getByRole('article', {name: 'Music input measurement', exact: true}).getByRole('button', {name: 'Stop measuring', exact: true}).click();
  await expect(cardCanvas).toHaveAttribute('data-visualizer-state', 'resting');
  await card.getByText('Resting. Measurement is not running.', {exact: false}).waitFor();
  await card.scrollIntoViewIfNeeded(); await page.screenshot({path: join(evidence, 'home-card-resting-390.png')});
  await page.setViewportSize({width: 1440, height: 1000}); await card.screenshot({path: join(evidence, 'home-card-resting-1440.png')});
  assert.deepEqual(audioSent, ['/api/v2/commands/music-capture-control'], 'only the explicit Stop was sent from Audio');
  await audio.close();
  await card.getByRole('link', {name: 'Open full view', exact: true}).click(); await expect(page).toHaveURL(/#\/audio\/visualizer$/);
  await page.getByRole('region', {name: 'Music visualizer full view', exact: true}).getByText('Resting. Measurement is not running.', {exact: true}).waitFor();
  await shot('full-view-resting-1440');
  await page.goto(world.url + '/#/'); await feed(page, 'connected'); await expect(editHome).toBeEnabled();
  await editHome.click(); await page.getByRole('button', {name: 'Remove Music visualizer', exact: true}).click(); await done.click(); await expect(editHome).toBeEnabled();
  await page.reload(); await feed(page, 'connected'); await expect(editHome).toBeEnabled();
  await expect(page.locator('[data-home-card="music-visualizer"]')).toHaveCount(0);
  assert.deepEqual(sent, ['/api/v2/commands/music-capture-control', '/api/v2/commands/home-layout-set', '/api/v2/commands/home-layout-set'],
    'the visualizer added no command: only the explicit Start and the two layout saves');
  assert.deepEqual(producer.commands.map(command => command.data.action), ['start', 'stop'], 'capture work came only from the explicit Start and Stop');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({journey: 'music-visualizer', effects: ['spectrum-bars', 'bass-pulse'], resting: ['producer off', 'not running', 'stale', 'foreign-generation frame ignored'], choiceSurvivesReload: true,
    fullView: 'in-page from Audio and Home, 1440 and 3840x2160', fullScreenApi: true, home: 'add/move/save/reload/remove at 1440; card at 1440 and 390',
    audioWidths: [1440, 390, 320], clockRetries, evidence, physical: false}));
  await context.close();
} finally {await browser.close(); await producer?.close(); await world.close();}
