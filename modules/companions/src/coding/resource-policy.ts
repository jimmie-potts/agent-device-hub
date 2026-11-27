import type {CodingDestination} from '@jimmie-potts/event-contracts/v2/coding';
import {codingDestinationChoice, type CodingRequirements, type CodingResource} from './routing.js';

export type CodingResourceGrant = CodingResource & {destinations: CodingDestination[]};
/** Operator-owned routing constraints. A match selects a place to run a step and grants no device command or installation access. */
export function codingResourceGrants(value: unknown): CodingResourceGrant[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 64) return undefined;
  const grants: CodingResourceGrant[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined;
    const grant = entry as Record<string, unknown>;
    const {kind, id, destinations} = grant;
    if (Object.keys(grant).some(key => !['kind', 'id', 'destinations'].includes(key)) ||
      (kind !== 'device-proximity' && kind !== 'device-route' && kind !== 'installation') ||
      typeof id !== 'string' || !/^[a-z0-9][a-z0-9._/-]{0,95}$/u.test(id) ||
      !Array.isArray(destinations) || destinations.length === 0 || destinations.length > 16 ||
      !destinations.every((target): target is CodingDestination => codingDestinationChoice(target) && target !== 'auto' && target !== 'cloud') ||
      new Set(destinations).size !== destinations.length || grants.some(item => item.kind === kind && item.id === id) ||
      (kind === 'installation' && (destinations.length !== 1 || destinations[0] !== 'mac'))) return undefined;
    grants.push({kind, id, destinations});
  }
  return grants;
}

const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();

/** Match explicit execution clauses in the saved owner message. Receiver policy independently checks the resulting requirement. */
export function codingRequirementsFromOwner(text: string, grants: readonly CodingResourceGrant[] = []): CodingRequirements | undefined {
  const requirements: CodingRequirements = {};
  for (const clause of text.split(/(?:[.;\n]|\band then\b|\bthen\b|\band (?=(?:run|execute|perform|check|verify|deploy|install|write|report|record|summarize|document|explain|describe|implement|design|prepare|develop)\b))/iu)) {
    const statement = words(clause);
    // Discussing or changing the installer or controller is ordinary source work.
    if (/\b(?:explain|describe|document|implement|design|prepare|develop|write|investigate how|check how|test (?:an? |the )?installer)\b/u.test(statement) ||
      /\b(?:do not|never|without|don t)\s+(?:run|execute|deploy|install|perform|check|verify)\b/u.test(statement)) continue;
    if (!/\b(?:run|execute|perform|check|verify|validate|install|deploy|measure|test)\b/u.test(statement)) continue;
    const platforms = (['windows', 'linux', 'macos'] as const).filter(os =>
      new RegExp(`\\b(?:${os} only|on ${os}|under ${os}|requires? ${os})\\b`, 'u').test(statement));
    for (const os of platforms) {
      if (requirements.os !== undefined && requirements.os !== os) requirements.refusal = 'conflicting-platform';
      requirements.os = os;
    }
    if (/\b(?:tests?|test suite|wide test|checks?)\b/u.test(statement) &&
      /\b(?:test (?:job|suite|profile|slots?)|wide test|standard test|windows only (?:check|test)|run (?:the |a |all )?tests?)\b/u.test(statement)) {
      if (/\brun (?:the |a |all )?tests?\b/u.test(statement) && !/\b(?:wide|standard|slots?|profile)\b/u.test(statement)) requirements.standardTests = true;
      else requirements.testSlots = /\bwide\b/u.test(statement) ? 2 : requirements.testSlots ?? 1;
    }
    if (/\b(?:using|with|under|requires?) node (?:js )?24\b/u.test(statement)) requirements.toolchains = ['node24'];
    const revision = /\b(?:at (?:commit |revision )?|commit |revision )([a-f0-9]{40})\b/u.exec(statement)?.[1];
    if (revision !== undefined) requirements.revision = revision;
    const kind: CodingResource['kind'] | undefined =
      /\b(?:installed (?:mac |runtime |hub )?(?:installation|operation|runtime|hub|service)|installation operator|installed mac|deploy (?:the )?(?:runtime|hub)|run (?:the )?(?:mac )?install(?:ation)?)\b/u.test(statement) ? 'installation' :
      /\b(?:physical proximity|physically (?:near|present|beside)|proximity (?:check|test)|next to (?:the )?device)\b/u.test(statement) ? 'device-proximity' :
      /\b(?:authorized (?:device )?(?:edge|route)|device route|through (?:the |an? )?(?:device )?edge|routed device (?:check|test))\b/u.test(statement) ? 'device-route' : undefined;
    const named = grants.filter(grant => (` ${statement} `).includes(` ${words(grant.id)} `));
    const matches = kind === undefined ? named : named.filter(grant => grant.kind === kind);
    if (kind === undefined && (named.length === 0 || !named.some(grant =>
      statement.includes(`${words(grant.id)} check`) || statement.includes(`${words(grant.id)} operation`) ||
      statement.includes(`operation ${words(grant.id)}`)))) continue;
    const possible = matches.length > 0 ? matches : kind === 'installation' && named.length === 0 && !/\b(?:for|targeting|named)\s+\S/u.test(statement) ? grants.filter(grant => grant.kind === kind) : [];
    const resource = possible[0];
    if (possible.length !== 1 || resource === undefined) {requirements.refusal = possible.length > 1 ? 'ambiguous-resource' : 'unknown-resource'; continue;}
    if (requirements.resource !== undefined && (requirements.resource.kind !== resource.kind || requirements.resource.id !== resource.id)) {
      requirements.refusal = 'ambiguous-resource';
    } else requirements.resource = {kind: resource.kind, id: resource.id};
  }
  return Object.keys(requirements).length > 0 ? requirements : undefined;
}
