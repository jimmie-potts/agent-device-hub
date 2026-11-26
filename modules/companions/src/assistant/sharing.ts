import {codingDestinationChoice} from '../coding/routing.js';
import type {CodingDestination} from '@jimmie-potts/event-contracts/v2/coding';
import type {AssistantProfile} from '@jimmie-potts/event-contracts/v2/assistant';

const callers = ['owner', 'companion'] as const;
const destinations = ['private-conversation', 'conversation-speech', 'external-model', 'anthropic', 'synthetic', 'coding-worker', 'openai-supervisor'] as const;
const purposes = ['discovery', 'read', 'prompt', 'title', 'brief', 'supervisor'] as const;
const sources = ['conversation', 'knowledge', 'preferences', 'sessions', 'devices', 'playback', 'status', 'artwork', 'shows', 'operations', 'coding'] as const;
const fields = ['index', 'text', 'label', 'status', 'details', 'attachment', 'repository', 'brief', 'request', 'excerpt', 'summary'] as const;

export type CodingShareDestination = 'coding-worker' | `coding-worker:${Exclude<CodingDestination, 'mac'>}`;
export function codingShareDestination(destination: CodingDestination): CodingShareDestination {
  return destination === 'mac' ? 'coding-worker' : `coding-worker:${destination}`;
}
function isCodingShareDestination(value: unknown): value is CodingShareDestination {
  if (value === 'coding-worker') return true;
  if (typeof value !== 'string' || !value.startsWith('coding-worker:')) return false;
  const destination = value.slice('coding-worker:'.length);
  return codingDestinationChoice(destination) && destination !== 'auto' && destination !== 'mac' && destination !== 'cloud';
}

export type ShareQuery = {
  caller: typeof callers[number];
  companion: AssistantProfile;
  destination: typeof destinations[number] | CodingShareDestination;
  purpose: typeof purposes[number];
  source: typeof sources[number];
  field: typeof fields[number];
  record?: string;
  relevant?: true;
};
export type DisclosedField = Pick<ShareQuery, 'source' | 'field' | 'record'>;
export type SharingGrant = ShareQuery & {allow: boolean};
export type Share = ((query: ShareQuery) => boolean) & {
  readonly revokesFields?: boolean;
  readonly allowsDerived?: (query: ShareQuery) => boolean;
  readonly conflicts?: number;
};
/** A custom policy with no revocation metadata cannot prove that older disclosures are still permitted. */
export const canRevokeFields = (share: Share | undefined): boolean => share !== undefined && share.revokesFields !== false;

type Scope = Pick<ShareQuery, 'caller' | 'companion' | 'destination' | 'purpose'>;
export type FieldAccess = (source: ShareQuery['source'], field: ShareQuery['field'], record?: string) => boolean;

const sameField = (query: ShareQuery, grant: SharingGrant): boolean => query.caller === grant.caller &&
  query.companion === grant.companion && query.destination === grant.destination && query.purpose === grant.purpose && query.source === grant.source &&
  query.field === grant.field;
const sameScope = (query: ShareQuery, grant: SharingGrant): boolean => sameField(query, grant) &&
  (grant.record === undefined || grant.record === query.record);

const externalDestination = (destination: ShareQuery['destination']): boolean =>
  destination === 'external-model' || destination === 'anthropic' || destination === 'openai-supervisor';
function auxiliaryPrompt(query: ShareQuery): boolean {
  return query.caller === 'companion' && query.purpose === 'prompt' &&
    (query.source === 'knowledge' || query.source === 'preferences') && (query.field === 'label' || query.field === 'text');
}

const legacyOneSidedAllow = (grant: SharingGrant): boolean => grant.destination !== 'external-model' &&
  externalDestination(grant.destination) && grant.allow &&
  (grant.source === 'devices' && grant.field === 'details' || auxiliaryPrompt(grant));

