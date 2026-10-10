import type { Message } from '@jimmie-potts/event-contracts/v2';
import { isErrorCode, type ErrorCode } from '@jimmie-potts/event-contracts/v2/errors';
import { STATUS_SCHEMA, type RunRecord, type RunsPage, type SamplesPage, type VacuumStatus } from '../contracts.js';
type Check = (value: unknown) => boolean;
export type RunDocument = {
    schema: 'roborock-run/2.0';
    id: string;
    revision: number;
    run: RunRecord;
};
const OWNER = 'bunny/modules/roborock';
const MAX_INTEGER = Number.MAX_SAFE_INTEGER;
function object(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object'
        && value !== null
        && Object.getPrototypeOf(value) === Object.prototype;
}
function closed(shape: Readonly<Record<string, Check>>): Check {
    const keys = Object.keys(shape);
    return input => {
        if (!object(input) || Reflect.ownKeys(input).length !== keys.length)
            return false;
        return keys.every(key => {
            const descriptor = Object.getOwnPropertyDescriptor(input, key);
            const check = shape[key];
            return descriptor !== undefined
                && descriptor.enumerable === true
                && 'value' in descriptor
                && check !== undefined
                && check(descriptor.value);
        });
    };
}
function literal(expected: string): Check {
    return value => value === expected;
}
function enumeration(values: readonly string[]): Check {
    return value => typeof value === 'string' && values.includes(value);
}
function integer(minimum: number, maximum: number): Check {
    return value => typeof value === 'number'
        && Number.isSafeInteger(value)
        && value >= minimum
        && value <= maximum;
}
function boundedString(minimum: number, maximum: number, pattern?: RegExp): Check {
    return value => typeof value === 'string'
        && value.length >= minimum
        && value.length <= maximum
        && (pattern === undefined || pattern.test(value));
}
function wrapped(check: Check): Check {
    const unknown = closed({ status: literal('unknown') });
    const known = closed({ status: literal('known'), value: check });
    return input => unknown(input) || known(input);
}
function boundedArray(check: Check, maximum: number): Check {
    return input => Array.isArray(input)
        && input.length <= maximum
        && Object.keys(input).length === input.length
        && input.every(check);
}
const count = integer(0, MAX_INTEGER);
const rawCode = integer(-0x80000000, 0xffffffff);
const uint32 = integer(0, 0xffffffff);
const recordId = integer(1, 0xffffffff);
const percent = integer(0, 100);
const routingId = boundedString(1, 128, /^[a-z0-9]+(-[a-z0-9]+)*$/u);
const observationId = boundedString(1, 128, /^[A-Za-z0-9_.-]+$/u);
const cursor = wrapped(boundedString(1, 128));
const statusCheck = closed({
    schema: literal('roborock-vacuum/2.0'),
    id: routingId,
    revision: count,
    observedAtMs: wrapped(count),
    availability: enumeration(['unknown', 'available', 'unavailable']),
    activity: enumeration(['unknown', 'cleaning', 'returning', 'other']),
    status: closed({
        state: wrapped(rawCode),
        batteryPercent: wrapped(percent),
        cleanTimeSeconds: wrapped(count),
        cleanAreaMm2: wrapped(count),
        inCleaning: wrapped(rawCode),
        inReturning: wrapped(rawCode),
        errorCode: wrapped(rawCode),
        dockErrorStatus: wrapped(rawCode),
        chargeStatus: wrapped(rawCode),
        dustCollectionStatus: wrapped(rawCode),
        waterBoxStatus: wrapped(rawCode),
        waterShortageStatus: wrapped(rawCode),
        washStatus: wrapped(rawCode),
        washPhase: wrapped(rawCode),
        dryStatus: wrapped(rawCode),
        avoidCount: wrapped(count),
        dss: wrapped(uint32),
    }),
    consumables: closed({
        observedAtMs: wrapped(count),
        mainBrushSeconds: wrapped(count),
        sideBrushSeconds: wrapped(count),
        filterSeconds: wrapped(count),
        filterElementSeconds: wrapped(count),
        sensorSeconds: wrapped(count),
        strainerCycles: wrapped(count),
        dustCollectionCycles: wrapped(count),
        cleaningBrushCycles: wrapped(count),
    }),
    totals: closed({
        observedAtMs: wrapped(count),
        cleanTimeSeconds: wrapped(count),
        cleanAreaMm2: wrapped(count),
        cleanCount: wrapped(count),
        dustCollectionCount: wrapped(count),
    }),
    collection: closed({
        retainedRuns: count,
        observedSamples: count,
        gaps: count,
        history: literal('partial'),
        maps: literal('unverified'),
        clock: literal('unqualified'),
        lastFailure: wrapped(isErrorCode),
    }),
});
const runCheck = closed({
    recordId,
    observedAtMs: count,
    startAtMs: count,
    endAtMs: wrapped(count),
    durationSeconds: wrapped(count),
    areaMm2: wrapped(count),
    cleanedAreaMm2: wrapped(count),
    errorCode: wrapped(rawCode),
    complete: wrapped(rawCode),
    startType: wrapped(rawCode),
    cleanType: wrapped(rawCode),
    finishReason: wrapped(rawCode),
    avoidCount: wrapped(count),
    washCount: wrapped(count),
    battery: closed({
        availability: enumeration(['missing', 'partial']),
        samples: count,
        clock: literal('unqualified'),
    }),
    map: closed({
        availability: enumeration(['missing', 'unverified']),
        reason: enumeration([
            'not-observed',
            'capture-failed',
            'candidate-window',
            'ambiguous-window',
        ]),
    }),
});
const runsCheck = closed({
    schema: literal('roborock-runs/2.0'),
    id: routingId,
    revision: count,
    history: literal('partial'),
    runs: boundedArray(runCheck, 25),
    next: cursor,
});
const runDocumentCheck = closed({
    schema: literal('roborock-run/2.0'),
    id: routingId,
    revision: count,
    run: runCheck,
});
const samplesCheck = closed({
    schema: literal('roborock-samples/2.0'),
    id: routingId,
    revision: count,
    recordId,
    clock: literal('unqualified'),
    samples: boundedArray(closed({
        observationId,
        observedAtMs: count,
        batteryPercent: percent,
    }), 100),
    gaps: boundedArray(closed({
        startAtMs: count,
        endAtMs: wrapped(count),
        reason: enumeration(['restart', 'unavailable', 'missed-poll', 'storage']),
    }), 100),
    next: cursor,
});
export class Refused extends Error {
    readonly code: ErrorCode;
    constructor(code: ErrorCode) {
        super('The Roborock read was refused.');
        this.code = code;
    }
}
export function refusal(error: unknown): ErrorCode {
    if (error instanceof Refused)
        return error.code;
    if (typeof error === 'object' && error !== null && 'body' in error) {
        const body: unknown = error.body;
        if (object(body) && object(body.error) && isErrorCode(body.error.code)) {
            return body.error.code;
        }
    }
    return 'unavailable';
}
function checked<T>(input: unknown, check: Check): T {
    if (!check(input))
        throw new Refused('invalid-message');
    return input as T;
}
export function statusDocument(input: unknown, expectedId?: string): VacuumStatus {
    const value = checked<VacuumStatus>(input, statusCheck);
    if (expectedId !== undefined && value.id !== expectedId) {
        throw new Refused('invalid-message');
    }
    return value;
}
export function runsDocument(input: unknown, expectedId: string): RunsPage {
    const value = checked<RunsPage>(input, runsCheck);
    if (value.id !== expectedId
        || new Set(value.runs.map(run => run.recordId)).size !== value.runs.length) {
        throw new Refused('invalid-message');
    }
    return value;
}
export function runDocument(input: unknown, expectedId: string, expectedRecord: number): RunDocument {
    const value = checked<RunDocument>(input, runDocumentCheck);
    if (value.id !== expectedId || value.run.recordId !== expectedRecord) {
        throw new Refused('invalid-message');
    }
    return value;
}
export function samplesDocument(input: unknown, expectedId: string, expectedRecord: number): SamplesPage {
    const value = checked<SamplesPage>(input, samplesCheck);
    if (value.id !== expectedId
        || value.recordId !== expectedRecord
        || new Set(value.samples.map(sample => sample.observationId)).size
            !== value.samples.length) {
        throw new Refused('invalid-message');
    }
    return value;
}
export function same(left: unknown, right: unknown): boolean {
    if (left === right)
        return true;
    if (Array.isArray(left) && Array.isArray(right)) {
        return left.length === right.length
            && left.every((item, index) => same(item, right[index]));
    }
    if (!object(left) || !object(right))
        return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length
        && keys.every(key => Object.hasOwn(right, key) && same(left[key], right[key]));
}
export function messageStatus(message: Message<VacuumStatus>, expectedId?: string): VacuumStatus {
    const doc = statusDocument(message.data, expectedId);
    const at = Date.parse(message.time);
    if (message.source !== OWNER
        || message.kind !== 'state'
        || message.type !== 'org.bunny.roborock-vacuum.updated'
        || message.dataschema !== STATUS_SCHEMA
        || message.subject !== doc.id
        || !Number.isFinite(at)
        || [doc.observedAtMs, doc.consumables.observedAtMs, doc.totals.observedAtMs]
            .some(value => value.status === 'known' && value.value > at)) {
        throw new Refused('invalid-message');
    }
    return doc;
}
