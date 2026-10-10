/** Browser-safe selected records. Original JSON, room names and map bytes stay in the private archive. */
export const STATUS_SCHEMA = 'https://bunny.invalid/events/roborock-vacuum/2.0';
export type Value<T> = {
    status: 'unknown';
} | {
    status: 'known';
    value: T;
};
export const UNKNOWN = { status: 'unknown' } as const;
export type StatusFields = {
    state: Value<number>;
    batteryPercent: Value<number>;
    cleanTimeSeconds: Value<number>;
    cleanAreaMm2: Value<number>;
    inCleaning: Value<number>;
    inReturning: Value<number>;
    errorCode: Value<number>;
    dockErrorStatus: Value<number>;
    chargeStatus: Value<number>;
    dustCollectionStatus: Value<number>;
    waterBoxStatus: Value<number>;
    waterShortageStatus: Value<number>;
    washStatus: Value<number>;
    washPhase: Value<number>;
    dryStatus: Value<number>;
    avoidCount: Value<number>;
    dss: Value<number>;
};
export type Consumables = {
    observedAtMs: Value<number>;
    mainBrushSeconds: Value<number>;
    sideBrushSeconds: Value<number>;
    filterSeconds: Value<number>;
    filterElementSeconds: Value<number>;
    sensorSeconds: Value<number>;
    strainerCycles: Value<number>;
    dustCollectionCycles: Value<number>;
    cleaningBrushCycles: Value<number>;
};
export type Totals = {
    observedAtMs: Value<number>;
    cleanTimeSeconds: Value<number>;
    cleanAreaMm2: Value<number>;
    cleanCount: Value<number>;
    dustCollectionCount: Value<number>;
};
export type VacuumStatus = {
    schema: 'roborock-vacuum/2.0';
    id: string;
    revision: number;
    observedAtMs: Value<number>;
    availability: 'unknown' | 'available' | 'unavailable';
    activity: 'unknown' | 'cleaning' | 'returning' | 'other';
    status: StatusFields;
    consumables: Consumables;
    totals: Totals;
    collection: {
        retainedRuns: number;
        observedSamples: number;
        gaps: number;
        history: 'partial';
        maps: 'unverified';
        clock: 'unqualified';
        lastFailure: Value<string>;
    };
};
export type RunRecord = {
    recordId: number;
    observedAtMs: number;
    startAtMs: number;
    endAtMs: Value<number>;
    durationSeconds: Value<number>;
    areaMm2: Value<number>;
    cleanedAreaMm2: Value<number>;
    errorCode: Value<number>;
    complete: Value<number>;
    startType: Value<number>;
    cleanType: Value<number>;
    finishReason: Value<number>;
    avoidCount: Value<number>;
    washCount: Value<number>;
    battery: {
        availability: 'missing' | 'partial';
        samples: number;
        clock: 'unqualified';
    };
    map: {
        availability: 'missing' | 'unverified';
        reason: 'not-observed' | 'capture-failed' | 'candidate-window' | 'ambiguous-window';
    };
};
export type RunsPage = {
    schema: 'roborock-runs/2.0';
    id: string;
    revision: number;
    history: 'partial';
    runs: RunRecord[];
    next: Value<string>;
};
export type BatterySample = {
    observationId: string;
    observedAtMs: number;
    batteryPercent: number;
};
export type CollectionGap = {
    startAtMs: number;
    endAtMs: Value<number>;
    reason: 'restart' | 'unavailable' | 'missed-poll' | 'storage';
};
export type SamplesPage = {
    schema: 'roborock-samples/2.0';
    id: string;
    revision: number;
    recordId: number;
    clock: 'unqualified';
    samples: BatterySample[];
    gaps: CollectionGap[];
    next: Value<string>;
};
export const STATUS_FIELD_KEYS = ['state', 'batteryPercent', 'cleanTimeSeconds', 'cleanAreaMm2', 'inCleaning', 'inReturning', 'errorCode', 'dockErrorStatus', 'chargeStatus', 'dustCollectionStatus', 'waterBoxStatus', 'waterShortageStatus', 'washStatus', 'washPhase', 'dryStatus', 'avoidCount', 'dss'] as const;
export const CONSUMABLE_KEYS = ['mainBrushSeconds', 'sideBrushSeconds', 'filterSeconds', 'filterElementSeconds', 'sensorSeconds', 'strainerCycles', 'dustCollectionCycles', 'cleaningBrushCycles'] as const;
export function emptyStatus(id: string): VacuumStatus {
    return { schema: 'roborock-vacuum/2.0', id, revision: 0, observedAtMs: UNKNOWN, availability: 'unknown', activity: 'unknown',
        status: Object.fromEntries(STATUS_FIELD_KEYS.map(key => [key, UNKNOWN])) as StatusFields,
        consumables: { observedAtMs: UNKNOWN, ...Object.fromEntries(CONSUMABLE_KEYS.map(key => [key, UNKNOWN])) } as Consumables,
        totals: { observedAtMs: UNKNOWN, cleanTimeSeconds: UNKNOWN, cleanAreaMm2: UNKNOWN, cleanCount: UNKNOWN, dustCollectionCount: UNKNOWN },
        collection: { retainedRuns: 0, observedSamples: 0, gaps: 0, history: 'partial', maps: 'unverified', clock: 'unqualified', lastFailure: UNKNOWN } };
}
