// capture: drive the real page in Chromium, assert, and keep a screenshot, a video
// and the assertion log. Only a complete, asserted, finalized capture passes.
import {existsSync} from 'node:fs';
import {mkdir, open, readdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {IN_PROGRESS, marker} from './handoff.js';
import {resolveInputs} from './inputs.js';
import {EXIT, Failure, has, load, reseed, reseedInputs, UsageError, type Io} from './lifecycle.js';
import {artifactDigest} from './roots.js';
import * as systemd from './systemd.js';
import type {AppPlugin, CaptureOutcome, CaptureRecord, CaptureStep, CaptureStepOptions, CaptureStepResult} from './types.js';
import {errorText, iso, loopback, redact} from './util.js';

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
  /** Extra files in the capture directory: `t.screenshot` PNGs and `t.attach` files. */
  attachments: string[];
  partial: string[];
  /** The step's code may still be running (timeout or interrupt), so the process must exit. */
  abandoned?: boolean;
}

class AssertionFailed extends Error {}

/** A plain file name: no separators, no dotfiles. */
const ATTACHMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RESERVED = new Set(['after.png', 'interaction.webm', 'assertions.json']);
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

/** An EBML variable-length integer at `at`: its value (marker kept for IDs) and length. */
function vint(bytes: Buffer, at: number, id: boolean): {value: number; length: number; unknown: boolean} | undefined {
  const first = bytes[at];
  if (first === undefined || first === 0) return undefined;
  let length = 1, mask = 0x80;
  while (!(first & mask)) {
    mask >>= 1;
    length++;
  }
  if (at + length > bytes.length) return undefined;
  let value = id ? first : first & (mask - 1), allOnes = (first & (mask - 1)) === mask - 1;
  for (let k = 1; k < length; k++) {
    value = value * 256 + bytes[at + k];
    if (bytes[at + k] !== 0xff) allOnes = false;
  }
  return {value, length, unknown: !id && allOnes};
}

/**
 * A finalized WebM: an EBML header followed by a Segment whose size is known
 * and ends exactly at the end of the file, with Cues. An encoder that crashed
 * or was never closed leaves an unknown size, a truncated Segment or no Cues.
 */