function supervisorField(query: ShareQuery): boolean {
  if (query.caller !== 'companion' || query.purpose !== 'supervisor' && query.purpose !== 'title') return false;
  if (query.source === 'conversation') return query.field === 'request' || query.field === 'excerpt';
  return query.purpose === 'supervisor' && query.source === 'devices' &&
    (query.field === 'index' || query.field === 'label' || query.field === 'status' || query.field === 'summary' || query.field === 'details');
}

function supervisorScope(query: ShareQuery): boolean {
  return query.relevant === true && query.record !== undefined && supervisorField(query);
}

/** Project legacy provider choices onto their shared fields. The configured records stay intact. */
function commonGrants(grant: SharingGrant): SharingGrant[] {
  if (!externalDestination(grant.destination)) return [grant];
  const common: SharingGrant = {...grant, destination: 'external-model'};
  if (legacyOneSidedAllow(grant)) return [grant];
  if (auxiliaryPrompt(grant)) return [common];
  if (grant.destination !== 'anthropic') return [common];
  const {purpose, source, field} = grant;
  if (purpose !== 'prompt' && purpose !== 'read' && purpose !== 'discovery' && purpose !== 'title') return [common];
  const sharedPurpose = purpose === 'title' ? 'title' : 'supervisor';
  if (source === 'conversation' && field === 'text') return [
    {...common, purpose: sharedPurpose, field: 'request'}, {...common, purpose: sharedPurpose, field: 'excerpt'},
  ];
  // Named reads and historical pages required the wider Messages permissions in addition to the fields they returned.
  if (purpose !== 'title' && source === 'devices' && !grant.allow) {
    if (field === 'details') return [
      {...common, purpose: 'supervisor'}, {...common, purpose: 'supervisor', field: 'status'},
      {...common, purpose: 'supervisor', field: 'summary'},
    ];
    if (field === 'status') return [{...common, purpose: 'supervisor'}, {...common, purpose: 'supervisor', field: 'summary'}];
  }
  return [{...common, purpose: sharedPurpose}];
}

function conflictCount(grants: readonly SharingGrant[]): number {
  const denied = grants.filter(grant => grant.destination === 'external-model' && !grant.allow);
  const conflicts = new Set<string>();
  for (const grant of grants) {
    if (legacyOneSidedAllow(grant)) conflicts.add(JSON.stringify(grant));
    if (grant.destination !== 'external-model' || !grant.allow) continue;
    if (!supervisorField(grant) && !auxiliaryPrompt(grant)) conflicts.add(JSON.stringify(grant));
    for (const denial of denied) {
      if (sameField(grant, denial) && (grant.record === undefined || denial.record === undefined || grant.record === denial.record)) {
        conflicts.add(JSON.stringify([grant.caller, grant.companion, grant.purpose, grant.source, grant.field, grant.record ?? denial.record]));
      }
    }
  }
  return conflicts.size;
}

function existing(query: ShareQuery): boolean {
  if (externalDestination(query.destination)) return supervisorScope(query);
  if (query.destination === 'coding-worker') return query.caller === 'owner' && query.purpose === 'brief' && query.source === 'coding' &&
    (query.field === 'repository' || query.field === 'brief');
  if (isCodingShareDestination(query.destination)) return false;
  if (query.destination === 'private-conversation' || query.destination === 'conversation-speech') {
    return query.caller === 'owner' && (query.purpose === 'read' || query.purpose === 'discovery');
  }
  if (query.caller !== 'companion') return false;
  if (query.purpose !== 'read' && query.purpose !== 'discovery' && query.purpose !== 'prompt' && query.purpose !== 'title') return false;
  return query.companion === 'bunny' || !['artwork', 'shows', 'playback', 'status'].includes(query.source);
}

