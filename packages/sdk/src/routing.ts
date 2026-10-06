// SDK routing keys (ADR 0012): `bunny.<state|event|cmd>.<family>.<id>`, lowercase and shallow, with hyphens inside
// tokens. A pattern is a key in which `*` stands for any one of the last three tokens.
import type {MessageKind} from '@jimmie-potts/event-contracts/v2';
export type Category = 'state' | 'event' | 'cmd';
export type RoutingKey = {readonly category: Category; readonly family: string; readonly id: string};
export type Pattern = {readonly category: Category | '*'; readonly family: string; readonly id: string};

const TOKEN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CATEGORIES: readonly string[] = ['state', 'event', 'cmd'] satisfies Category[];
const isCategory = (value: string): value is Category => CATEGORIES.includes(value);

function split(text: string, wildcard: boolean): Pattern | undefined {
  const [prefix, category, family, id, extra] = text.split('.');
  const token = (value: string | undefined): value is string => value !== undefined && ((wildcard && value === '*') || TOKEN.test(value));
  if (prefix !== 'bunny' || extra !== undefined || !token(category) || !token(family) || !token(id)) return undefined;
  if (category === '*' || isCategory(category)) return {category, family, id};
  return undefined;
}

export function parseKey(key: string): RoutingKey | undefined {
  const parsed = split(key, false);
  return parsed === undefined || parsed.category === '*' ? undefined : {category: parsed.category, family: parsed.family, id: parsed.id};
}

export const parsePattern = (pattern: string): Pattern | undefined => split(pattern, true);

/**
 * The key class a published kind travels on: state and removal messages on `bunny.state` keys, occurrences and
 * outcomes on `bunny.event` keys. Commands, replies and sync messages are never published, so they have none.
 */
export function keyClassOf(kind: MessageKind): 'state' | 'event' | undefined {
  switch (kind) {
    case 'state':
    case 'removal':
      return 'state';
    case 'occurrence':
    case 'outcome':
      return 'event';
    case 'command':
    case 'reply':
    case 'sync-request':
    case 'sync-completed':
      return undefined;
  }
}

const same = (a: string, b: string): boolean => a === '*' || b === '*' || a === b;

/** Whether some key matches both patterns. A key has no wildcards, so this also says whether a pattern matches a key. */
export const overlaps = (a: Pattern, b: Pattern): boolean =>
  same(a.category, b.category) && same(a.family, b.family) && same(a.id, b.id);
