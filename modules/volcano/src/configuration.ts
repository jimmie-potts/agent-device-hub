// The Volcano module's section: one device, named by the one collector feed it takes. The feed's host and source are the
// two identifiers its collector's credential is derived from; the section holds no serial, Bluetooth identifier or path.
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import type {Configure} from '@jimmie-potts/sdk';

export type VolcanoConfig = {id: string; label?: string; hostId: string; sourceId: string};

const ROUTING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FEED_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const invalid = () => errorBody('invalid-request', {detail: 'Volcano needs a routing id, a feed hostId and sourceId, and at most a short label'});
const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

export const configureVolcano: Configure<VolcanoConfig> = section => {
  if (!isObject(section) || Object.keys(section).some(key => !['id', 'label', 'hostId', 'sourceId'].includes(key))) return invalid();
  const {id, label, hostId, sourceId} = section;
  if (typeof id !== 'string' || id.length > 128 || !ROUTING_ID.test(id)) return invalid();
  if (typeof hostId !== 'string' || !FEED_ID.test(hostId) || typeof sourceId !== 'string' || !FEED_ID.test(sourceId)) return invalid();
  if (label !== undefined && (typeof label !== 'string' || label.trim().length === 0 || label.length > 80 || [...label].some(c => (c.codePointAt(0) ?? 0) < 32))) return invalid();
  // It names no device for control, so nothing here is a mode participant or an automation target, and the host-local
  // profile's refusal of a named device leaves it to the registration's `hostLocal` admission.
  return {config: {id, ...(label === undefined ? {} : {label}), hostId, sourceId}, devices: []};
};
