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
