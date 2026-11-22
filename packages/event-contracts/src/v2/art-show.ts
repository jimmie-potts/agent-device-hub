import type {ErrorCode} from './errors.js';

// The owner's on-demand show of one saved artwork (Hub #1581). Browser-safe: WebCrypto only, so the gallery and the MCP
// gateway can name the same per-surface operations the core tracks. The family itself registers in `families.ts`.

/** The one subject and routing token of `art-show`: the core's own Hub entity, as for `mode-set`. */
export const ART_SHOW_SUBJECT = 'hub';
export const ART_SHOW_KEY = 'bunny.cmd.art-show.hub';
export const ART_SHOW_TYPE = 'org.bunny.art.show.requested';

export const ART_SHOW_EFFECTS_FAMILY = 'art-show-effects';
export const ART_SHOW_EFFECTS_SCHEMA = 'https://bunny.invalid/events/art-show-effects/2.0';
export const ART_SHOW_EFFECTS_TYPE = 'org.bunny.art-show-effects.updated';
export type ArtShowSkip = {target: string; phase: 'prepare' | 'present'; code: ErrorCode};
export type ArtShowEffects = {id: string; revision: number; requestId: string; skipped: ArtShowSkip[]};

export const ART_SHOW_SCHEMA = 'https://bunny.invalid/events/art-show/2.0';
/** The target that names the dashboard's browser surface rather than a configured display. */
export const ART_SHOW_BROWSER = 'browser';
/** How far ahead a show's common start is set: room for preparation without the wait a schedule slot needs. */
export const ART_SHOW_LEAD_MS = 20_000;

/** `org.bunny.art.show.requested`: show one saved artwork now. `coversStatus` defaults to true. */
export type ArtShowRequest = {requestId: string; artworkId: string; targets: string[]; coversStatus?: boolean};

/** The independently tracked operations one surface of a show may have. A missing record alone cannot distinguish a skipped request from missing evidence. */
export type ArtShowSurface =
  | {target: string; kind: 'display'; prepareRequestId: string; momentRequestId: string}
  | {target: typeof ART_SHOW_BROWSER; kind: 'browser'; presentRequestId: string};

const hex = async (text: string): Promise<string> => Array.from(new Uint8Array(
  await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), value => value.toString(16).padStart(2, '0')).join('');

export const localGifReference = async (requestId: string, sha256: string): Promise<string> =>
  `localgif-${await hex(JSON.stringify(['art-upload-stage', requestId, sha256]))}`;
export const localGifComposition = (reference: string): string | undefined =>
  /^localgif-[a-f0-9]{64}$/.test(reference) ? reference.slice('localgif-'.length) : undefined;

/** The art plan identity of one show, derived from its request ID alone. */
export const artShowPlanId = async (requestId: string): Promise<string> => `art-show-${await hex(JSON.stringify(['art-show', requestId]))}`;
/** The core's art plan request identity for one phase of one target, as `apps/runtime/src/core/art-plans.ts` derives it. */
export const artPlanPhaseId = async (planId: string, phase: 'prepare' | 'browser' | 'moment', target: string): Promise<string> =>
  `art-plan-${await hex(`${planId}\0${phase}\0${target}`)}`;

/** The operations each requested surface of a show would have, in request order. */
export async function artShowSurfaces(requestId: string, targets: readonly string[]): Promise<ArtShowSurface[]> {
  const planId = await artShowPlanId(requestId);
  return Promise.all(targets.map(async (target): Promise<ArtShowSurface> => target === ART_SHOW_BROWSER
    ? {target, kind: 'browser', presentRequestId: await artPlanPhaseId(planId, 'browser', 'art')}
    : {target, kind: 'display', prepareRequestId: await artPlanPhaseId(planId, 'prepare', target), momentRequestId: await artPlanPhaseId(planId, 'moment', target)}));
}

export const ART_ATTACHMENT_FAMILY = 'art-attachment-edit';
export const MAX_ART_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const uploadArtworkId = (requestId: string): string => `upload-${requestId}`;
export const isUploadArtworkId = (id: string): boolean => /^upload-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
