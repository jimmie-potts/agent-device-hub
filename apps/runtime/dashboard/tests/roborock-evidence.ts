import { setTimeout as pause } from 'node:timers/promises';
import type { Locator, Page } from 'playwright';
import type { VacuumStatus } from '@jimmie-potts/roborock';

/** One bound for every evidence read, so a wedged page or runtime cannot turn a failed wait into a job timeout (#1236). */
export const EVIDENCE_MS = 2000;

/** The value, or why it could not be read within the bound. Never throws. */
export async function bounded(read: Promise<unknown>): Promise<unknown> {
    try {
        return await Promise.race([read, pause(EVIDENCE_MS, undefined, { ref: false }).then(() => { throw new Error(`no answer within ${EVIDENCE_MS} ms`); })]);
    }
    catch (error) {
        return `unreadable: ${error instanceof Error ? error.message : String(error)}`;
    }
}

/** The reader's status summary, or its refusal. Asserts nothing, so a refusal is evidence rather than a new failure. */
export function statusEvidence(url: string, token: string): Promise<unknown> {
    return bounded((async () => {
        const response = await fetch(`${url}/modules/roborock/content/status`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(EVIDENCE_MS) });
        const body: unknown = await response.json().catch(() => 'body unreadable');
        if (response.status !== 200 || typeof body !== 'object' || body === null || !('availability' in body)) {
            const code = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'object' && body.error !== null && 'code' in body.error ? body.error.code : typeof body === 'string' ? body : null;
            return { httpStatus: response.status, code };
        }
        const status = body as VacuumStatus;
        return { shown: `Availability: ${status.availability}. Activity: ${status.activity}.`, revision: status.revision, lastFailure: status.collection.lastFailure };
    })());
}

/** The feed state and the region's availability, age and refusal lines, each read within the bound. */
export async function pageEvidence(page: Page, region: Locator): Promise<{ feed: unknown; page: unknown }> {
    return {
        feed: await bounded(page.locator('main#main').getAttribute('data-feed', { timeout: EVIDENCE_MS })),
        page: await bounded(region.innerText({ timeout: EVIDENCE_MS }).then(text => text.split('\n')
            .filter(line => /^(Availability:|Observation age:|Read refused:|Roborock observations are unknown)/u.test(line)))),
    };
}
