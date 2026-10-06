// A stand-in for the core in runtime tests (Hub #882): it serves the mode, and it takes every occurrence and outcome
// once by (source, id), keeping what it took in its own SQLite file across restarts, as the core's tracker will. Each
// message it takes or drops is logged, so a test in another process can count them.
import {compareDelivery, type Message} from '@jimmie-potts/event-contracts/v2';
import type {BunnyModule} from '@jimmie-potts/sdk';
import {modeState} from './lamp.js';

export function core(mode: 'work' | 'free' | 'quiet' = 'work'): BunnyModule {
  return {
    manifest: {name: 'core', apiVersion: '1.0'},
    async start({sdk, database, clock, log}) {
      // Serve the mode first, so a module that starts next can sync it.
      const state = modeState(mode, clock.now());
      await sdk.serveSync(['mode'], () => ({revision: 1, states: [state]}));
      const db = database();
      db.exec('CREATE TABLE IF NOT EXISTS taken (source TEXT NOT NULL, id TEXT NOT NULL, message TEXT NOT NULL, PRIMARY KEY (source, id)) STRICT');
      const prior = db.prepare('SELECT message FROM taken WHERE source = ? AND id = ?');
      const take = db.prepare('INSERT INTO taken (source, id, message) VALUES (?, ?, ?)');
      await sdk.subscribe('bunny.event.*.*', message => {
        const row = prior.get(message.source, message.id) as {message: string} | undefined;
        const verdict = compareDelivery(row === undefined ? undefined : JSON.parse(row.message) as Message, message);
        if (verdict === 'new') take.run(message.source, message.id, JSON.stringify(message));
        const requestId = (message.data as {requestId?: unknown}).requestId;
        log.info(`core.message.${verdict === 'new' ? 'taken' : verdict}`, {
          source: message.source, id: message.id, kind: message.kind, ...(typeof requestId === 'string' ? {requestId} : {}),
        });
      });
    },
    stop: () => {},
  };
}
