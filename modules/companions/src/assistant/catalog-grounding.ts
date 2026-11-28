import {containsControlValue, hubModeChoice, literalDeviceId, normalizedControlText} from './control-intent.js';
import {exactControlIds, type ModelControlScope} from './model-control.js';

export type CatalogSelectorKind = 'artwork' | 'asset' | 'draft' | 'playlist' | 'rendition' | 'scene';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const ids: Readonly<Record<CatalogSelectorKind, RegExp>> = {
  artwork: /^[A-Za-z0-9_.-]{1,128}$/u,
  asset: uuid,
  draft: /^show-[a-z0-9-]+$/u,
  playlist: uuid,
  rendition: /^[a-f0-9]{64}$/u,
  scene: /^scene-[a-f0-9]{64}$/u,
};

export function catalogSelectorId(kind: CatalogSelectorKind, value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const id = literalDeviceId(value) ?? value;
  return ids[kind].test(id) ? id : undefined;
}

const tokens = (text: string): string[] => text.split(/[^A-Za-z0-9_.-]+/u).map(word => word.replace(/[.]$/u, ''));

export function catalogHistoryNames(kind: CatalogSelectorKind, selector: string, history: readonly string[]): boolean {
  const id = literalDeviceId(selector) ?? selector;
  return ids[kind].test(id) ? history.some(text => tokens(text).includes(id))
    : history.some(text => containsControlValue(text, selector));
}

/** The model supplies a selector. Explicit current IDs take precedence over names and over earlier facts. */
export function catalogSelectorSelected(kind: CatalogSelectorKind, selector: string, scope: ModelControlScope,
  earlier: readonly string[], contextIds: readonly string[] = []): boolean {
  if (selector.trim() === '' || selector.length > 131) return false;
  const id = literalDeviceId(selector) ?? selector;
  const opaque = ids[kind].test(id);
  const answer = scope.answer?.text ?? '';
  const selectedIds = (text: string) => {
    const explicit = exactControlIds(text).filter(value => ids[kind].test(value) && !contextIds.includes(value));
    if (explicit.length > 0 || kind === 'artwork') return explicit;
    return [...new Set(tokens(text).filter(value => ids[kind].test(value)))];
  };
  const answered = selectedIds(answer), requested = selectedIds(scope.request.text);
  const explicit = answered.length > 0 ? answered : requested;
  if (explicit.length > 0) return opaque && explicit.length === 1 && explicit[0] === id;
  const identifies = opaque ? (text: string) => tokens(text).includes(id)
    : (text: string) => containsControlValue(text, selector);
  if ([answer, scope.request.text].some(identifies)) return true;
  // Earlier asset references fill an anaphoric slot. They never replace a new named original.
  if (kind === 'asset' && ![answer, scope.request.text].some(text =>
    /\b(?:it|(?:that|this|the same|the previous) (?:one|asset|original|image))\b/iu.test(text))) return false;
  return earlier.some(identifies);
}

export type CatalogReferenceRole = 'primary' | CatalogSelectorKind | 'notice' | 'preset' | 'operation' | 'session' |
  'favorite' | 'playlist-item' | 'cue';
type CurrentCitation = {role: CatalogReferenceRole; source: 'request' | 'answer'; quote: string};
export type CatalogReference = CurrentCitation & ({kind: 'named'; disposition: 'select' | 'exclude'} |
  {kind: 'prior' | 'last-activated'; disposition: 'select'});
export const catalogReferenceRoles = ['primary', 'artwork', 'asset', 'draft', 'playlist', 'rendition', 'scene',
  'notice', 'preset', 'operation', 'session', 'favorite', 'playlist-item', 'cue'] as const satisfies readonly CatalogReferenceRole[];
const isCatalogReferenceRole = (value: unknown): value is CatalogReferenceRole =>
  catalogReferenceRoles.some(role => role === value);
export const isCatalogSelectorKind = (role: CatalogReferenceRole): role is CatalogSelectorKind => Object.hasOwn(ids, role);

export function readCatalogReferences(value: unknown, scope: ModelControlScope, maximum = 8): readonly CatalogReference[] | undefined {
  if (!Array.isArray(value) || value.length > maximum) return undefined;
  const refs: CatalogReference[] = [];
  const input: readonly unknown[] = value;
  for (const item of input) {
    if (typeof item !== 'object' || item === null || Array.isArray(item) || Object.keys(item).length !== 5 ||
      !('role' in item) || !('kind' in item) || !('disposition' in item) || !('source' in item) || !('quote' in item)) return undefined;
    const {role, kind, disposition, source, quote} = item;
    if (!isCatalogReferenceRole(role) || source !== 'request' && source !== 'answer' ||
      typeof quote !== 'string' || quote !== quote.trim() || quote.length === 0 || quote.length > 131) return undefined;
    const body = source === 'request' ? scope.request.text : scope.answer?.text;
    if (body === undefined || !containsControlQuote(body, quote)) return undefined;
    const citation = {role, source, quote} satisfies CurrentCitation;
    if (refs.some(prior => prior.role === role && prior.quote === quote && prior.source === source)) return undefined;
    if (kind === 'named' && (disposition === 'select' || disposition === 'exclude')) refs.push({...citation, kind, disposition});
    else if (disposition === 'select' && (kind === 'prior' || kind === 'last-activated' && role === 'scene')) {
      refs.push({...citation, kind, disposition});
    } else return undefined;
  }
  return refs;
}

