import type { CleanRecord, Status, Summary, Consumables as SourceConsumables, Field } from './normalize.js';
import { UNKNOWN, type Value, type RunRecord, type StatusFields, type Consumables, type Totals } from './contracts.js';
export const publicValue = <T>(f: Field<T>): Value<T> => f.kind === 'known' ? { status: 'known', value: f.value } : UNKNOWN;
/** Record identity is a source identifier; source instants convert explicitly to the shared public millisecond form. */
export function projectRun(r: CleanRecord, observedAtMs: number): RunRecord | undefined {
    if (r.recordId.kind !== 'known' || r.beginSeconds.kind !== 'known')
        return undefined;
    return { recordId: r.recordId.value, observedAtMs, startAtMs: r.beginSeconds.value * 1000, endAtMs: r.endSeconds.kind === 'known' ? { status: 'known', value: r.endSeconds.value * 1000 } : UNKNOWN,
        durationSeconds: publicValue(r.durationSeconds), areaMm2: publicValue(r.areaMm2), cleanedAreaMm2: publicValue(r.cleanedAreaMm2), errorCode: publicValue(r.errorCode), complete: publicValue(r.completeCode), startType: publicValue(r.startTypeCode), cleanType: publicValue(r.cleanTypeCode), finishReason: publicValue(r.finishReasonCode), avoidCount: publicValue(r.avoidCount), washCount: publicValue(r.washCount),
        battery: { availability: 'missing', samples: 0, clock: 'unqualified' }, map: { availability: 'missing', reason: 'not-observed' } };
}
export function projectStatusFields(s: Status): StatusFields {
    return { state: publicValue(s.stateCode), batteryPercent: publicValue(s.batteryPercent), cleanTimeSeconds: publicValue(s.cleanTimeSeconds), cleanAreaMm2: publicValue(s.cleanAreaMm2), inCleaning: publicValue(s.inCleaningCode), inReturning: publicValue(s.inReturningCode), errorCode: publicValue(s.errorCode), dockErrorStatus: publicValue(s.dockErrorCode), chargeStatus: publicValue(s.chargeStatusCode), dustCollectionStatus: publicValue(s.dustCollectionStatusCode), waterBoxStatus: publicValue(s.waterBoxStatusCode), waterShortageStatus: publicValue(s.waterShortageCode), washStatus: publicValue(s.washStatusCode), washPhase: publicValue(s.washPhaseCode), dryStatus: publicValue(s.dryStatusCode), avoidCount: publicValue(s.avoidCount), dss: publicValue(s.dock.rawDss) };
}
export function projectConsumables(c: SourceConsumables, observedAtMs: number): Consumables {
    const used = (key: string): Value<number> => { const f = c.items.find(x => x.sourceKey === key); return f === undefined ? UNKNOWN : publicValue(f.used); };
    return { observedAtMs: { status: 'known', value: observedAtMs }, mainBrushSeconds: used('main_brush_work_time'), sideBrushSeconds: used('side_brush_work_time'), filterSeconds: used('filter_work_time'), filterElementSeconds: used('filter_element_work_time'), sensorSeconds: used('sensor_dirty_time'), strainerCycles: used('strainer_work_times'), dustCollectionCycles: used('dust_collection_work_times'), cleaningBrushCycles: used('cleaning_brush_work_times') };
}
export function projectTotals(s: Summary, observedAtMs: number): Totals {
    return { observedAtMs: { status: 'known', value: observedAtMs }, cleanTimeSeconds: publicValue(s.cleanTimeSeconds), cleanAreaMm2: publicValue(s.cleanAreaMm2), cleanCount: publicValue(s.cleanCount), dustCollectionCount: publicValue(s.dustCollectionCount) };
}
