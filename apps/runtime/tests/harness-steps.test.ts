// How the in-memory scenario harness steps virtual time through a wait (Hub #1684): a long wait skips the steps at
// which no timer is due, and every timer still fires at the same virtual instant and in the same order as when the wait
// takes one 10 ms step at a time, as it did before.
import assert from 'node:assert/strict';
import {LONG_STEP_MS, LONG_WAIT_MS, STEP_MS, stepOf, stepThrough} from './scenarios/stepping.js';
import {it, manualClock} from './support.js';

type Clock = ReturnType<typeof manualClock>;

/** The harness's previous wait: one `STEP_MS` step at a time, with real work's turn after each. */
async function fineSteps(clock: Clock, ms: number, ready: () => Promise<void>, turn: () => Promise<void>): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += STEP_MS) {
    await ready();
    clock.advance(Math.min(STEP_MS, ms - elapsed));
    await turn();
  }
}

/** A small deterministic generator, so each seed gives the same timers. */
function random(seed: number): (below: number) => number {
  let state = seed;
  return below => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state % below;
  };
}

/**
 * Runs one wait of `ms` with seeded timers that re-arm, chain at zero delay and cancel one another, and with work that a
 * fired timer starts and that schedules its own timer at the next turn, as real I/O does. Returns every firing's
 * virtual time, offset from the wait's start, and name, in order, with the steps the wait took.
 */
async function firings(stepper: typeof fineSteps, seed: number, ms: number, offset: number): Promise<{fired: string[]; steps: number; end: number}> {
  const clock = manualClock();
  clock.advance(offset);
  const start = clock.now();
  const next = random(seed);
  const fired: string[] = [];
  const cancels = new Map<string, () => void>();
  const turnWork: string[] = [];
  let steps = 0;
  const arm = (name: string, delayMs: number, again: number): void => {
    cancels.set(name, clock.scheduler.after(delayMs, () => {
      fired.push(`${String(clock.now() - start)} ${name}`);
      const roll = next(6);
      if (roll === 0) arm(`${name}.0`, 0, 0);
      if (roll === 1) turnWork.push(name);
      if (roll === 2) cancels.get(`t${String(next(8))}`)?.();
      if (again > 0) arm(name, [1, 3, 7, 10, 15, 95, 100, 101, 250, 999, 1000, 5000][next(12)] ?? 1, again - 1);
    }));
  };
  for (let index = 0; index < 8; index += 1) arm(`t${String(index)}`, next(ms + 200), 4 + next(6));
  await stepper(clock, ms, () => Promise.resolve(), () => {
    steps += 1;
    for (const name of turnWork.splice(0)) arm(`${name}.io`, next(30), 0);
    return Promise.resolve();
  });
  return {fired, steps, end: clock.now() - start};
}

it('a long wait fires every timer at the virtual instant and in the order that one fine step at a time gives', async () => {
  for (const ms of [LONG_WAIT_MS + 1, 2500, 30_000, 61_234]) {
    for (const offset of [0, 3]) {
      for (let seed = 1; seed <= 40; seed += 1) {
        const fine = await firings(fineSteps, seed, ms, offset);
        const long = await firings(stepThrough, seed, ms, offset);
        assert.ok(fine.fired.length > 0, 'the seed fires timers');
        assert.deepEqual(long.fired, fine.fired, `seed ${String(seed)}, a ${String(ms)} ms wait from offset ${String(offset)}`);
        assert.equal(long.end, ms);
        assert.ok(long.steps <= fine.steps, 'skipping never adds a step');
      }
    }
  }
});

it('a wait no longer than the threshold takes every fine step', async () => {
  for (const ms of [STEP_MS, 15, 500, LONG_WAIT_MS]) {
    for (let seed = 1; seed <= 10; seed += 1) {
      const fine = await firings(fineSteps, seed, ms, 0);
      const short = await firings(stepThrough, seed, ms, 0);
      assert.deepEqual(short, fine);
    }
  }
});

it('a long wait with no timer due moves in long steps, and lands on its end', async () => {
  const clock = manualClock();
  const start = clock.now();
  const moments: number[] = [];
  await stepThrough(clock, 30_005, () => Promise.resolve(), () => { moments.push(clock.now() - start); return Promise.resolve(); });
  assert.equal(moments.length, 301);
  assert.equal(moments[0], LONG_STEP_MS);
  assert.equal(moments.at(-2), 30_000);
  assert.equal(moments.at(-1), 30_005);
});

it('a long wait stops at the grid point where the next timer fires', () => {
  assert.equal(stepOf(0, LONG_WAIT_MS, undefined), STEP_MS, 'a wait at the threshold is short');
  assert.equal(stepOf(0, 5000, undefined), LONG_STEP_MS);
  assert.equal(stepOf(0, 5000, 345), LONG_STEP_MS, 'a timer beyond the long step');
  assert.equal(stepOf(300, 5000, 345), 50, 'the grid point at or after the timer');
  assert.equal(stepOf(300, 5000, 340), 40, 'a timer on a grid point');
  assert.equal(stepOf(300, 5000, 300), STEP_MS, 'a timer due now fires at the next grid point');
  assert.equal(stepOf(300, 5000, 120), STEP_MS, 'as does one already overdue');
  assert.equal(stepOf(4950, 5000, undefined), 50, 'the last step ends the wait');
  assert.equal(stepOf(4990, 4995, 4999), 5, 'a timer past the end waits for a later wait');
});
