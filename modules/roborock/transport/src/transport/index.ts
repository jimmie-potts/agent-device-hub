import {localRead, mqttRead} from './network.js';
import {reader, type Diagnostics, type ReadTransport} from './reader.js';
import type {Config, Session} from './private.js';
export {loadPrivateConfig, loadPrivateSession, type Config, type Session} from './private.js';
export type {Diagnostics, ReadOptions, Reading, ReadTransport, VendorJson} from './reader.js';
/** Validates and snapshots one target. Opens nothing until a typed read is requested. */
export function createReadTransport(config: Config, session: Session, diagnostics: Diagnostics = {}): ReadTransport {
  return reader(config, session, {...diagnostics, local: localRead, mqtt: mqttRead});
}
