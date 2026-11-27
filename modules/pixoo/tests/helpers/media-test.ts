import { rm } from 'node:fs/promises';
import { it } from 'vitest';
import type { Library } from '../../src/library/index.js';
import type { Player } from '../../src/playback/index.js';

export interface MediaResources {
  readonly players: Player[];
  readonly libraries: Library[];
  readonly roots: string[];
}

/** A Vitest timeout can finish the case while its media worker is still writing. */
export function mediaTest(name: string, body: (resources: MediaResources) => Promise<void>, timeout?: number): void {
  it(name, ({ onTestFinished }) => {
    const resources: MediaResources = { players: [], libraries: [], roots: [] };
    const work = Promise.resolve().then(() => body(resources));
    onTestFinished(async () => {
      // Vitest receives the original rejection below. Cleanup waits for either outcome.
      await work.catch(() => undefined);
      for (const player of resources.players) await player.close();
      for (const library of resources.libraries) await library.close();
      for (const root of resources.roots) await rm(root, { recursive: true, force: true });
    });
    return work;
  }, timeout);
}
