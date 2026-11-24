// Hub #1900: a timed-out step of the Pixoo command-limits capture names the step, its action and locator, the last step
// that completed, the types of the page's uncaught errors and what the page showed. A synthetic stand-in page serves the journey's
// first controls. In the first case its Animate button is never enabled, so the capture's click on it times out. In the
// second, Animate throws an uncaught error and removes the page, as the dashboard's root does after an uncaught render
// error, so the wait for the animating preview times out.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {test, type TestContext} from 'node:test';
import {chromium} from 'playwright';
import type {CaptureContext} from '@jimmie-potts/app-verify';
import {capturePixooCommandLimits} from '../pixoo-command-limits-browser.js';

const page = (crash: boolean): string => `<!doctype html><title>Synthetic Pixoo library</title><main id="main" data-feed="connected">
<section aria-label="Pixoo library"><p role="status">Synthetic stand-in</p><table><tbody>
<tr><td>Synthetic 1001-frame animation</td><td><button type="button" aria-label="Inspect Synthetic 1001-frame animation">Inspect</button></td></tr>
</tbody></table></section></main>
<script>document.querySelector('button').addEventListener('click', () => {
  const aside = document.createElement('aside'); aside.setAttribute('aria-label', 'Selected media');
  aside.innerHTML = '<canvas role="img" aria-label="Effective preview" width="64" height="64"></canvas><p>64 × 64 · 1001 frames</p>'
    + '<button type="button"${crash ? '' : ' disabled'}>Animate preview</button>';
  aside.querySelector('button').addEventListener('click', () => {
    setTimeout(() => {document.querySelector('main').remove(); throw new DOMException('synthetic: the image source is detached', 'InvalidStateError');}, 50);
  });
  document.querySelector('section').append(aside);
});</script>`;

/** Runs the capture against the stand-in and returns its failure, the capture log's notes and the passed expectations. */
async function failedCapture(context: TestContext, crash: boolean): Promise<{text: string; notes: string[]; expected: string[]}> {
  const server = createServer((_, response) => {response.writeHead(200, {'content-type': 'text/html; charset=utf-8'}).end(page(crash));});
  server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch();
  context.after(() => browser.close());
  const tab = await browser.newPage();
  // The capture's waits keep their configured length; only this stand-in shortens the default so the test is quick.
  tab.setDefaultTimeout(1500);
  const notes: string[] = [], expected: string[] = [];
  const t = {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, page: tab,
    note: (message: string) => {notes.push(message);},
    expect: async (name: string, check: () => unknown) => {await check(); expected.push(name);},
  } as unknown as CaptureContext;
  const failure = await capturePixooCommandLimits(t).then(() => undefined, (error: unknown) => error);
  assert.ok(failure instanceof Error, 'the stand-in fails the capture');
  assert.equal(failure.message.split('\n').length, 1, 'the failure is one line, as the capture reason keeps only the first');
  assert.deepEqual(expected, ['the library preview displays the complete animation'], 'the steps before the timeout passed');
  assert.deepEqual(notes, [failure.message], 'the capture log notes the same failure');
  return {text: failure.message, notes, expected};
}

void test('a timed-out click names its step, action, locator, the last completed step and the page state', {timeout: 60_000}, async context => {
  const {text} = await failedCapture(context, false);
  assert.match(text, /^Animate the library preview: click getByRole\('button', \{ name: 'Animate preview' \}\) failed after "See the preview canvas" \(TimeoutError\); no uncaught page error; /);
  // The page state follows, with the preview card's frame count, canvas and the disabled control.
  assert.match(text, /; page \{"route":"#\/module\/pixoo\/library","feed":"connected",.*"preview":\{"status":\[\],"frames":"1001 frames","canvas":true,"buttons":\["Animate preview\(disabled\)"\]\},"settings":"absent"\}$/);
  assert.ok(text.indexOf('; page ') < 488, 'the step, action, locator and error type fit in the 500 characters the capture reason keeps');
  assert.equal(text.includes('1500ms'), false, 'the timeout\'s message is not quoted, only its type');
});

void test('a wait that times out after an uncaught page error names the error before the page state', {timeout: 60_000}, async context => {
  const {text} = await failedCapture(context, true);
  assert.match(text, /^See the preview animating: waitFor getByRole\('button', \{ name: 'Pause preview' \}\) failed after "Animate the library preview" \(TimeoutError\); uncaught page errors \["InvalidStateError"\]; page \{"route":"#\/module\/pixoo\/library","feed":"no main","library":"absent",/);
  assert.ok(text.indexOf('"feed":"no main"') < 488, 'the error type and the missing page fit in the 500 characters the capture reason keeps');
  assert.equal(text.includes('synthetic: the image source is detached'), false, 'the page error\'s message is not quoted, only its type');
});