async function isFinalizedWebm(path: string): Promise<boolean> {
  if (!existsSync(path)) return false;
  const bytes = await readFile(path);
  const header = vint(bytes, 0, true);
  if (!header || header.value !== 0x1a45dfa3) return false;
  const headerSize = vint(bytes, header.length, false);
  if (!headerSize || headerSize.unknown) return false;
  const segmentAt = header.length + headerSize.length + headerSize.value;
  const segment = vint(bytes, segmentAt, true);
  if (!segment || segment.value !== 0x18538067) return false;
  const size = vint(bytes, segmentAt + segment.length, false);
  if (!size || size.unknown) return false;
  const start = segmentAt + segment.length + size.length;
  return start + size.value === bytes.length && bytes.indexOf(Buffer.from([0x1c, 0x53, 0xbb, 0x6b]), start) > 0;
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

/** What a step sees of the application it drives. */
interface Target {
  runId: string;
  root: string;
  runtimeDir: string;
  dataDir: string;
  scenario: string;
  url: string;
  port: number;
  inputs: Readonly<Record<string, string>>;
  endpoints: Readonly<Record<string, string>>;
  /** The candidate's `build.artifactDigest` from start; `null` when there is none to compare. */
  artifactDigest: string | null;
}

/**
 * Why the served artifact is not the candidate the run recorded, or
 * `undefined` when it is (or there is no recorded digest). Several runs of
 * one checkout serve the same build on disk, so another run's rebuild can
 * change what this one serves.
 */
async function servedDrift(plugin: AppPlugin, target: Target): Promise<string | undefined> {
  if (target.artifactDigest === null) return undefined;
  let served: string;
  try {
    served = await artifactDigest(plugin, target.url, AbortSignal.timeout(15000));
  } catch (error) {
    return `the served artifact could not be re-read (${errorText(error)})`;
  }
  return served === target.artifactDigest ? undefined : `the served artifact changed since start (recorded ${target.artifactDigest}, served ${served})`;
}

/** Drive one step in a fresh recorded context and judge it. Shared by `capture` and `runCaptureStep`. */
async function drive(plugin: AppPlugin, step: CaptureStep, target: Target, dir: string, interrupt: Promise<never>): Promise<Finished> {
  const finished: Finished = {outcome: 'failed', screenshot: false, video: false, assertions: [], notes: [], attachments: [], partial: []};
  // Never drive another candidate under this run's name: the step would prove nothing about the recorded build.
  const changed = await Promise.race([servedDrift(plugin, target), interrupt]);
  if (changed) return {...finished, reason: changed};
  const loaded = await loadChromium(plugin);
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
    const t = {
      ...target,
      signal,
      page,
      context,
      async expect(name: string, check: () => unknown) {
        const at = iso();
        let result: unknown;
        try {
          result = await check();
        } catch (error) {
          finished.assertions.push({name, outcome: 'failed', at, error: errorText(error)});
          throw new AssertionFailed(`${name}: ${errorText(error)}`);
        }
        // A predicate such as isVisible() that answers false is a failed observation, never a pass.
        if (result === false) {
          finished.assertions.push({name, outcome: 'failed', at, error: 'check returned false'});
          throw new AssertionFailed(`${name}: check returned false`);
        }
        finished.assertions.push({name, outcome: 'passed', at});
      },
      note(message: string) {
        finished.notes.push(`${iso()} ${message}`);
      },
      async screenshot(name: string) {
        if (!/^[a-z0-9][a-z0-9-]*$/.test(name) || name === 'after') throw new Error(`invalid screenshot name ${name}`);
        const file = `${name}.png`;
        if (existsSync(join(dir, file))) throw new Error(`${file} already exists in this capture`);
        await page.screenshot({path: join(dir, file), fullPage: true});
        finished.attachments.push(file);
      },
      async attach(name: string, content: string | Uint8Array) {
        if (!ATTACHMENT.test(name) || RESERVED.has(name)) throw new Error(`invalid attachment name ${name}: use a plain file name that is not ${[...RESERVED].join(', ')}`);
        if (existsSync(join(dir, name))) throw new Error(`${name} already exists in this capture`);
        const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
        if (bytes.byteLength > 16 * 1024 * 1024) throw new Error(`attachment ${name} is larger than 16 MB`);
        await writeFile(join(dir, name), bytes, {flag: 'wx'});
        finished.attachments.push(name);
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
    let closed = true;
    try {
      await race(context.close());
    } catch (error) {
      if (error instanceof Interrupted) throw error;
      // The recorder writes the file on close; a failed close never counts as finalized.
      closed = false;
      finished.notes.push(`${iso()} closing the context failed: ${errorText(error)}`);
    }
    context = undefined;
    const source = recorded ? await race(recorded.path() as Promise<string>).catch(() => undefined) : undefined;
    if (closed && source && existsSync(source)) {
      await rename(source, join(dir, 'interaction.webm'));
      finished.video = await isFinalizedWebm(join(dir, 'interaction.webm'));
      if (!finished.video) {
        await rename(join(dir, 'interaction.webm'), join(dir, 'interaction.unfinalized.webm'));
        finished.partial.push('interaction.unfinalized.webm');
      }
    }
    if (crashed) problem = 'the page crashed';
    // A rebuild during the step means its observations may belong to another candidate.
    const changedDuring = await race(servedDrift(plugin, target));
    const failedAssertion = finished.assertions.find(a => a.outcome === 'failed');
    finished.reason = changedDuring
      ?? problem
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

/**
 * Write the assertion log. With `roots` (a supervised capture, whose log
 * handoff freezes as proof), assertion errors, notes and the reason are
 * redacted as the receipt's reason is.
 */
async function writeLog(dir: string, fields: Record<string, unknown>, finished: Finished, roots?: {runtime: string; proof: string}): Promise<void> {
  const clean = (text: string) => (roots ? redact(text, roots) : text);
  await writeFile(join(dir, 'assertions.json'), JSON.stringify({
    ...fields, outcome: finished.outcome, ...(finished.reason ? {reason: clean(finished.reason)} : {}),
    assertions: finished.assertions.map(a => (a.error === undefined ? a : {...a, error: clean(a.error)})), notes: finished.notes.map(clean), attachments: finished.attachments, partialArtifacts: finished.partial,
    finishedAt: iso(),
  }, null, 2) + '\n');
}

/**
 * Drive one capture step against an application that is already running,
 * without a supervisor, receipt or lease: the same assertion, screenshot,
 * video and failure rules as `capture`. For CI hosts without `systemd --user`,
 * so an adapter can still prove that its reference passes and its `control-*`
 * steps fail.
 */
export async function runCaptureStep(plugin: AppPlugin, stepName: string, options: CaptureStepOptions): Promise<CaptureStepResult> {
  if (!has(plugin.captureSteps, stepName)) throw new Error(`unknown capture step ${stepName}`);
  const step = plugin.captureSteps[stepName];
  const url = loopback(options.url);
  if (typeof url === 'string') throw new Error(`runCaptureStep needs an http://127.0.0.1:<port>/ URL without credentials, a query or a fragment; it got ${url}`);
  if (existsSync(options.outputDir) && (await readdir(options.outputDir)).length > 0) throw new Error('runCaptureStep needs a new or empty output directory');
  await mkdir(options.outputDir, {recursive: true});
  const scenario = options.scenario ?? plugin.defaultScenario;
  if (step.scenario && step.scenario !== scenario) throw new Error(`${stepName} is pinned to scenario ${step.scenario}; the application was seeded with ${scenario}`);
  // The same rules as `start`: declared, not secret-like, printable ASCII, required ones present.
  const inputs = Object.freeze(resolveInputs(plugin, options.inputs ?? {}, {}, scenario));
  const endpoints: Record<string, string> = {};
  for (const [name, value] of Object.entries(options.endpoints ?? {})) {
    const endpoint = loopback(value, true);
    if (typeof endpoint === 'string') throw new Error(`runCaptureStep needs exactly http://127.0.0.1:<port>/ for endpoint ${name}; it got ${endpoint}`);
    endpoints[name] = endpoint.href;
  }
  if (options.artifactDigest !== undefined && !/^sha256:[0-9a-f]{64}$/.test(options.artifactDigest)) throw new Error('runCaptureStep needs artifactDigest as sha256:<64 hex>, as the receipt records it');
  const target: Target = {runId: options.runId ?? `${plugin.app}-unmanaged`, root: plugin.root, runtimeDir: options.runtimeDir ?? '', dataDir: options.dataDir ?? '', scenario, url: url.href, port: Number(url.port), inputs, endpoints: Object.freeze(endpoints), artifactDigest: options.artifactDigest ?? null};
  const startedAt = iso();
  const finished = await drive(plugin, step, target, options.outputDir, new Promise<never>(() => undefined));
  await writeLog(options.outputDir, {runId: target.runId, step: stepName, description: step.description, scenario, supervised: false, startedAt}, finished);
  return {
    outcome: finished.outcome,
    ...(finished.reason ? {reason: finished.reason} : {}),
    screenshot: finished.screenshot ? join(options.outputDir, 'after.png') : null,
    video: finished.video ? join(options.outputDir, 'interaction.webm') : null,
    log: join(options.outputDir, 'assertions.json'),
    attachments: finished.attachments.map(name => join(options.outputDir, name)),
    assertions: finished.assertions.map(a => ({...a})),
  };
}

export async function capture(plugin: AppPlugin, io: Io, runId: string | undefined, stepName: string | undefined) {
  if (!stepName || !has(plugin.captureSteps, stepName)) throw new UsageError(`unknown capture step ${stepName ?? '(none)'}; see help`);
  const step = plugin.captureSteps[stepName];
  const run = await load(plugin, io, runId);
  if (!run.store.exists()) throw new Failure('unknown-run', `no receipt for ${run.runId}`);
  const current = await run.store.read();
  const unit = await systemd.unitState(run.unit);
  if (current.state !== 'running' || !unit?.loaded || unit.active !== 'active' || unit.mainPid !== current.owned.mainPid) throw new Failure('run-not-running', `${run.runId} is not running as its receipt says`);
  if (step.scenario && !step.fresh && current.scenario.name !== step.scenario) throw new Failure('scenario-mismatch', `${stepName} expects scenario ${step.scenario}; the run is seeded with ${current.scenario.name}`);

  // A fresh step starts from newly seeded state: stop, reseed and relaunch on the same port first, with the recorded inputs.
  let fresh: {scenario: string; seededAt?: string; failed?: string} | undefined;
  if (step.fresh) {
    const name = step.scenario ?? current.scenario.name;
    const inputs = reseedInputs(plugin, current, name);
    io.progress(`${run.runId}: reseeding ${name} for fresh step ${stepName}`);
    const reseeded = await reseed(run, io, current, name, inputs);
    fresh = reseeded.code === EXIT.ok ? {scenario: name, seededAt: reseeded.value.seededAt as string} : {scenario: name, failed: `${reseeded.value.detail}`};
  }

  // Write-ahead: the receipt says `failed` until this capture proves otherwise.
  let record!: CaptureRecord;
  let dirRelative = '';
  const receipt = await run.store.update(async value => {
    const n = Math.max(0, ...value.captures.map(c => c.n)) + 1;
    const set = value.proof.frozenAt ? 'after-handoff' : 'verified';
    dirRelative = set === 'verified' ? `capture-${n}` : `after-handoff/capture-${n}`;
    await mkdir(join(run.store.dir, dirRelative), {recursive: true});
    await writeFile(join(run.store.dir, dirRelative, IN_PROGRESS), await marker(process.pid));
    record = {n, step: stepName, scenario: fresh?.scenario ?? value.scenario.name, ...(fresh && !fresh.failed ? {fresh: true as const} : {}), set, outcome: 'failed', reason: 'interrupted: the capture did not finish', screenshot: null, video: null, log: `${dirRelative}/assertions.json`, startedAt: iso(), finishedAt: null};
    value.captures.push(record);
  });
  const dir = join(run.store.dir, dirRelative);
  await run.store.event('capture-started', {n: record.n, step: stepName, set: record.set, ...(fresh ? {fresh} : {})});
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
    if (fresh?.failed) finished = {outcome: 'failed', reason: `fresh reseed failed, the run was stopped: ${fresh.failed}`, screenshot: false, video: false, assertions: [], notes: [], attachments: [], partial: []};
    else finished = await drive(plugin, step, {...run.paths(), scenario: receipt.scenario.name, url: receipt.preview!.url, port: receipt.owned.port!, inputs: Object.freeze({...receipt.inputs}), endpoints: Object.freeze({...receipt.owned.endpoints}), artifactDigest: receipt.build.artifactDigest}, dir, interrupt);
  } catch (error) {
    if (!(error instanceof Interrupted)) throw error;
    finished = {outcome: 'failed', reason: `interrupted by ${signalName} before the capture completed`, screenshot: false, video: false, assertions: [], notes: [], attachments: [], partial: [], abandoned: true};
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }

  // The reason is recorded in the receipt and events: no absolute path outside the two roots.
  if (finished.reason) finished.reason = redact(finished.reason, run.roots);
  const finishedAt = iso();
  await writeLog(dir, {runId: run.runId, n: record.n, step: stepName, description: step.description, scenario: receipt.scenario.name, candidate: receipt.build, ...(fresh ? {fresh} : {}), supervised: true, startedAt: record.startedAt}, finished, run.roots);
  const final: CaptureRecord = {
    ...record,
    outcome: finished.outcome,
    screenshot: finished.screenshot ? `${dirRelative}/after.png` : null,
    video: finished.video ? `${dirRelative}/interaction.webm` : null,
    ...(finished.attachments.length ? {attachments: finished.attachments.map(name => `${dirRelative}/${name}`)} : {}),
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
  return {code, exitSoon: finished.abandoned === true, value: {operation: 'capture', runId: run.runId, n: final.n, step: stepName, set: final.set, outcome: final.outcome, ...(final.reason ? {reason: final.reason} : {}), screenshot: absolute(final.screenshot), video: absolute(final.video), log: absolute(final.log), attachments: (final.attachments ?? []).map(path => join(run.store.dir, path)), captureDir: dir}};
}
