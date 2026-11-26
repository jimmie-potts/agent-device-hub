import type {CodingRequirements, CodingResource} from '../coding/routing.js';

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
