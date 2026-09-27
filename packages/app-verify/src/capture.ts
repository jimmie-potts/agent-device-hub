// capture: drive the real page in Chromium, assert, and keep a screenshot, a video
// and the assertion log. Only a complete, asserted, finalized capture passes.
import {existsSync} from 'node:fs';
import {mkdir, open, readdir, rename, rm, stat, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {IN_PROGRESS} from './handoff.js';
import {EXIT, Failure, load, UsageError, type Io, type Run} from './lifecycle.js';
import * as systemd from './systemd.js';
import type {AppPlugin, CaptureOutcome, CaptureRecord, CaptureStep, Receipt} from './types.js';
import {errorText, iso} from './util.js';

interface Assertion {
  name: string;
  outcome: 'passed' | 'failed';
  at: string;
  error?: string;
}

interface Finished {
  outcome: CaptureOutcome;
  reason?: string;
  screenshot: boolean;
  video: boolean;
  assertions: Assertion[];
  notes: string[];
  extras: string[];
  partial: string[];
  /** The step's code may still be running (timeout or interrupt), so the process must exit. */
  abandoned?: boolean;
}

class AssertionFailed extends Error {}
class Interrupted extends Error {}

type Chromium = {launch(options: Record<string, unknown>): Promise<{newContext(options: Record<string, unknown>): Promise<unknown>; close(): Promise<void>}>};

/** The consumer's Playwright `chromium`, resolved from the plug-in's root. */
async function loadChromium(plugin: AppPlugin): Promise<{chromium: Chromium} | {reason: string}> {
  const modules = plugin.browser?.modules ?? ['playwright', '@playwright/test'];
  const require = createRequire(join(plugin.root, 'package.json'));
  for (const name of modules) {
    let resolved: string;
    try {
      resolved = require.resolve(name);
    } catch {
      continue;
    }
    const loaded = (await import(pathToFileURL(resolved).href)) as {chromium?: Chromium; default?: {chromium?: Chromium}};
    const chromium = loaded.chromium ?? loaded.default?.chromium;
    if (chromium) return {chromium};
  }
  return {reason: `Playwright is not installed for this checkout (no module exporting chromium among ${modules.map(m => (m.startsWith('/') ? 'a configured path' : m)).join(', ')})`};
}

function tooling(error: unknown): string | undefined {
  const text = errorText(error);
  if (/ffmpeg/i.test(text)) return 'ffmpeg for Playwright video is not installed (npx playwright install chromium)';
  if (/Executable doesn't exist|browserType\.launch.*install|Please run the following command to download new browsers/i.test(text)) return 'the Chromium build for this Playwright is not installed (npx playwright install chromium)';
  return undefined;
}

async function isWebm(path: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  const info = await stat(path);
  if (info.size < 64) return false;
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(4);
    await handle.read(header, 0, 4, 0);
    return header.equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  } finally {
    await handle.close();
  }
}

async function isPng(path: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  const handle = await open(path, 'r');
  try {
    const header = Buffer.alloc(8);
    await handle.read(header, 0, 8, 0);
    return header.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  } finally {
    await handle.close();
  }
}

async function drive(run: Run, receipt: Receipt, step: CaptureStep, dir: string, interrupt: Promise<never>): Promise<Finished> {
  const finished: Finished = {outcome: 'failed', screenshot: false, video: false, assertions: [], notes: [], extras: [], partial: []};
  const loaded = await loadChromium(run.plugin);
  if ('reason' in loaded) return {...finished, outcome: 'unavailable', reason: loaded.reason};
  const viewport = step.viewport ?? {width: 1280, height: 800};
  const raw = join(dir, '.video');
  // Playwright is a peer; its objects are typed loosely, as plug-ins see them.
  let browser: any, context: any, page: any, crashed = false;
  const race = <T>(value: Promise<T>) => Promise.race([value, interrupt]);
  try {
    try {
      browser = await race(loaded.chromium.launch({headless: true}));
    } catch (error) {
      if (error instanceof Interrupted) throw error;
      const missing = tooling(error);
      return missing ? {...finished, outcome: 'unavailable', reason: missing} : {...finished, reason: `browser launch failed: ${errorText(error)}`};
    }
    try {
      context = await race(browser.newContext({viewport, reducedMotion: 'reduce', recordVideo: {dir: raw, size: viewport}}));
      page = await race(context.newPage());
    } catch (error) {
      if (error instanceof Interrupted) throw error;
      const missing = tooling(error);
      return missing ? {...finished, outcome: 'unavailable', reason: missing} : {...finished, reason: `browser context failed: ${errorText(error)}`};
    }
    page.on('crash', () => (crashed = true));
    page.setDefaultTimeout(Math.min(step.timeoutMs ?? 30000, 15000));
    const timeoutMs = step.timeoutMs ?? 30000;
    const signal = AbortSignal.timeout(timeoutMs);
    const preview = receipt.preview!;
    const t = {
      ...run.paths(),
      scenario: receipt.scenario.name,
      url: preview.url,
      port: receipt.owned.port!,
      signal,
      page,
      context,
      async expect(name: string, check: () => unknown) {
        const at = iso();
        try {
          await check();
          finished.assertions.push({name, outcome: 'passed', at});
        } catch (error) {
          finished.assertions.push({name, outcome: 'failed', at, error: errorText(error)});
          throw new AssertionFailed(`${name}: ${errorText(error)}`);
        }
      },
      note(message: string) {
        finished.notes.push(`${iso()} ${message}`);
      },
      async screenshot(name: string) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || name === 'after') throw new Error(`invalid screenshot name ${name}`);
        await page.screenshot({path: join(dir, `${name}.png`), fullPage: true});
        finished.extras.push(`${name}.png`);
      },
    };
    let problem: string | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      await race(Promise.race([
        step.run(t),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`step timed out after ${timeoutMs} ms`)), timeoutMs);
        }),
      ]));
    } catch (error) {
      if (error instanceof Interrupted) throw error;
      problem = error instanceof AssertionFailed ? `assertion failed: ${error.message}` : crashed ? 'the page crashed' : `step error: ${errorText(error)}`;
      if (!(error instanceof AssertionFailed)) finished.abandoned = true;
    } finally {
      clearTimeout(timer);
    }
    // The screenshot of the end state, including a failure's.
    if (!crashed) {
      try {
        await race(page.screenshot({path: join(dir, 'after.png'), fullPage: true, timeout: 10000}));
        finished.screenshot = await isPng(join(dir, 'after.png'));
      } catch (error) {
        if (error instanceof Interrupted) throw error;
      }
    }
    // Playwright writes the video only when the context closes.
    const recorded = page.video();
    try {
      await race(context.close());
    } catch (error) {
      if (error instanceof Interrupted) throw error;
      finished.notes.push(`${iso()} closing the context failed: ${errorText(error)}`);
    }
    context = undefined;
    const source = recorded ? await race(recorded.path() as Promise<string>).catch(() => undefined) : undefined;
    if (source && existsSync(source)) {
      await rename(source, join(dir, 'interaction.webm'));
      finished.video = await isWebm(join(dir, 'interaction.webm'));
    }
    if (crashed) problem = 'the page crashed';
    const failedAssertion = finished.assertions.find(a => a.outcome === 'failed');
    finished.reason = problem
      ?? (failedAssertion ? `assertion failed: ${failedAssertion.name}` : undefined)
      ?? (finished.assertions.length === 0 ? 'no assertions recorded: a screenshot alone never passes' : undefined)
      ?? (!finished.screenshot ? 'the screenshot was not written' : undefined)
      ?? (!finished.video ? 'the video was not finalized' : undefined);
    finished.outcome = finished.reason ? 'failed' : 'passed';
    return finished;
  } finally {
    if (context) await context.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
    if (existsSync(raw)) {
      for (const leftover of await readdir(raw)) finished.partial.push(`.video/${leftover}`);
      if (finished.partial.length === 0) await rm(raw, {recursive: true, force: true});
    }
  }
}

