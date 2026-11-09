// The owner's on-demand show of one saved artwork (Hub #1581). Browser-safe: WebCrypto only, so the gallery and the MCP
// gateway can name the same per-surface operations the core tracks. The family itself registers in `families.ts`.

/** The one subject and routing token of `art-show`: the core's own Hub entity, as for `mode-set`. */
export const ART_SHOW_SUBJECT = 'hub';
export const ART_SHOW_KEY = 'bunny.cmd.art-show.hub';
export const ART_SHOW_TYPE = 'org.bunny.art.show.requested';
export const ART_SHOW_SCHEMA = 'https://bunny.invalid/events/art-show/2.0';
/** The target that names the dashboard's browser surface rather than a configured display. */
export const ART_SHOW_BROWSER = 'browser';
/** How far ahead a show's common start is set: room for preparation without the wait a schedule slot needs. */
export const ART_SHOW_LEAD_MS = 20_000;

/** `org.bunny.art.show.requested`: show one saved artwork now. `coversStatus` defaults to true. */
export type ArtShowRequest = {requestId: string; artworkId: string; targets: string[]; coversStatus?: boolean};

/** The independently tracked operations one surface of a show may have. A missing record means it was not requested. */
export type ArtShowSurface =
  | {target: string; kind: 'display'; prepareRequestId: string; momentRequestId: string}
  | {target: typeof ART_SHOW_BROWSER; kind: 'browser'; presentRequestId: string};

const hex = async (text: string): Promise<string> => Array.from(new Uint8Array(
  await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), value => value.toString(16).padStart(2, '0')).join('');

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
