/** Qualified host admission, not device observations or private module configuration (Hub #924). */
export type ModeParticipant = {readonly id: string; readonly kind: 'nanoleaf' | 'pixoo'};
export type QualifiedModeModule = {readonly name: string; readonly admitted: boolean; readonly devices: readonly string[]};
const ROUTING_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Fixed Nanoleaf/Pixoo targets, including admitted modules that later stop or fail. */
export function modeParticipants(modules: readonly QualifiedModeModule[]): readonly ModeParticipant[] {
  return checkModeParticipants(modules.flatMap(module => module.admitted && (module.name === 'nanoleaf' || module.name === 'pixoo')
    ? module.devices.map(id => ({id, kind: module.name as ModeParticipant['kind']})) : []));
}

/** Copies and checks the internal bridge; duplicate qualified IDs are never sent twice. */
export function checkModeParticipants(participants: readonly ModeParticipant[]): readonly ModeParticipant[] {
  const ids = new Set<string>();
  return Object.freeze(participants.map(({id, kind}) => {
    if (!ROUTING_ID.test(id) || id.length > 128 || (kind !== 'nanoleaf' && kind !== 'pixoo') || ids.has(id)) throw new Error('invalid-mode-participants');
    ids.add(id);
    return Object.freeze({id, kind});
  }));
}

/** Stable bounded child identity. Core and browser recover it without publishing command payloads. */
export async function modeChildRequestId(requestId: string, target: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['mode-set', requestId, target])));
  return `mode-${Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')}`;
}
