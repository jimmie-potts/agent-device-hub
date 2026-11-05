// Hosts the module on an in-process bus with fake providers, as the runtime would host it. Commands go out on the real
// `v2/art` families from `bunny/core`, the only sender a responder admits.
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {TestContext} from 'node:test';
import type {ArtState} from '@jimmie-potts/event-contracts/v2/art-state';
import {InProcessBus} from '@jimmie-potts/sdk';
import {ModuleHarness} from '@jimmie-potts/sdk/testing';
import {RecordedSpans} from '@jimmie-potts/sdk/testing';
import {createArtModule, type ArtModuleOptions} from '../src/module.js';

export type Hosted = Awaited<ReturnType<typeof hosted>>;
export const USD = 1_000_000;
export const usdLimits = (monthlyCeilingUsd: number, dailyPaceUsd = 5) => ({monthlyCeilingUsd, dailyPaceUsd});

/** No core or weather owner is on the bus unless a test adds one, so the default seams stay quiet. */
type HostOptions = ArtModuleOptions & {section?: unknown; now?: number; dir?: string; secrets?: Readonly<Record<string, string>>};
/** Starts the module. `restart` stops it and starts a new one on the same files. */
export async function hosted(t: TestContext, options: HostOptions = {}) {
  const dir = options.dir ?? await mkdtemp(join(tmpdir(), 'art-module-'));
  const clock = {value: options.now ?? new Date(2026, 10, 3, 12).getTime(), now(): number {return this.value;}};
  const bus = new InProcessBus({now: () => clock.value}), operator = bus.connect('bunny/core'), spans = new RecordedSpans();
  let state: ArtState | undefined;
  const outcomes: {subject: string; type: string; data: {requestId: string; result: string; evidence: string}}[] = [];
  await operator.subscribe<ArtState>('bunny.state.art.art', message => {state = message.data;});
  await operator.subscribe<{requestId: string; result: string; evidence: string}>('bunny.event.art-request.art', message => {outcomes.push({subject: message.subject, type: message.type, data: message.data});});
  await operator.subscribe<{requestId: string; result: string; evidence: string}>('bunny.event.art-catalog-edit.art', message => {outcomes.push({subject: message.subject, type: message.type, data: message.data});});
  await operator.subscribe<{requestId: string; result: string; evidence: string}>('bunny.event.art-auto.art', message => {outcomes.push({subject: message.subject, type: message.type, data: message.data});});
  let module = createArtModule(options);
  const make = (): ModuleHarness => {
    module = createArtModule(options);
    return new ModuleHarness(module, {bus, clock: {now: () => clock.value}, stateDir: dir, spans, section: options.section ?? {}, ...(options.secrets === undefined ? {} : {secrets: options.secrets})});
  };
  const read = async (ref: string, query: Record<string, string> = {}) => {
    const answer = await module.manifest.content?.(ref, {query, signal: new AbortController().signal});
    return answer;
  };
  const readJson = async <T>(ref: string, query: Record<string, string> = {}): Promise<T> => {
    const answer = await read(ref, query);
    assert.ok(answer !== undefined && !('error' in answer), `content ${ref}`);
    return JSON.parse(Buffer.from(answer.bytes).toString()) as T;
  };
  let host = make(), stopped = false;
  t.after(async () => {if (!stopped) await host.stop(); await operator.close(); if (options.dir === undefined) await rm(dir, {recursive: true, force: true});});
  await host.start();
  const value = {
    dir, clock, bus, operator, spans,
    get host(): ModuleHarness {return host;},
    get state(): ArtState {return state ?? assert.fail('no art state yet');},
    outcomes,
    owner: (data: object, requestId: string) => operator.request('bunny.cmd.art-request.art', {type: 'org.bunny.art.request.requested', subject: 'art', dataschema: 'https://bunny.invalid/events/art-request/2.0', data}, {requestId, timeoutMs: 2000}),
    automatic: (data: object, requestId: string) => operator.request('bunny.cmd.art-auto.art', {type: 'org.bunny.art.auto.requested', subject: 'art', dataschema: 'https://bunny.invalid/events/art-auto/2.0', data}, {requestId, timeoutMs: 2000}),
    catalog: (data: object, requestId: string) => operator.request('bunny.cmd.art-catalog-edit.art', {type: 'org.bunny.art-catalog.edit.requested', subject: 'art', dataschema: 'https://bunny.invalid/events/art-catalog-edit/2.0', data}, {requestId, timeoutMs: 2000}),
    job: (requestId: string) => state?.jobs.find(job => job.requestId === requestId),
    finished: async (requestId: string) => {
      await until(() => state?.jobs.find(job => job.requestId === requestId)?.status === 'finished', `job ${requestId} finishes`);
      return state?.jobs.find(job => job.requestId === requestId) ?? assert.fail('no job');
    },
    spend: (provider: 'openai' | 'anthropic') => state?.providers.find(entry => entry.provider === provider) ?? assert.fail('no provider'),
    calls: async () => (await readJson<{calls: LedgerCall[]}>('ledger')).calls,
    restart: async () => {await host.stop(); host = make(); await host.start();},
    stop: async () => {stopped = true; await host.stop();},
    db: () => host.moduleDatabase() ?? assert.fail('no database'),
    read, readJson,
  };
  return value;
}
export type LedgerCall = {requestId: string; status: string; provider: string; target: string; costMicros: number | null; reservedMicros: number};
export async function until(check: () => boolean, what = 'the condition'): Promise<void> {
  const deadline = Date.now() + 8000;
  while (!check() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 3));
  assert.equal(check(), true, `timed out waiting for ${what}`);
}
/** A promise and its two handles, for a provider call a test holds open. */
export function gate<T = void>() {
  let open!: (value: T) => void, fail!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {open = resolve; fail = reject;});
  return {promise, open, fail};
}
