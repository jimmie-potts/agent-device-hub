import {codingDestinationChoice, type CodingDestinationChoice, type CodingChoice, type CodingRequirements, type CodingResource} from '../coding/routing.js';

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const token = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value);

export function codingOS(value: unknown): value is NonNullable<CodingRequirements['os']> {
  return value === 'macos' || value === 'windows' || value === 'linux';
}

function codingResource(value: unknown): value is CodingResource {
  return record(value) && Object.keys(value).length === 2 && typeof value.id === 'string' && /^[a-z0-9][a-z0-9._/-]{0,95}$/u.test(value.id) &&
    (value.kind === 'device-route' || value.kind === 'device-proximity' || value.kind === 'installation');
}

export function codingRequirements(value: unknown, trusted = false): value is CodingRequirements {
  if (!record(value) || Object.keys(value).some(key => !['revision', 'os', 'toolchains', 'testSlots', 'resource', 'refusal'].includes(key))) return false;
  const {revision, os, toolchains, testSlots, resource, refusal} = value;
  return (revision === undefined || typeof revision === 'string' && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(revision)) &&
    (os === undefined || codingOS(os)) &&
    (toolchains === undefined || Array.isArray(toolchains) && toolchains.length <= 16 && toolchains.every(token)) &&
    (testSlots === undefined || testSlots === 1 || testSlots === 2) &&
    (resource === undefined || codingResource(resource)) &&
    (refusal === undefined || trusted && (refusal === 'unknown-resource' || refusal === 'ambiguous-resource' || refusal === 'conflicting-platform'));
}

export function bindCodingRequirements(requested: CodingRequirements | undefined, trusted: CodingRequirements | undefined): CodingRequirements | undefined {
  if (requested === undefined) return trusted;
  if (trusted === undefined) return requested;
  const refusal = trusted.refusal ?? requested.refusal ??
    (trusted.os !== undefined && requested.os !== undefined && trusted.os !== requested.os ? 'conflicting-platform' : undefined) ??
    (trusted.resource !== undefined && requested.resource !== undefined &&
      (trusted.resource.kind !== requested.resource.kind || trusted.resource.id !== requested.resource.id) ? 'ambiguous-resource' : undefined);
  const toolchains = requested.toolchains === undefined && trusted.toolchains === undefined ? undefined
    : [...new Set([...(requested.toolchains ?? []), ...(trusted.toolchains ?? [])])];
  const testSlots = requested.testSlots === 2 || trusted.testSlots === 2 ? 2 : trusted.testSlots ?? requested.testSlots;
  return {...requested, ...trusted, ...(toolchains === undefined ? {} : {toolchains}),
    ...(testSlots === undefined ? {} : {testSlots}), ...(refusal === undefined ? {} : {refusal})};
}

/** Keep a clearly stated owner route when a supervisor omits or changes it in the proposed tool call. */
export function ownerCodingRoute(text: string): {harness?: CodingChoice; destination?: CodingDestinationChoice} {
  const route: {harness?: CodingChoice; destination?: CodingDestinationChoice} = {};
  for (const clause of text.trim().toLowerCase().split(/[.,;!\n]|\band then\b/u)) {
    const instruction = clause.trim().replace(/^(?:please|can you|could you)\s+/u, '');
    if (!/^(?:(?:use|choose|ask|have|select|delegate|send|run|start|execute|launch)\b|(?:codex|claude code)\s+(?:on|for)\b)/u.test(instruction)) continue;
    const harness = /(?:^(?:use|choose|ask|have|select)\s+|\b(?:with|using)\s+|^)(codex|claude code)\b/u.exec(instruction)?.[1];
    if (harness !== undefined) route.harness = harness === 'codex' ? 'codex' : 'claude-code';
    if (/\b(?:wherever it fits|any eligible (?:host|worker)|wherever (?:it is )?available)\b/u.test(instruction)) route.destination = 'auto';
    // A target platform in source code (an installer for the Mac) does not identify an execution host.
    const target = /\b(?:on|via|to)\s+(?:the\s+|my\s+|an enrolled\s+|a\s+)?(mac|pc|cloud(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?)\b(?!\s+(?:or|and)\b)/u.exec(instruction)?.[1];
    if (target !== undefined && codingDestinationChoice(target)) route.destination = target;
  }
  return route;
}
