import assert from 'node:assert/strict';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import type {SimulationOptions} from '@jimmie-potts/sdk';
import {registration, SimulatedRoborock, type VacuumStatus} from '@jimmie-potts/roborock';
import {registrations} from '../../src/index.js';
import {it} from '../support.js';
import {runScenario, scenario, TRANSPORTS} from './catalog.js';
import {startMemoryHarness} from './memory.js';

const selected = scenario('roborock-observations');
assert.ok(selected);
const PRESERVATION = 'unavailable input preserves retained history and original observation time';

for (const transport of TRANSPORTS) {
  it(`Roborock scenario waits for a bounded recovery read over ${transport}`, async () => {
    let delayedReads = 0;
    const simulation = registration.simulation;
    assert.ok(simulation);
    const delayed = {...registration, simulation: {...simulation, memory: {...simulation.memory, create(options: SimulationOptions) {
      const device = new SimulatedRoborock(options.now);
      const action = device.action.bind(device), read = device.readStatus.bind(device);
      let recovering = false, delayNext = false;
      device.action = value => {
        if (value === 'empty-history') recovering = true;
        if (value === 'online' && recovering) {delayNext = true; recovering = false;}
        return action(value);
      };
      device.readStatus = async readOptions => {
        if (delayNext) {
          delayNext = false;
          delayedReads += 1;
          await new Promise<void>(resolve => {
            const finish = (): void => {cancel(); readOptions?.signal?.removeEventListener('abort', finish); resolve();};
            const cancel = options.scheduler.after(4000, finish);
            readOptions?.signal?.addEventListener('abort', finish, {once: true});
            if (readOptions?.signal?.aborted === true) finish();
          });
        }
        return read(readOptions);
      };
      return device;
    }}}};
    const h = await startMemoryHarness(selected.seed, transport, {
      registrations: registrations.map(value => value.name === registration.name ? delayed : value),
    });
    try {
      const result = await runScenario(selected, h);
      assert.equal(result.outcome, 'passed', JSON.stringify(result.steps.filter(step => step.outcome !== 'passed')));
      assert.equal(delayedReads, 1);
      assert.deepEqual(h.problems(), []);
    } finally {await h.close();}
  });

  for (const fault of ['missing-recovery', 'lost-recovered-history'] as const) {
    it(`Roborock scenario rejects ${fault} over ${transport}`, async () => {
      const h = await startMemoryHarness(selected.seed, transport);
      const states = h.reader.states.bind(h.reader), simulate = h.simulate.bind(h);
      let recoveryAt: number | undefined, restarted = false;
      const restart = h.restart.bind(h);
      h.restart = async () => {restarted = true; await restart();};
      h.simulate = value => {
        if (value.device === 'roborock' && value.action === 'empty-history') recoveryAt = h.now();
        simulate(value);
      };
      h.reader.states = <T>(family: string, owner?: string): Message<T>[] => {
        const records = states<T>(family, owner);
        if (family !== 'roborock-vacuum' || recoveryAt === undefined) return records;
        return records.map(record => {
          const data = record.data as VacuumStatus;
          const changed: VacuumStatus = fault === 'missing-recovery' ? {...data, availability: 'unavailable'}
            : {...data, collection: {...data.collection, retainedRuns: 0}};
          return {...record, data: changed} as Message<T>;
        });
      };
      try {
        const result = await runScenario(selected, h);
        assert.equal(result.outcome, 'failed', `${fault} must not pass the scenario`);
        assert.equal(result.steps.at(-1)?.name, fault === 'missing-recovery'
          ? 'the reader observes the recovered status' : 'recovered empty summary never deletes retained records');
        assert.match(result.steps.at(-1)?.detail ?? '', fault === 'missing-recovery'
          ? /^recovery is unavailable at revision \d+, retained 30\/30 records$/
          : /^recovered status is available at revision \d+, retained 0\/30 records$/);
        assert.ok(recoveryAt !== undefined);
        assert.ok(h.now() - recoveryAt <= 13_010, 'the recovery and history checks remain finite');
        assert.equal(restarted, false, 'restart cannot hide missing recovery or lost records');
        assert.deepEqual(h.problems(), []);
      } finally {await h.close();}
    });
  }

  it(`Roborock scenario waits for a bounded offline read over ${transport}`, async () => {
    let delayedReads = 0;
    const simulation = registration.simulation;
    assert.ok(simulation);
    const delayed = {...registration, simulation: {...simulation, memory: {...simulation.memory, create(options: SimulationOptions) {
      const device = new SimulatedRoborock(options.now);
      const action = device.action.bind(device), read = device.readStatus.bind(device);
      let delayNext = false;
      device.action = value => {if (value === 'offline') delayNext = true; return action(value);};
      device.readStatus = async readOptions => {
        if (delayNext) {
          delayNext = false;
          delayedReads += 1;
          // Four seconds is inside the collector's nine-second transport budget, beyond the default scenario wait.
          await new Promise<void>(resolve => {
            const finish = (): void => {cancel(); readOptions?.signal?.removeEventListener('abort', finish); resolve();};
            const cancel = options.scheduler.after(4000, finish);
            readOptions?.signal?.addEventListener('abort', finish, {once: true});
            if (readOptions?.signal?.aborted === true) finish();
          });
        }
        return read(readOptions);
      };
      return device;
    }}}};
    const h = await startMemoryHarness(selected.seed, transport, {
      registrations: registrations.map(value => value.name === registration.name ? delayed : value),
    });
    try {
      const result = await runScenario(selected, h);
      assert.equal(result.outcome, 'passed', JSON.stringify(result.steps.filter(step => step.outcome !== 'passed')));
      assert.equal(delayedReads, 1);
      assert.deepEqual(h.problems(), []);
    } finally {await h.close();}
  });

  for (const {inflightMs, offlineMs} of [{inflightMs: 100, offlineMs: 0}, {inflightMs: 8000, offlineMs: 4000}]) {
    it(`Roborock scenario preserves an in-flight ${inflightMs}ms read before a ${offlineMs}ms offline read over ${transport}`, async () => {
      const simulation = registration.simulation;
      assert.ok(simulation);
      let sampledAt = 0, beforeAt = 0;
      const delayed = {...registration, simulation: {...simulation, memory: {...simulation.memory, create(options: SimulationOptions) {
        const device = new SimulatedRoborock(options.now);
        const action = device.action.bind(device), read = device.readStatus.bind(device);
        let holdNext = false, delayOffline = false, latestAt = 0, started: (() => void) | undefined;
        device.readStatus = async readOptions => {
          const held = holdNext;
          holdNext = false;
          const answer = await read(readOptions);
          if (answer.ok) latestAt = Date.parse(answer.observedAt);
          if (held) {
            sampledAt = latestAt;
            started?.();
          }
          const delayMs = held ? inflightMs : delayOffline ? offlineMs : 0;
          if (!held) delayOffline = false;
          if (delayMs > 0) {
            await new Promise<void>(resolve => {
              const finish = (): void => {cancel(); readOptions?.signal?.removeEventListener('abort', finish); resolve();};
              const cancel = options.scheduler.after(delayMs, finish);
              readOptions?.signal?.addEventListener('abort', finish, {once: true});
              if (readOptions?.signal?.aborted === true) finish();
            });
          }
          return readOptions?.signal?.aborted === true ? read(readOptions) : answer;
        };
        device.action = async value => {
          if (value !== 'offline') return action(value);
          beforeAt = latestAt;
          const begun = new Promise<void>(resolve => {started = resolve;});
          // Give the later sample a distinct time, independent of how I/O and microtasks interleave.
          options.scheduler.after(1, () => {holdNext = true; void action('online');});
          await begun;
          delayOffline = true;
          return action('offline');
        };
        return device;
      }}}};
      const h = await startMemoryHarness(selected.seed, transport, {
        registrations: registrations.map(value => value.name === registration.name ? delayed : value),
      });
      try {
        const result = await runScenario(selected, h);
        assert.equal(result.outcome, 'passed', JSON.stringify(result.steps.filter(step => step.outcome !== 'passed')));
        assert.ok(sampledAt > beforeAt, 'a later successful observation completes while the offline transition is pending');
        assert.deepEqual(h.problems(), []);
      } finally {await h.close();}
    });
  }

  it(`Roborock scenario rejects a frozen post-action reader revision over ${transport}`, async () => {
    const h = await startMemoryHarness(selected.seed, transport);
    const states = h.reader.states.bind(h.reader), simulate = h.simulate.bind(h);
    let baseline: number | undefined, offlineAt: number | undefined, offlineActions = 0, recovered = false;
    h.simulate = value => {
      if (value.device === 'roborock' && value.action === 'offline') {
        baseline = states<VacuumStatus>('roborock-vacuum')[0]?.data.revision;
        assert.ok(baseline !== undefined);
        offlineAt = h.now();
        offlineActions += 1;
      }
      if (value.device === 'roborock' && value.action === 'empty-history') recovered = true;
      simulate(value);
    };
    h.reader.states = <T>(family: string, owner?: string): Message<T>[] => {
      const records = states<T>(family, owner);
      if (family !== 'roborock-vacuum' || baseline === undefined) return records;
      return records.map(record => ({...record, data: {...record.data, revision: baseline}}));
    };
    try {
      const result = await runScenario(selected, h);
      assert.equal(result.outcome, 'failed');
      assert.equal(result.steps.at(-1)?.name, 'vendor temporarily becomes unavailable');
      assert.equal(result.steps.at(-1)?.detail, 'post-action Roborock revision did not arrive');
      assert.ok(offlineAt !== undefined);
      assert.equal(h.now() - offlineAt, 10_000, 'the preparation phase ends at its fixed logical budget');
      assert.equal(offlineActions, 1, 'the phase never reissues the action');
      assert.equal(recovered, false, 'later recovery cannot hide a stuck reader');
      const latest = h.published().filter(({message}) => message.type === 'org.bunny.roborock-vacuum.updated').at(-1)?.message.data as VacuumStatus;
      assert.equal(latest.availability, 'unavailable', 'actual publication changed despite the frozen reader revision');
      assert.equal(latest.collection.retainedRuns, 30);
      assert.ok(latest.revision > (baseline ?? 0));
      assert.equal(states<VacuumStatus>('roborock-vacuum')[0]?.data.availability, 'unavailable');
      assert.deepEqual(h.problems(), []);
    } finally {await h.close();}
  });

  for (const fault of ['missing-transition', 'lost-history', 'changed-time'] as const) {
    it(`Roborock scenario rejects ${fault} over ${transport}`, async () => {
      const h = await startMemoryHarness(selected.seed, transport);
      const states = h.reader.states.bind(h.reader), simulate = h.simulate.bind(h);
      let unavailableAt: number | undefined, recovered = false;
      h.simulate = value => {
        if (value.device === 'roborock' && value.action === 'offline') unavailableAt = h.now();
        if (value.device === 'roborock' && value.action === 'empty-history') recovered = true;
        simulate(value);
      };
      h.reader.states = <T>(family: string, owner?: string): Message<T>[] => {
        const records = states<T>(family, owner);
        if (family !== 'roborock-vacuum') return records;
        return records.map(record => {
          const data = record.data as VacuumStatus;
          if (data.availability !== 'unavailable') return record;
          const changed: VacuumStatus = fault === 'missing-transition' ? {...data, availability: 'available'}
            : fault === 'lost-history' ? {...data, collection: {...data.collection, retainedRuns: 0}}
            : {...data, observedAtMs: {status: 'known', value: h.now()}};
          return {...record, data: changed} as Message<T>;
        });
      };
      try {
        const result = await runScenario(selected, h);
        assert.equal(result.outcome, 'failed', `${fault} must not pass the scenario`);
        assert.equal(result.steps.at(-1)?.name, fault === 'missing-transition' ? 'the reader observes the unavailable status' : PRESERVATION);
        assert.ok(unavailableAt !== undefined);
        assert.ok(h.now() - unavailableAt <= 13_000, 'missing or incorrect evidence fails within the two bounded expectations');
        assert.equal(recovered, false, 'recovery cannot hide the faulty unavailable projection');
        assert.deepEqual(h.problems(), []);
      } finally {await h.close();}
    });
  }
}
