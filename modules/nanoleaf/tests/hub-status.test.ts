// The Lines follow the hub's shared status (Hub #1865, design decision 10). Every check of the contracts package's shared
// synthetic case set goes through the module's own feed boundary (`envelopeOf`, which reads each view with Nanoleaf's
// policy) and the shared-input projection, and each task's saved status and steady hold must be what the case expects.
import assert from 'node:assert/strict';
import {loadSessionCases} from '@jimmie-potts/event-contracts/v2/session-cases';
import {CONSUMER, CORE_OWNER, envelopeOf, sharedConfig} from '../src/module/feed.js';
import {identityKey, SharedCopy} from '../src/shared-input.js';
import {configureSource, selectShared} from '../src/shared-source.js';
import {loadDump, query, recordedSetup, suite, temporary, test, write} from './support.js';

const cases = loadSessionCases();
const SOURCES = [...new Map(Object.values(cases.sessions).map(({identity}) => {
  const {provider, client, hostId, sourceId} = identity;
  return [JSON.stringify([provider, client, hostId, sourceId]), {provider, client, hostId, sourceId}];
})).values()];

suite('the shared session cases on the Lines', () => {
  test('every check shows each task the hub status the case expects, held steady only for unconfirmed work', context => {
    let checked = 0;
    for (const item of cases.cases) {
      for (const [index, check] of item.checks.entries()) {
        const where = `${item.id} check ${index}`;
        const path = temporary(context);
        loadDump(path, recordedSetup('selection'));
        const copy = new SharedCopy();
        const config = sharedConfig(SOURCES);
        assert.deepEqual([config.ownerId, config.consumerId], [CORE_OWNER, CONSUMER]);
        write(path, db => configureSource(db, copy, config));
        write(path, db => { selectShared(db, {copy, envelope: envelopeOf(Object.values(check.views), 1), instant: 1000, targets: ['wall']}); });
        const roots = Object.entries(check.views).filter(([, view]) => view.parent.status !== 'known');
        const keyOf = new Map(roots.map(([name, view]) => [identityKey(view.identity), name]));
        const saved: Record<string, string> = {};
        for (const [key, status] of query(path, 'SELECT id,status FROM sessions')) {
          const name = keyOf.get(String(key));
          if (name !== undefined) saved[name] = String(status);
        }
        const steady = query(path, 'SELECT session FROM shared_stale').map(([key]) => keyOf.get(String(key)))
          .filter((name): name is string => name !== undefined);
        assert.deepEqual({tasks: saved, steady: steady.sort()}, {tasks: check.readers.nanoleaf.tasks, steady: [...check.readers.nanoleaf.steady].sort()},
          where);
        checked++;
      }
    }
    assert.ok(checked >= 25, `${checked} checks`);
  });
});
