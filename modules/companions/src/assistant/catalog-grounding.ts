import {containsControlValue, literalDeviceId} from './control-intent.js';
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