export function sharing(grants: readonly SharingGrant[] = []): Share {
  const common = grants.flatMap(commonGrants);
  const allows = (query: ShareQuery): boolean => {
    if (externalDestination(query.destination)) {
      const prompt = auxiliaryPrompt(query);
      if (!prompt && !supervisorScope(query)) return false;
      const shared = {...query, destination: 'external-model'} satisfies ShareQuery;
      const matches = common.filter(grant => sameScope(shared, grant));
      const explicit = prompt;
      return !matches.some(grant => !grant.allow) && (!explicit || matches.some(grant => grant.allow));
    }
    if (query.destination === 'coding-worker' && !existing(query)) return false;
    if (isCodingShareDestination(query.destination) && (query.caller !== 'owner' || query.purpose !== 'brief')) return false;
    const match = common.filter(grant => sameScope(query, grant));
    return !match.some(grant => !grant.allow) && (match.some(grant => grant.allow) || existing(query));
  };
  // Approval can release the selected brief. An explicit denial on an input to that brief still applies.
  const allowsDerived = (query: ShareQuery): boolean => !grants.some(grant => !grant.allow && sameScope(query, grant));
  return Object.assign(allows, {revokesFields: grants.some(grant => !grant.allow), allowsDerived, conflicts: conflictCount(common)});
}

export function accessFor(share: Share | undefined, scope: Scope): FieldAccess {
  return (source, field, record) => (share ?? existing)({...scope, source, field, ...(record === undefined ? {} : {record})});
}

const member = <T extends string>(list: readonly T[], value: unknown): value is T => list.some(item => item === value);
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export function parseSharingGrants(value: unknown): SharingGrant[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 128) return undefined;
  const checked: SharingGrant[] = [];
  for (const grant of value) {
    if (!object(grant) || Object.keys(grant).some(key => !['caller', 'companion', 'destination', 'purpose', 'source', 'field', 'record', 'allow'].includes(key))) return undefined;
    const {caller, companion, destination, purpose, source, field, record, allow} = grant;
    if (!member(callers, caller) || !member(['bunny', 'reachy', 'microduck'] as const, companion) ||
      (!member(destinations, destination) && !isCodingShareDestination(destination)) || !member(purposes, purpose) || !member(sources, source) || !member(fields, field) ||
      typeof allow !== 'boolean' || (record !== undefined && (typeof record !== 'string' || record.length > 128 || record === ''))) return undefined;
    checked.push({caller, companion, destination, purpose, source, field, allow, ...(record === undefined ? {} : {record})});
  }
  return checked;
}

export type SupervisorScope = {
  companion: AssistantProfile;
  /** The admitted task's own current request and conversation. */
  requestId: string;
  conversationId: string;
  /** Records selected on the server, with provenance independent of the selected IDs. */
  messages: ReadonlyMap<string, {conversationId: string}>;
  devices: ReadonlySet<string>;
  /** Relevant historical summaries selected only for a request about past device state. */
  requestedHistory?: ReadonlySet<string>;
  requestedHistoryDetails?: ReadonlySet<string>;
  purpose: 'supervisor' | 'title';
};

/** Project only selected fields. An ID alone never establishes the conversation that owns a message. */
export function supervisorFields(share: Share | undefined, scope: SupervisorScope): FieldAccess {
  return (source, field, record) => {
    if (record === undefined) return false;
    const eligible = source === 'conversation' ? field === 'request' ? record === scope.requestId
      : scope.messages.get(record)?.conversationId === scope.conversationId
      : source === 'devices' && scope.devices.has(record) &&
        (field !== 'summary' || scope.requestedHistory?.has(record) === true) &&
        (field !== 'details' || scope.requestedHistoryDetails?.has(record) === true);
    if (!eligible) return false;
    if (source === 'conversation' && !recordedSupervisorField(share, scope.companion, scope.purpose, source, field, scope.conversationId)) return false;
    return recordedSupervisorField(share, scope.companion, scope.purpose, source, field, record);
  };
}

/** Recheck a field whose relevance was established when the supervisor input was built. */
export function recordedSupervisorField(share: Share | undefined, companion: AssistantProfile, purpose: SupervisorScope['purpose'],
  source: ShareQuery['source'], field: ShareQuery['field'], record: string): boolean {
  const query: ShareQuery = {caller: 'companion', companion, destination: 'external-model', purpose, source, field, record, relevant: true};
  return supervisorScope(query) && (share ?? existing)(query);
}
