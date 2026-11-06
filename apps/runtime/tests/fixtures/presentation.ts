import type {ArtRecord} from '@jimmie-potts/event-contracts/v2/art-state';
import type {BunnyModule, Cancel, SyncedCopy} from '@jimmie-potts/sdk';
import type {CoreModule} from '../../src/core/core.js';
import type {ArtPlan, ArtPlanResult} from '../../src/core/art-plans.js';
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';

export type SharedArtFixture = {ready: boolean; plan?: ArtPlan; result?: ArtPlanResult | ErrorBody; duplicates: number; failure?: string};

/** An explicitly seeded synthetic caller of the real internal control, never shipped or reachable as a command. */
export function createPresentationFixture(core: () => CoreModule | undefined): BunnyModule {
  let copy: SyncedCopy<ArtRecord> | undefined, closed = false, fresh = false, retry: Cancel | undefined;
  const seen = new Set<string>();
  const state: SharedArtFixture = {ready: false, duplicates: 0};
  return {
    manifest: {name: 'presentation-fixture', apiVersion: '1.3', content: ref => ref === 'result'
      ? {type: 'application/json', bytes: Buffer.from(JSON.stringify(state))} : undefined},
    start: async context => {
      const execute = (plan: ArtPlan): void => {
        const controls = core()?.automation.art;
        if (controls === undefined) throw new Error('synthetic-art-controls-missing');
        void controls.present(plan, () => closed ? errorBody('cancelled') : undefined).then(result => {state.result = result;}, () => {state.failure = 'presentation failed';});
      };
      const inspect = (record: ArtRecord): void => {
        if (closed) return;
        for (const job of record.jobs) {
          if (!fresh) {seen.add(job.requestId);continue;}
          if (job.requestId !== 'shared-art-seed' || job.status !== 'finished' || seen.has(job.requestId)) continue;
          seen.add(job.requestId);
          const artwork = record.artworks.find(value => value.artworkId === job.artworkId);
          if (artwork === undefined) {state.failure = 'synthetic artwork missing';continue;}
          const browser = artwork.compositions.find(value => value.target === 'ui' && value.outcome === 'succeeded');
          const displays = (core()?.automation.art?.targets() ?? []).flatMap(({target, kind}) => {
            const composition = artwork.compositions.find(value => value.target === kind && value.outcome === 'succeeded');
            return composition?.compositionId == null ? [] : [{target, compositionId: composition.compositionId, durationMs: kind === 'tidbyt' ? 30_000 : 4000}];
          });
          if (browser?.compositionId == null || displays.length !== 2) {state.failure = 'synthetic compositions or targets missing';continue;}
          const now = context.clock.now();
          state.plan = {id: 'shared-art-plan', artworkId: artwork.artworkId, startAtMs: now + 5000, prepareUntilMs: now + 4000,
            toleranceMs: 1000, mood: 'celebrate', priorityClass: 'event', coversStatus: true, displays, browser: {compositionId: browser.compositionId}};
          execute(state.plan);
        }
        if (fresh && state.plan !== undefined && state.duplicates === 0 && record.artworks.some(value => value.artworkId === state.plan?.artworkId && value.favorite)) {
          state.duplicates++;execute(state.plan);
        }
      };
      let attempts = 0;
      const connect = async (): Promise<void> => {
        const answer = await context.sdk.sync<ArtRecord>(['art'], change => {
          if (change.type === 'updated') inspect(change.message.data);
          else if (change.type === 'synced') fresh = true;
          else if (change.type === 'failed') {fresh = false;state.failure = 'art copy failed';}
        }, {owner: 'bunny/modules/art', timeoutMs: 5000, onRestarted: () => {fresh = false;}});
        if (answer.status !== 'synced') {
          if (!closed && answer.error.error.code === 'unavailable' && ++attempts < 5) retry = context.scheduler.after(250, connect);
          else state.failure = `synthetic art sync refused ${answer.error.error.code}`;
          return;
        }
        if (closed) {await answer.copy.close();return;}
        copy = answer.copy;state.ready = true;
      };
      await connect();
    },
    stop: async () => {closed = true;retry?.();await copy?.close();},
  };
}
