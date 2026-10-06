// A reference consumer copy of one owner's entities, for tests only (ADR 0012 "Consumers and recovery"). The SDK
// (#830) owns the real consumer. A state event replaces the copy unless it is older than what the consumer holds or
// removed; a removal drops it; `sync.completed` drops every held entity of the synced families that is not a member,
// and makes everything at or below its revision stale.
export const familyOf = message => message.dataschema.split('/').at(-2);

export function consumerCopy() {
  const held = new Map(), removed = new Map(), pending = new Map();
  let floor = -1;
  const key = (family, id) => `${family}/${id}`;
  const stale = revision => pending.size === 0 && revision <= floor;
  return {
    held,
    /** Applies one message and says what it did: `applied`, `removed`, `synced`, `stale` or `ignored`. */
    apply(message) {
      const data = message.data;
      switch (message.kind) {
        case 'state': {
          const k = key(familyOf(message), data.id);
          if (stale(data.revision) || held.get(k)?.revision >= data.revision || removed.get(k) >= data.revision) return 'stale';
          held.set(k, data);
          removed.delete(k);
          return 'applied';
        }
        case 'removal': {
          const k = key(data.entity.family, data.entity.id);
          if (stale(data.revision) || held.get(k)?.revision > data.revision) return 'stale';
          held.delete(k);
          removed.set(k, data.revision);
          return 'removed';
        }
        case 'sync-request':
          pending.set(data.requestId, data.families);
          return 'ignored';
        case 'sync-completed': {
          const families = pending.get(data.requestId);
          if (families === undefined) return 'ignored';
          pending.delete(data.requestId);
          const members = new Set(data.members.map(entity => key(entity.family, entity.id)));
          for (const k of [...held.keys()]) if (families.includes(k.split('/')[0]) && !members.has(k)) held.delete(k);
          removed.clear();
          floor = data.revision;
          return 'synced';
        }
        default:
          return 'ignored';
      }
    },
  };
}
