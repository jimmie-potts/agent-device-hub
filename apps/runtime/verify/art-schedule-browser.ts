import assert from 'node:assert/strict';
import type {Locator, Page} from 'playwright';
import type {CaptureContext} from '@jimmie-potts/app-verify';
import type {ScheduleProof} from '../tests/scenarios/daily-schedule.js';

/** Real policy evidence, followed by labelled native simulation frames retained during this scenario. */
export async function captureArtSchedule(t: CaptureContext, proof: ScheduleProof): Promise<void> {
  const page = t.page as Page;page.setDefaultTimeout(12_000);
  await page.goto(new URL('/#/automation', t.url).href);
  await page.locator('main#main[data-feed="connected"]').waitFor();
  await page.evaluate(() => {
    const label = document.createElement('div');label.id = 'schedule-proof-label';
    label.textContent = 'Scripted synthetic review: saved Daily art evidence. Physical visibility remains unverified.';
    Object.assign(label.style, {position: 'fixed', bottom: '12px', left: '12px', right: '12px', padding: '12px', color: '#fff', background: '#111827', border: '2px solid #fbbf24', zIndex: '9999', pointerEvents: 'none'});
    const cursor = document.createElement('div');cursor.id = 'schedule-proof-cursor';
    Object.assign(cursor.style, {position: 'fixed', width: '22px', height: '22px', border: '3px solid #fbbf24', borderRadius: '50%', zIndex: '10000', pointerEvents: 'none'});
    document.body.append(label, cursor);
    document.addEventListener('pointermove', event => {cursor.style.left = `${event.clientX - 11}px`;cursor.style.top = `${event.clientY - 11}px`;});
  });
  const click = async (control: Locator, label: string): Promise<void> => {
    await control.waitFor();let box = await control.boundingBox();const viewport = page.viewportSize();assert.ok(box !== null && viewport !== null);
    if (box.y < 0 || box.y + box.height > viewport.height - 70) {
      await page.locator('#schedule-proof-label').evaluate((node, text) => {node.textContent = `Synthetic review: scroll to ${text}`;}, label);
      await page.mouse.move(viewport.width - 30, viewport.height / 2);await page.waitForTimeout(350);
      await page.mouse.wheel(0, box.y - 90);await page.waitForTimeout(500);box = await control.boundingBox();assert.ok(box !== null);
    }
    await page.locator('#schedule-proof-label').evaluate((node, text) => {node.textContent = `Synthetic review: ${text}. No physical display verification.`;}, label);
    await control.evaluate(node => {(node as HTMLElement).style.outline = '3px solid #fbbf24';});
    const reduced = await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: reduced ? 1 : 8});await page.waitForTimeout(400);
    await page.locator('#schedule-proof-cursor').evaluate(node => {(node as HTMLElement).style.background = '#fbbf24';});
    await control.click();await page.waitForTimeout(600);
    await page.locator('#schedule-proof-cursor').evaluate(node => {(node as HTMLElement).style.background = 'transparent';});
    if (await control.count() > 0) await control.evaluate(node => {(node as HTMLElement).style.outline = '';});
  };
  await click(page.getByRole('tab', {name: 'Art', exact: true}), 'Open the Daily art tab');
  const panel = page.getByRole('region', {name: 'Daily art', exact: true});
  await panel.waitFor();
  await click(panel.getByText('Latest art opportunity', {exact: true}), 'Open the independently tracked opportunity');
  await t.expect('the real Daily art page shows the saved disabled policy and separate transmitted outcomes', async () => {
    assert.equal(await panel.getByLabel('Enable daily art', {exact: true}).isChecked(), false);
    for (const target of ['desk-display', 'shelf-display']) {
      const text = await panel.locator('li').filter({hasText: target}).innerText();
      assert.match(text, /appearance completed · succeeded · transmitted/);
    }
  });
  await page.waitForTimeout(1200);
  await page.evaluate(proof => {
    const button = document.createElement('button');button.id = 'schedule-proof-open';button.textContent = 'Synthetic review: inspect submitted rain frames';
    const evidence = document.querySelector('[aria-label="Art schedule evidence"]');if (evidence === null) throw new Error('schedule evidence missing');evidence.append(button);
    button.addEventListener('click', () => {
      const overlay = document.createElement('section');overlay.id = 'schedule-proof-frames';
      Object.assign(overlay.style, {position: 'fixed', inset: '0', zIndex: '9998', background: '#101827', color: '#fff', padding: '24px', overflow: 'auto', fontFamily: 'system-ui'});
      const title = document.createElement('h1');title.textContent = 'Synthetic scheduled rain appearance';overlay.append(title);
      const note = document.createElement('p');note.textContent = `${proof.labels.join(' · ')}. One saved idea; Pixoo 10 s and Tidbyt 30 s. No live device or provider.`;overlay.append(note);
      const grid = document.createElement('div');Object.assign(grid.style, {display: 'flex', gap: '32px', flexWrap: 'wrap'});overlay.append(grid);
      const make = (text: string, width: number, height: number): HTMLCanvasElement => {
        const figure = document.createElement('figure'), caption = document.createElement('figcaption'), canvas = document.createElement('canvas');
        caption.textContent = text;canvas.width = width;canvas.height = height;
        Object.assign(figure.style, {margin: '0', width: 'min(384px, 42vw)'});Object.assign(canvas.style, {width: '384px', maxWidth: '42vw', height: 'auto', imageRendering: 'pixelated', background: '#000'});
        figure.append(caption, canvas);grid.append(figure);return canvas;
      };
      const pixoo = make('Pixoo: exact submitted RGB; all frame hashes match the simulator.', 64, 64);
      const tidbyt = make('Tidbyt: independently decoded frames in the simulator’s color palette.', 64, 32);
      const palette: Record<string, string> = {'.': '#000000', A: '#eab308', a: '#755a04', R: '#ef4444', r: '#772222', G: '#22c55e', g: '#11622f', B: '#3b82f6', b: '#1d417b', W: '#ffffff', w: '#777777'};
      const images = proof.pixoo.frames.map(frame => {const image = new Image();image.src = `data:image/png;base64,${frame.png}`;return image;});
      const draw = (index: number): void => {
        const left = pixoo.getContext('2d'), right = tidbyt.getContext('2d'), image = images[index];
        if (left === null || right === null || image === undefined || !image.complete || image.naturalWidth !== 64) return;
        left.drawImage(image, 0, 0);proof.tidbyt[index]?.forEach((row, y) => {Array.from(row).forEach((color, x) => {right.fillStyle = palette[color] ?? '#ff00ff';right.fillRect(x, y, 1, 1);});});
        overlay.dataset.frame = String(index);overlay.dataset.ready = 'true';
      };
      document.body.append(overlay);
      // Opening the labelled review replaces the long settings view, so the final still keeps this viewport.
      for (const child of Array.from(document.body.children)) {
        if (child instanceof HTMLElement && !['schedule-proof-frames', 'schedule-proof-label', 'schedule-proof-cursor'].includes(child.id)) child.hidden = true;
      }
      void Promise.all(images.map(image => image.decode())).then(() => {
        let frame = 0;draw(frame);
        if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
          const timer = setInterval(() => {if (!overlay.isConnected) {clearInterval(timer);return;}frame = (frame + 1) % images.length;draw(frame);}, 200);
        }
      });
    }, {once: true});
  }, proof);
  await click(page.locator('#schedule-proof-open'), 'Inspect retained native rain frames');
  await page.locator('#schedule-proof-frames[data-ready="true"]').waitFor();
  await t.expect('the recording displays both retained native simulation frame sequences', async () => {
    assert.equal(await page.locator('#schedule-proof-frames canvas').count(), 2);assert.equal(proof.pixoo.frames.length, 8);assert.equal(proof.tidbyt.length, 8);
  });
  await page.waitForTimeout(3700);
  await page.locator('#schedule-proof-label').evaluate(node => {node.textContent = 'Synthetic review complete. Capturing a full-page still. Native simulation is not optical device acceptance.';});
  await page.waitForTimeout(1000);
}
