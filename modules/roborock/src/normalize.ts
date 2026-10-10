/** Pinned ioBroker.roborock ce998f6980b9928af800d8083cbe794f3b93ca97 forms; firmware/clock meanings remain unqualified. */
export type Field<T> = {
    kind: 'known';
    value: T;
} | {
    kind: 'unknown';
    reason: 'absent' | 'invalid' | 'unqualified';
};
export type TaskId = number | string;
type Layout = 'object' | 'positional';
type ObjectValue = {
    [key: string]: unknown;
};
type Input = {
    value: ObjectValue | undefined;
    layout: Field<Layout>;
};
export type Activity = 'cleaning' | 'returning' | 'other' | 'unknown';
export type DockComponent = {
    raw: Field<number>;
    sourceLabel: Field<'unsupported' | 'maintenance' | 'ok' | 'unknown'>;
    qualification: 'unqualified';
};
export type Dock = {
    rawDss: Field<number>;
    cleaningFluid: DockComponent;
    waterBoxFilter: DockComponent;
    dustBag: DockComponent;
    dirtyWaterBox: DockComponent;
    cleanWaterBox: DockComponent;
    waterReady: DockComponent;
};
export type Status = {
    layout: Field<Layout>;
    stateCode: Field<number>;
    inCleaningCode: Field<number>;
    inReturningCode: Field<number>;
    batteryPercent: Field<number>;
    cleanTimeSeconds: Field<number>;
    cleanAreaMm2: Field<number>;
    errorCode: Field<number>;
    dockTypeCode: Field<number>;
    dockErrorCode: Field<number>;
    dustCollectionStatusCode: Field<number>;
    chargeStatusCode: Field<number>;
    washPhaseCode: Field<number>;
    washReadyCode: Field<number>;
    washStatusCode: Field<number>;
    dryStatusCode: Field<number>;
    mapStatusCode: Field<number>;
    waterBoxStatusCode: Field<number>;
    waterShortageCode: Field<number>;
    avoidCount: Field<number>;
    taskId: Field<TaskId>;
    dock: Dock;
};
export type Summary = {
    layout: Field<Layout>;
    cleanTimeSeconds: Field<number>;
    cleanAreaMm2: Field<number>;
    cleanCount: Field<number>;
    dustCollectionCount: Field<number>;
    recordIds: Field<readonly number[]>;
    invalidRecordIdCount: number;
};
export type CleanRecord = {
    layout: Field<Layout>;
    recordId: Field<number>;
    beginSeconds: Field<number>;
    endSeconds: Field<number>;
    durationSeconds: Field<number>;
    areaMm2: Field<number>;
    cleanedAreaMm2: Field<number>;
    errorCode: Field<number>;
    completeCode: Field<number>;
    startTypeCode: Field<number>;
    cleanTypeCode: Field<number>;
    finishReasonCode: Field<number>;
    dustCollectionStatusCode: Field<number>;
    avoidCount: Field<number>;
    washCount: Field<number>;
    taskId: Field<TaskId>;
    mapFlagCode: Field<number>;
    cleanTimes: Field<number>;
    extraTimeRaw: Field<number>;
    extraTimeSeconds: Field<number>;
    manualReplenishCode: Field<number>;
    dirtyReplenishCode: Field<number>;
    subSourceCode: Field<number>;
};
export type ConsumableKey = 'main_brush_work_time' | 'side_brush_work_time' | 'filter_work_time' | 'filter_element_work_time' | 'sensor_dirty_time' | 'dust_collection_work_times' | 'strainer_work_times' | 'cleaning_brush_work_times';
export type Consumable = {
    sourceKey: ConsumableKey;
    unit: 'seconds' | 'cycles';
    used: Field<number>;
};
export type Consumables = {
    layout: Field<Layout>;
    items: readonly Consumable[];
};
const known = <T>(value: T): Field<T> => ({ kind: 'known', value });
const unknown = <T>(reason: 'absent' | 'invalid' | 'unqualified'): Field<T> => ({ kind: 'unknown', reason });
const integer = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max;
const epoch = (v: unknown): v is number => integer(v, 1, 0xffffffff);
function dataObject(v: unknown): v is ObjectValue {
    if (typeof v !== 'object' || v === null || Array.isArray(v))
        return false;
    const prototype: unknown = Object.getPrototypeOf(v);
    return (prototype === Object.prototype || prototype === null) && Object.values(Object.getOwnPropertyDescriptors(v)).every(d => Object.hasOwn(d, 'value'));
}
function input(original: unknown, slots?: readonly string[], lengths: readonly number[] = []): Input {
    const v = Array.isArray(original) && original.length === 1 ? original[0] as unknown : original;
    if (dataObject(v))
        return { value: v, layout: known('object') };
    if (slots !== undefined && Array.isArray(v) && lengths.includes(v.length))
        return { value: Object.fromEntries(slots.slice(0, v.length).map((key, i) => [key, v[i] as unknown])), layout: known('positional') };
    return { value: undefined, layout: unknown(original === undefined ? 'absent' : 'invalid') };
}
function field<T>(src: Input, key: string, accepts: (v: unknown) => v is T): Field<T> {
    if (src.value === undefined)
        return unknown(src.layout.kind === 'unknown' ? src.layout.reason : 'invalid');
    if (!Object.hasOwn(src.value, key))
        return unknown('absent');
    const v = src.value[key];
    return accepts(v) ? known(v) : unknown('invalid');
}
const number = (s: Input, k: string, min = 0, max = Number.MAX_SAFE_INTEGER): Field<number> => field(s, k, (v): v is number => integer(v, min, max));
const code = (s: Input, k: string): Field<number> => number(s, k, -0x80000000, 0xffffffff);
const taskId = (s: Input): Field<TaskId> => field(s, 'task_id', (v): v is TaskId => typeof v === 'number' ? integer(v) : typeof v === 'string' && v.length >= 1 && v.length <= 128 && Array.from(v).every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127));
function dock(s: Input): Dock {
    const rawDss = number(s, 'dss', 0, 0xffffffff);
    const component = (shift: number): DockComponent => {
        if (rawDss.kind === 'unknown')
            return { raw: unknown(rawDss.reason), sourceLabel: unknown(rawDss.reason), qualification: 'unqualified' };
        const raw = (rawDss.value >>> shift) & 3, label = raw === 0 ? 'unsupported' : raw === 1 ? 'maintenance' : raw === 2 ? 'ok' : 'unknown';
        return { raw: known(raw), sourceLabel: known(label), qualification: 'unqualified' };
    };
    return { rawDss, cleaningFluid: component(10), waterBoxFilter: component(8), dustBag: component(6), dirtyWaterBox: component(4), cleanWaterBox: component(2), waterReady: component(0) };
}
export function normalizeStatus(v: unknown): Status {
    const s = input(v);
    return { layout: s.layout, stateCode: code(s, 'state'), inCleaningCode: code(s, 'in_cleaning'), inReturningCode: code(s, 'in_returning'), batteryPercent: number(s, 'battery', 0, 100), cleanTimeSeconds: number(s, 'clean_time'), cleanAreaMm2: number(s, 'clean_area'), errorCode: code(s, 'error_code'), dockTypeCode: code(s, 'dock_type'), dockErrorCode: code(s, 'dock_error_status'), dustCollectionStatusCode: code(s, 'dust_collection_status'), chargeStatusCode: code(s, 'charge_status'), washPhaseCode: code(s, 'wash_phase'), washReadyCode: code(s, 'wash_ready'), washStatusCode: code(s, 'wash_status'), dryStatusCode: code(s, 'dry_status'), mapStatusCode: code(s, 'map_status'), waterBoxStatusCode: code(s, 'water_box_status'), waterShortageCode: code(s, 'water_shortage_status'), avoidCount: number(s, 'avoid_count'), taskId: taskId(s), dock: dock(s) };
}
const cleaningStates = new Set([5, 11, 17, 18]), returningStates = new Set([6, 15]);
const otherStates = new Set([1, 2, 3, 4, 7, 8, 9, 10, 12, 13, 14, 16, 22, 23, 25, 26, 28, 29, 30, 32, 33, 34, 36, 37, 38, 39, 40, 41, 42, 100]);
export function activity(s: Status): Activity {
    const state = s.stateCode.kind === 'known' ? s.stateCode.value : undefined;
    const cleaning = (state !== undefined && cleaningStates.has(state)) || (s.inCleaningCode.kind === 'known' && s.inCleaningCode.value === 1);
    const returning = (state !== undefined && returningStates.has(state)) || (s.inReturningCode.kind === 'known' && s.inReturningCode.value === 1);
    if (cleaning && returning)
        return 'unknown';
    if (cleaning)
        return 'cleaning';
    if (returning)
        return 'returning';
    if ([s.inCleaningCode, s.inReturningCode].some(v => v.kind === 'unknown' ? v.reason !== 'absent' : v.value !== 0 && v.value !== 1))
        return 'unknown';
    return state !== undefined && otherStates.has(state) ? 'other' : 'unknown';
}
export function normalizeSummary(v: unknown): Summary {
    const s = input(v, ['clean_time', 'clean_area', 'clean_count', 'records'], [4]);
    let recordIds: Field<readonly number[]>;
    let invalidRecordIdCount = 0;
    if (s.value === undefined)
        recordIds = unknown(s.layout.kind === 'unknown' ? s.layout.reason : 'invalid');
    else if (!Object.hasOwn(s.value, 'records'))
        recordIds = unknown('absent');
    else if (!Array.isArray(s.value.records))
        recordIds = unknown('invalid');
    else {
        const ids = new Set<number>();
        for (const id of s.value.records) {
            if (epoch(id))
                ids.add(id);
            else
                invalidRecordIdCount++;
        }
        recordIds = invalidRecordIdCount > 0 && ids.size === 0 ? unknown('invalid') : known([...ids]);
    }
    return { layout: s.layout, cleanTimeSeconds: number(s, 'clean_time'), cleanAreaMm2: number(s, 'clean_area'), cleanCount: number(s, 'clean_count'), dustCollectionCount: number(s, 'dust_collection_count'), recordIds, invalidRecordIdCount };
}
export function normalizeRecord(v: unknown, requested: unknown): CleanRecord {
    const s = input(v, ['begin', 'end', 'duration', 'area', 'error', 'complete', 'start_type', 'clean_type', 'finish_reason', 'dust_collection_status'], [9, 10]);
    const beginSeconds = field(s, 'begin', epoch);
    let endSeconds = field(s, 'end', epoch);
    if (beginSeconds.kind === 'known' && endSeconds.kind === 'known' && endSeconds.value < beginSeconds.value)
        endSeconds = unknown('invalid');
    const recordId: Field<number> = !epoch(requested) ? unknown('invalid') : beginSeconds.kind === 'unknown' ? unknown(beginSeconds.reason) : beginSeconds.value === requested ? known(requested) : unknown('invalid');
    return { layout: s.layout, recordId, beginSeconds, endSeconds, durationSeconds: number(s, 'duration'), areaMm2: number(s, 'area'), cleanedAreaMm2: number(s, 'cleaned_area'), errorCode: code(s, 'error'), completeCode: code(s, 'complete'), startTypeCode: code(s, 'start_type'), cleanTypeCode: code(s, 'clean_type'), finishReasonCode: code(s, 'finish_reason'), dustCollectionStatusCode: code(s, 'dust_collection_status'), avoidCount: number(s, 'avoid_count'), washCount: number(s, 'wash_count'), taskId: taskId(s), mapFlagCode: code(s, 'map_flag'), cleanTimes: number(s, 'clean_times'), extraTimeRaw: number(s, 'extra_time'), extraTimeSeconds: unknown('unqualified'), manualReplenishCode: code(s, 'manual_replenish'), dirtyReplenishCode: code(s, 'dirty_replenish'), subSourceCode: code(s, 'sub_source') };
}
const consumableKeys: readonly ConsumableKey[] = ['main_brush_work_time', 'side_brush_work_time', 'filter_work_time', 'filter_element_work_time', 'sensor_dirty_time', 'dust_collection_work_times', 'strainer_work_times', 'cleaning_brush_work_times'];
export function normalizeConsumables(v: unknown): Consumables {
    const s = input(v);
    return { layout: s.layout, items: consumableKeys.map(sourceKey => ({ sourceKey, unit: sourceKey.endsWith('_times') ? 'cycles' : 'seconds', used: number(s, sourceKey) })) };
}
