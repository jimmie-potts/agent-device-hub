import {containsControlValue, literalDeviceId, normalizedControlText} from './control-intent.js';
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
export type CatalogReference = {role: CatalogReferenceRole; kind: 'named' | 'prior'; source: 'request' | 'answer'; quote: string};
export const catalogReferenceRoles = ['primary', 'artwork', 'asset', 'draft', 'playlist', 'rendition', 'scene',
  'notice', 'preset', 'operation', 'session', 'favorite', 'playlist-item', 'cue'] as const satisfies readonly CatalogReferenceRole[];
const referenceRoles = new Set<string>(catalogReferenceRoles);
export const isCatalogSelectorKind = (role: CatalogReferenceRole): role is CatalogSelectorKind => Object.hasOwn(ids, role);

export function readCatalogReferences(value: unknown, scope: ModelControlScope): readonly CatalogReference[] | undefined {
  if (!Array.isArray(value) || value.length > 8) return undefined;
  const refs: CatalogReference[] = [];
  const input: readonly unknown[] = value;
  for (const item of input) {
    if (typeof item !== 'object' || item === null || Array.isArray(item) || Object.keys(item).length !== 4) return undefined;
    const {role, kind, source, quote} = item as Record<string, unknown>;
    if (typeof role !== 'string' || !referenceRoles.has(role) || kind !== 'named' && kind !== 'prior' ||
      source !== 'request' && source !== 'answer' || typeof quote !== 'string' || quote !== quote.trim() ||
      quote.length === 0 || quote.length > 131) return undefined;
    const body = source === 'request' ? scope.request.text : scope.answer?.text;
    if (body === undefined || !containsControlQuote(body, quote, kind === 'prior')) return undefined;
    const ref = {role: role as CatalogReferenceRole, kind, source, quote} satisfies CatalogReference;
    if (refs.some(prior => prior.quote === quote && prior.source === source)) return undefined;
    refs.push(ref);
  }
  return refs;
}

function containsControlQuote(body: string, quote: string, prior: boolean): boolean {
  const index = body.indexOf(quote);
  if (index === -1 || body.indexOf(quote, index + 1) !== -1 ||
    /[\p{L}\p{N}_-]/u.test(body[index - 1] ?? '') ||
    /[\p{L}\p{N}_-]/u.test(body[index + quote.length] ?? '')) return false;
  if (!prior) return true;
  // A reference in a second instruction cannot identify the target of the first.
  const before = body.slice(0, index).trim();
  const reference = /^(?:it|them|(?:this|that|the same|the previous|the first|the second|the last)(?: (?:one|asset|original|image|artwork|animation|draft|cue|scene|playlist|rendition|speaker|screen|panel|display|light|device|record|item|notice|preset|session))?)$/iu;
  return reference.test(normalizedControlText(quote)) &&
    !/[.!?;]|\b(?:and|then|but|or)\b|\b(?:like|as)$/iu.test(before);
}

export function catalogQuoteNames(quote: string, id: string, label = id): boolean {
  if (quote.startsWith('id:')) return quote.slice(3) === id;
  const name = normalizedControlText(quote).replace(/^(?:the|my) /u, '');
  return name !== '' && (name === normalizedControlText(label) || name === normalizedControlText(id));
}

/** A shorter label inside the cited name is harmless. A separate or enclosing label needs clarification. */
export function catalogReferenceConflict(body: string, quote: string, id: string, label: string): boolean {
  const index = body.indexOf(quote);
  if (index < 0) return true;
  const before = body.slice(0, index), after = body.slice(index + quote.length);
  return [id, label].some(value => containsControlValue(before, value) || containsControlValue(after, value) ||
    containsControlValue(body, value) && !containsControlValue(quote, value));
}

export function catalogReferencesFor(refs: readonly CatalogReference[], role: CatalogReferenceRole): readonly CatalogReference[] {
  const matching = refs.filter(ref => ref.role === role);
  return matching.some(ref => ref.source === 'answer') ? matching.filter(ref => ref.source === 'answer') : matching;
}

const ordinals = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'] as const;
export function catalogCueReferences(id: string, index: number): readonly string[] {
  const ordinal = ordinals[index];
  const position = String(index + 1);
  return [id, position, `cue ${position}`, `cue number ${position}`, ...(ordinal === undefined ? [] : [`${ordinal} cue`])];
}