export function containsControlQuote(body: string, quote: string): boolean {
  const index = body.indexOf(quote);
  return index !== -1 && body.indexOf(quote, index + 1) === -1 &&
    !/[\p{L}\p{N}_-]/u.test(body[index - 1] ?? '') &&
    !/[\p{L}\p{N}_-]/u.test(body[index + quote.length] ?? '');
}

export const HUB_MODE_ACTION_WORDS: readonly string[] = ['set', 'change', 'switch', 'enter', 'put'];

export function citesHubModeIntent(ownerText: string, intent: unknown, mode?: string): boolean {
  if (typeof intent !== 'object' || intent === null || Array.isArray(intent) ||
      !('kind' in intent) || intent.kind !== 'switch' || !('actionQuote' in intent) || !('actionWord' in intent)) return false;
  const {actionQuote, actionWord} = intent;
  if (typeof actionQuote !== 'string' || actionQuote.length === 0 || actionQuote.length > 512 ||
      actionQuote !== actionQuote.trim() || hubModeChoice(actionQuote) !== undefined ||
      !containsControlQuote(ownerText, actionQuote) || typeof actionWord !== 'string' ||
      !HUB_MODE_ACTION_WORDS.includes(actionWord.toLowerCase()) || !containsControlQuote(actionQuote, actionWord)) return false;
  if (mode === undefined) return Object.keys(intent).length === 3;
  if (Object.keys(intent).length !== 4 || !('modeQuote' in intent)) return false;
  const {modeQuote} = intent;
  return typeof modeQuote === 'string' && modeQuote.toLowerCase() === mode && containsControlQuote(actionQuote, modeQuote);
}

export function catalogQuoteNames(quote: string, id: string, label = id, owner?: string): boolean {
  if (quote.startsWith('id:')) return quote.slice(3) === id;
  const name = normalizedControlText(quote);
  const bare = name.replace(/^(?:the|my) /u, '');
  const ownerName = owner?.split('/').at(-1);
  const names = ownerName === undefined ? [label, id] : [label, id, `${ownerName} ${label}`, `${ownerName} ${id}`];
  return name !== '' && names.map(normalizedControlText).some(value => value === name || value === bare);
}

/** A shorter label inside the cited name is harmless. A separate or enclosing label needs clarification. */
export function catalogReferenceConflict(body: string, quote: string, id: string, label: string): boolean {
  const index = body.indexOf(quote);
  if (index < 0) return true;
  const before = body.slice(0, index), after = body.slice(index + quote.length);
  return [id, label].some(value => containsControlValue(before, value) || containsControlValue(after, value) ||
    containsControlValue(body, value) && !containsControlValue(quote, value));
}

export function catalogSelections(refs: readonly CatalogReference[], role: CatalogReferenceRole): readonly CatalogReference[] {
  const selected = refs.filter(ref => ref.role === role && ref.disposition === 'select');
  return selected.some(ref => ref.source === 'answer') ? selected.filter(ref => ref.source === 'answer') : selected;
}

export function catalogExcluded(refs: readonly CatalogReference[], role: CatalogReferenceRole, id: string, label = id, owner?: string): boolean {
  return refs.some(ref => ref.role === role && ref.disposition === 'exclude' && catalogQuoteNames(ref.quote, id, label, owner));
}

export function catalogSelectionText(scope: ModelControlScope, refs: readonly CatalogReference[], source: CurrentCitation['source']): string {
  const body = source === 'request' ? scope.request.text : scope.answer?.text ?? '';
  const excluded = refs.filter(ref => ref.source === source && ref.disposition === 'exclude');
  return excluded.reduce((text, ref) => text.replace(ref.quote, ' '.repeat(ref.quote.length)), body);
}

export function catalogExactTargets(scope: ModelControlScope, refs: readonly CatalogReference[]): readonly string[] {
  return exactControlIds(`${catalogSelectionText(scope, refs, 'request')} ${catalogSelectionText(scope, refs, 'answer')}`);
}

const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'] as const;
export function catalogCueReferences(id: string, index: number): readonly string[] {
  const ordinal = ordinals[index];
  const position = String(index + 1);
  return [id, position, `cue ${position}`, `cue number ${position}`, ...(ordinal === undefined ? [] : [`${ordinal} cue`])];
}
