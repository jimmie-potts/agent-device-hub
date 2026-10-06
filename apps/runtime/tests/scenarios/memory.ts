// Tier 1 of the runtime's scenario catalog (Hub #846): the in-memory harness. Not built yet.
import type {Server} from 'node:http';
import type {EdgeLogRecord} from '@jimmie-potts/sdk';
import type {Harness, Seed, TransportName} from './catalog.js';

/** The ports of the installed Hub, local controllers and their services, which a harness never uses. */
export const INSTALLED_PORTS: readonly number[] = [8765, 8787, 8788, 8791, 41231];

export interface MemoryHarness extends Harness {
  readonly stateDir: string;
  readonly url: string | undefined;
  problems(): readonly string[];
  edgeLog(): readonly EdgeLogRecord[];
  tokens(): readonly string[];
  close(): Promise<void>;
}

export function listenLoopback(server: Server, refused: (port: number) => boolean): Promise<number> {
  void server;
  void refused;
  return Promise.reject(new Error('not built yet'));
}

export function startMemoryHarness(seed: Seed, transport: TransportName, options: {root?: string} = {}): Promise<MemoryHarness> {
  void seed;
  void transport;
  void options;
  return Promise.reject(new Error('the in-memory harness is not built yet'));
}
