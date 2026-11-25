import type {AssistantProfile} from '@jimmie-potts/event-contracts/v2/assistant';

const callers = ['owner', 'companion'] as const;
const destinations = ['private-conversation', 'conversation-speech', 'anthropic', 'synthetic', 'coding-worker', 'openai-supervisor'] as const;
const purposes = ['discovery', 'read', 'prompt', 'title', 'brief', 'supervisor'] as const;
const sources = ['conversation', 'knowledge', 'preferences', 'sessions', 'devices', 'playback', 'status', 'artwork', 'shows', 'operations', 'coding'] as const;
const fields = ['index', 'text', 'label', 'status', 'details', 'attachment', 'repository', 'brief', 'request', 'excerpt', 'summary'] as const;

export type ShareQuery = {
  caller: typeof callers[number];
  companion: AssistantProfile;
  destination: typeof destinations[number];
  purpose: typeof purposes[number];
  source: typeof sources[number];
  field: typeof fields[number];
  record?: string;
  relevant?: true;
};
export type DisclosedField = Pick<ShareQuery, 'source' | 'field' | 'record'>;
export type SharingGrant = ShareQuery & {allow: boolean};
export type Share = ((query: ShareQuery) => boolean) & {readonly revokesFields?: boolean; readonly allowsDerived?: (query: ShareQuery) => boolean};
type Scope = Pick<ShareQuery, 'caller' | 'companion' | 'destination' | 'purpose'>;
export type FieldAccess = (source: ShareQuery['source'], field: ShareQuery['field'], record?: string) => boolean;

const sameScope = (query: ShareQuery, grant: SharingGrant): boolean => query.caller === grant.caller &&
  query.companion === grant.companion && query.destination === grant.destination && query.purpose === grant.purpose && query.source === grant.source &&
  query.field === grant.field && (grant.record === undefined || grant.record === query.record);

/** Matches the existing destinations. Adding a destination requires an explicit policy entry. */
function supervisorScope(query: ShareQuery): boolean {
  if (query.caller !== 'companion' || query.relevant !== true || query.record === undefined) return false;
  if (query.purpose !== 'supervisor' && query.purpose !== 'title') return false;
  if (query.source === 'conversation') return query.field === 'request' || query.field === 'excerpt';
  return query.purpose === 'supervisor' && query.source === 'devices' && (query.field === 'label' || query.field === 'status' || query.field === 'summary');
}

function existing(query: ShareQuery): boolean {
  if (query.destination === 'openai-supervisor') return supervisorScope(query);
  if (query.destination === 'coding-worker') return query.caller === 'owner' && query.purpose === 'brief' && query.source === 'coding' &&
    (query.field === 'repository' || query.field === 'brief');
  if (query.destination === 'private-conversation' || query.destination === 'conversation-speech') {
    return query.caller === 'owner' && (query.purpose === 'read' || query.purpose === 'discovery');
  }
  if (query.caller !== 'companion') return false;
  if (query.purpose !== 'read' && query.purpose !== 'discovery' && query.purpose !== 'prompt' && query.purpose !== 'title') return false;
  return query.companion === 'bunny' || !['artwork', 'shows', 'playback', 'status'].includes(query.source);
}

export function sharing(grants: readonly SharingGrant[] = []): Share {
  const allows = (query: ShareQuery): boolean => {
    if (query.destination === 'openai-supervisor' && !supervisorScope(query)) return false;
    if (query.destination === 'coding-worker' && !existing(query)) return false;
    const match = grants.filter(grant => sameScope(query, grant));
    return !match.some(grant => !grant.allow) && (match.some(grant => grant.allow) || existing(query));
  };
  // Approval can release the selected brief. An explicit denial on an input to that brief still applies.
  const allowsDerived = (query: ShareQuery): boolean => !grants.some(grant => !grant.allow && sameScope(query, grant));
  return Object.assign(allows, {revokesFields: grants.some(grant => !grant.allow), allowsDerived});
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
      !member(destinations, destination) || !member(purposes, purpose) || !member(sources, source) || !member(fields, field) ||
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
  purpose: 'supervisor' | 'title';
};

/** Project only selected fields. An ID alone never establishes the conversation that owns a message. */
export function supervisorFields(share: Share | undefined, scope: SupervisorScope): FieldAccess {
  return (source, field, record) => {
    if (record === undefined) return false;
    const eligible = source === 'conversation' ? field === 'request' ? record === scope.requestId
      : scope.messages.get(record)?.conversationId === scope.conversationId
      : source === 'devices' && scope.devices.has(record) && (field !== 'summary' || scope.requestedHistory?.has(record) === true);
    if (!eligible) return false;
    const query: ShareQuery = {caller: 'companion', companion: scope.companion, destination: 'openai-supervisor',
      purpose: scope.purpose, source, field, record, relevant: true};
    return supervisorScope(query) && (share ?? existing)(query);
  };
}
