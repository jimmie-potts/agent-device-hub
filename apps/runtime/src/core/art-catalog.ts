// Retained saved art beyond the art owner's published record (Hub #1584). The `art` record holds the 24 most recent
// artworks. For an owner show of an older one, the core reads that artwork's summary from the art owner's private
// `catalog` content, the pages the gallery reads, through the module host, as the gateway does for an authenticated
// reader. This is ADR 0012's fetch of larger content by reference from its owner. It runs once per show command with a
// bounded wait. It never repeats to watch for state, and it never retries.
import {errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {artContentRef, type ArtworkSummary} from '@jimmie-potts/event-contracts/v2/art-state';
import type {ModuleContent, ModuleManifest, ModuleScheduler} from '@jimmie-potts/sdk';

/** One retained artwork's summary, `undefined` when the art owner retains no such artwork, or why it could not be read. */
export type ArtCatalogRead = (artworkId: string) => Promise<ArtworkSummary | undefined | ErrorBody>;
/** The module host's running contributions, as the gateway reads them. */
export type ArtCatalogHost = {
  modules(): readonly {readonly name: string; readonly admitted: boolean; readonly manifest: Pick<ModuleManifest, 'apiVersion' | 'content'>}[];
  invoke<T>(name: string, call: () => T | Promise<T>): Promise<T>;
};

/** The art owner's module name: the same owner whose `art` record the core follows. */
const ART_MODULE = 'art';
/** The art owner's largest catalog page. */
const PAGE = 100;
/** The whole scan's bound, as the gateway bounds one contribution; the show's 20 s lead starts after it. */
export const ART_CATALOG_TIMEOUT_MS = 5000;

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
/** The fields the show's composition rules read, checked before the summary is trusted. */
function summaryOf(value: unknown): ArtworkSummary | undefined {
  if (!object(value) || typeof value.artworkId !== 'string' || !Array.isArray(value.compositions)) return undefined;
  const valid = value.compositions.every(item => object(item) && typeof item.target === 'string' && typeof item.outcome === 'string'
    && (typeof item.compositionId === 'string' || item.compositionId === null) && Array.isArray(item.renditions));
  return valid ? value as ArtworkSummary : undefined;
}
type Page = {artworks: readonly unknown[]; nextAfter: number | null};
function pageOf(found: ModuleContent | ErrorBody | undefined): Page | undefined {
  if (found === undefined || 'error' in found || found.type.split(';')[0]?.trim() !== 'application/json') return undefined;
  let value: unknown;
  try {value = JSON.parse(new TextDecoder().decode(found.bytes));} catch {return undefined;}
  if (!object(value) || !Array.isArray(value.artworks)) return undefined;
  const {nextAfter} = value;
  return nextAfter === null || (typeof nextAfter === 'number' && Number.isSafeInteger(nextAfter) && nextAfter > 0) ? {artworks: value.artworks, nextAfter} : undefined;
}

/**
 * Reads the art owner's catalog newest first until the artwork or the last page. Each cursor must move strictly toward
 * older art, so a scan always ends. A missing or stopped owner, a refused or malformed page and the time bound are all
 * `unavailable`.
 */
export function hostedArtCatalog(host: ArtCatalogHost, scheduler: ModuleScheduler): ArtCatalogRead {
  return async artworkId => {
    const unavailable = errorBody('unavailable', {detail: 'the art owner\'s saved art catalog is unavailable now'});
    const owner = host.modules().find(module => module.name === ART_MODULE && module.admitted);
    const content = owner?.manifest.content;
    if (owner === undefined || content === undefined || Number(owner.manifest.apiVersion.split('.')[1]) < 3) return unavailable;
    const controller = new AbortController();
    let cancel = (): void => {};
    const late = new Promise<ErrorBody>(resolve => {cancel = scheduler.after(ART_CATALOG_TIMEOUT_MS, () => {controller.abort(); resolve(unavailable);});});
    const scan = async (): Promise<ArtworkSummary | undefined | ErrorBody> => {
      let after = 0;
      for (;;) {
        const query = Object.freeze({after: String(after), limit: String(PAGE)});
        const page = pageOf(await host.invoke(ART_MODULE, () => content(artContentRef.catalog, {query, signal: controller.signal})));
        if (controller.signal.aborted) return unavailable;
        if (page === undefined) return unavailable;
        const match = page.artworks.find(item => object(item) && item.artworkId === artworkId);
        if (match !== undefined) return summaryOf(match) ?? unavailable;
        if (page.nextAfter === null) return undefined;
        if (after !== 0 && page.nextAfter >= after) return unavailable;
        after = page.nextAfter;
      }
    };
    try {return await Promise.race([scan().catch(() => unavailable), late]);}
    finally {cancel();}
  };
}
