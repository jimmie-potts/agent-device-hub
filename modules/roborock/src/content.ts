import { errorBody, type ErrorBody } from '@jimmie-potts/event-contracts/v2';
import { fullDisk, SdkError, type ModuleContent, type ModuleContentRequest } from '@jimmie-potts/sdk';
import { UNKNOWN, type VacuumStatus } from './contracts.js';
import { validateRun, validateRuns, validateSamples, validateStatus } from './families.js';
import type { RoborockStore } from './store.js';
const cancelled = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;
const fail = (code: 'invalid-request' | 'invalid-message' | 'cancelled' | 'not-found' | 'too-large' | 'internal' | 'capacity'): ErrorBody => errorBody(code, { detail: 'The Roborock read was refused.' });
function decimal(value: string | undefined, min: number, max: number): number | undefined {
    if (value === undefined || !/^(0|[1-9]\d*)$/u.test(value))
        return undefined;
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= min && n <= max ? n : undefined;
}
/** Fixed projections only. No query can select a file, raw archive, room name or map bytes. */
export function readContent(ref: string, request: ModuleContentRequest | undefined, state: VacuumStatus, store: RoborockStore | undefined): ModuleContent | ErrorBody | undefined {
    if (!['status', 'runs', 'run', 'samples'].includes(ref))
        return undefined;
    if (cancelled(request?.signal))
        return fail('cancelled');
    const q = request?.query ?? {}, keys = Object.keys(q);
    const allowed = ref === 'status' ? [] : ref === 'runs' ? ['cursor', 'limit'] : ref === 'run' ? ['recordId'] : ['recordId', 'cursor', 'limit'];
    if (keys.some(k => !allowed.includes(k)))
        return fail('invalid-request');
    const size = q.limit === undefined ? (ref === 'runs' ? 25 : 100) : decimal(q.limit, 1, ref === 'runs' ? 25 : 100);
    if (size === undefined || (q.cursor !== undefined && (q.cursor.length < 1 || q.cursor.length > 128)))
        return fail('invalid-request');
    const id = decimal(q.recordId, 1, 0xffffffff);
    if ((ref === 'run' || ref === 'samples') && id === undefined)
        return fail('invalid-request');
    try {
        let value: unknown;
        let valid: (value: unknown) => boolean;
        switch (ref) {
            case 'status':
                value = state;
                valid = validateStatus;
                break;
            case 'runs': {
                const page = store?.hasIdentity() === true ? store.listRuns(q.cursor, size) : { items: [], next: null };
                value = { schema: 'roborock-runs/2.0', id: state.id, revision: state.revision, history: 'partial', runs: page.items, next: page.next === null ? UNKNOWN : { status: 'known', value: page.next } };
                valid = validateRuns;
                break;
            }
            case 'run': {
                if (id === undefined)
                    return fail('invalid-request');
                const run = store?.hasIdentity() === true ? store.getRun(id) : undefined;
                if (!run)
                    return fail('not-found');
                value = { schema: 'roborock-run/2.0', id: state.id, revision: state.revision, run };
                valid = validateRun;
                break;
            }
            default: {
                if (id === undefined)
                    return fail('invalid-request');
                if (store?.hasIdentity() !== true || store.getRun(id) === undefined)
                    return fail('not-found');
                const page = store.listSamples(id, q.cursor, size, size);
                value = { schema: 'roborock-samples/2.0', id: state.id, revision: state.revision, recordId: id, clock: 'unqualified', samples: page.samples, gaps: page.gaps, next: page.next === null ? UNKNOWN : { status: 'known', value: page.next } };
                valid = validateSamples;
            }
        }
        if (!valid(value))
            return fail('invalid-message');
        const bytes = Buffer.from(JSON.stringify(value));
        if (bytes.length > 256 * 1024)
            return fail('too-large');
        if (cancelled(request?.signal))
            return fail('cancelled');
        return { type: 'application/json', bytes };
    }
    catch (error) {
        return error instanceof SdkError ? errorBody(error.body.error.code, { detail: 'The Roborock read was refused.' }) : fail(fullDisk(error) ? 'capacity' : 'internal');
    }
}
