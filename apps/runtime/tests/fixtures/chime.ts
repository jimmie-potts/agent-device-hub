// A consume-only fixture module (Hub #846): a chime that rings once for each approval prompt, and remembers in its own
// SQLite file what it rang, so a restart with the prompt still waiting does not ring again. Like the lamp, it is created
// by its factory with its device transport, `createChimeModule({transport})`. It answers no command and serves nothing;
// it follows the core's sessions.
import type {SessionRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {BunnyModule} from '@jimmie-potts/sdk';
import type {ConformanceSpec} from '@jimmie-potts/sdk/testing';

/** One ring: the session and the approval it rang for. */
export type ChimeRing = {session: string; attention: string};
export type ChimeDeviceState = {rings: ChimeRing[]};

/** How the chime module reaches its chime. */
export interface ChimeTransport {
  ring(ring: ChimeRing): void;
}

/** A simulated chime. A test can make its next ring hit a fault that the module does not handle. */
export class SimulatedChime implements ChimeTransport {
  readonly #rings: ChimeRing[] = [];
  #fault = false;

  ring(ring: ChimeRing): void {
    if (this.#fault) {
      this.#fault = false;
      throw new TypeError('the chime hit a fault');
    }
    this.#rings.push({...ring});
  }

  faultNext(): void {
    this.#fault = true;
  }

  state(): ChimeDeviceState {
    return {rings: this.#rings.map(ring => ({...ring}))};
  }
}

export function createChimeModule({transport}: {transport: ChimeTransport}): BunnyModule {
  return {
    manifest: {name: 'chime', apiVersion: '1.0'},
    async start({sdk, database}) {
      const db = database();
      db.exec('CREATE TABLE IF NOT EXISTS rung (session TEXT NOT NULL, attention TEXT NOT NULL, PRIMARY KEY (session, attention)) STRICT');
      const rang = db.prepare('SELECT 1 FROM rung WHERE session = ? AND attention = ?');
      const ring = db.prepare('INSERT INTO rung (session, attention) VALUES (?, ?)');
      const follow = await sdk.sync<SessionRecord>(['session'], change => {
        if (change.type !== 'updated') return;
        for (const {id, kind} of change.message.data.attention) {
          if (kind !== 'approval' || id.status !== 'known' || rang.get(change.entity.id, id.id) !== undefined) continue;
          // A fault here escapes the handler, so the runtime stops the chime alone.
          transport.ring({session: change.entity.id, attention: id.id});
          ring.run(change.entity.id, id.id);
        }
      }, {timeoutMs: 5000});
      if (follow.status === 'rejected') throw new Error(`the chime could not sync the sessions: ${follow.error.error.code}`);
    },
    stop: () => {},
  };
}

/** The kit's description of the chime: it only copies the core's sessions. */
export const chimeSpec = (): ConformanceSpec => ({
  create: () => createChimeModule({transport: new SimulatedChime()}),
  copies: {families: ['session'], snapshot: {revision: 0, states: []}},
});