export async function capture(plugin: AppPlugin, io: Io, runId: string | undefined, stepName: string | undefined) {
  const run = await load(plugin, io, runId);
  const step = stepName ? plugin.captureSteps[stepName] : undefined;
  if (!stepName || !step) throw new UsageError(`unknown capture step ${stepName ?? '(none)'}; see help`);
  if (!run.store.exists()) throw new Failure('unknown-run', `no receipt for ${run.runId}`);
  const current = await run.store.read();
  const unit = await systemd.unitState(run.unit);
  if (current.state !== 'running' || !unit?.loaded || unit.active !== 'active' || unit.mainPid !== current.owned.mainPid) throw new Failure('run-not-running', `${run.runId} is not running as its receipt says`);
  if (step.scenario && current.scenario.name !== step.scenario) throw new Failure('scenario-mismatch', `${stepName} expects scenario ${step.scenario}; the run is seeded with ${current.scenario.name}`);

  // Write-ahead: the receipt says `failed` until this capture proves otherwise.
  let record!: CaptureRecord;
  let dirRelative = '';
  const receipt = await run.store.update(async value => {
    const n = Math.max(0, ...value.captures.map(c => c.n)) + 1;
    const set = value.proof.frozenAt ? 'after-handoff' : 'verified';
    dirRelative = set === 'verified' ? `capture-${n}` : `after-handoff/capture-${n}`;
    await mkdir(join(run.store.dir, dirRelative), {recursive: true});
    await writeFile(join(run.store.dir, dirRelative, IN_PROGRESS), String(process.pid));
    record = {n, step: stepName, set, outcome: 'failed', reason: 'interrupted: the capture did not finish', screenshot: null, video: null, log: `${dirRelative}/assertions.json`, startedAt: iso(), finishedAt: null};
    value.captures.push(record);
  });
  const dir = join(run.store.dir, dirRelative);
  await run.store.event('capture-started', {n: record.n, step: stepName, set: record.set});
  io.progress(`${run.runId}: capture ${record.n} (${stepName}) into ${dir}`);

  let signalName: string | undefined;
  let rejectInterrupt!: (error: Error) => void;
  const interrupt = new Promise<never>((_, reject) => (rejectInterrupt = reject));
  interrupt.catch(() => undefined);
  const onSignal = (name: NodeJS.Signals) => {
    signalName ??= name;
    rejectInterrupt(new Interrupted(name));
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  let finished: Finished;
  try {
    finished = await drive(run, receipt, step, dir, interrupt);
  } catch (error) {
    if (!(error instanceof Interrupted)) throw error;
    finished = {outcome: 'failed', reason: `interrupted by ${signalName} before the capture completed`, screenshot: false, video: false, assertions: [], notes: [], extras: [], partial: [], abandoned: true};
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }

  const finishedAt = iso();
  await writeFile(join(dir, 'assertions.json'), JSON.stringify({
    runId: run.runId, n: record.n, step: stepName, description: step.description, scenario: receipt.scenario.name,
    candidate: receipt.build, outcome: finished.outcome, ...(finished.reason ? {reason: finished.reason} : {}),
    assertions: finished.assertions, notes: finished.notes, extraScreenshots: finished.extras, partialArtifacts: finished.partial,
    startedAt: record.startedAt, finishedAt,
  }, null, 2) + '\n');
  const final: CaptureRecord = {
    ...record,
    outcome: finished.outcome,
    screenshot: finished.screenshot ? `${dirRelative}/after.png` : null,
    video: finished.video ? `${dirRelative}/interaction.webm` : null,
    finishedAt,
  };
  if (finished.reason) final.reason = finished.reason;
  else delete final.reason;
  await run.store.update(value => {
    value.captures = value.captures.map(c => (c.n === record.n ? final : c));
  });
  await rm(join(dir, IN_PROGRESS), {force: true});
  await run.store.event('capture-finished', {n: record.n, step: stepName, outcome: final.outcome, ...(final.reason ? {reason: final.reason} : {})});
  io.progress(`${run.runId}: capture ${record.n} ${final.outcome}${final.reason ? `: ${final.reason}` : ''}`);
  const code = final.outcome === 'passed' ? EXIT.ok : final.outcome === 'unavailable' ? EXIT.unavailable : EXIT.failed;
  const absolute = (path: string | null) => (path === null ? null : join(run.store.dir, path));
  return {code, exitSoon: finished.abandoned === true, value: {operation: 'capture', runId: run.runId, n: final.n, step: stepName, set: final.set, outcome: final.outcome, ...(final.reason ? {reason: final.reason} : {}), screenshot: absolute(final.screenshot), video: absolute(final.video), log: absolute(final.log), captureDir: dir}};
}
