import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Message } from '@jimmie-potts/event-contracts/v2';
import { emptyStatus, STATUS_SCHEMA, UNKNOWN, type RunRecord, type RunsPage, type SamplesPage, type VacuumStatus, } from '../src/contracts.js';
import { Refused, messageStatus, runDocument, runsDocument, samplesDocument, statusDocument, } from '../src/frontend/documents.js';
const PRIVATE = 'SYNTHETIC_PRIVATE_BOUNDARY';
type Key = string | number;
type Decoder = (value: unknown) => unknown;
function run(id = 100): RunRecord {
    return {
        recordId: id, observedAtMs: id * 1000 + 10000,
        startAtMs: id * 1000, endAtMs: { status: 'known', value: id * 1000 + 7000 },
        durationSeconds: { status: 'known', value: 4 },
        areaMm2: { status: 'known', value: 12000000 }, cleanedAreaMm2: UNKNOWN,
        errorCode: UNKNOWN, complete: UNKNOWN, startType: UNKNOWN,
        cleanType: UNKNOWN, finishReason: UNKNOWN, avoidCount: UNKNOWN, washCount: UNKNOWN,
        battery: { availability: 'partial', samples: 2, clock: 'unqualified' },
        map: { availability: 'unverified', reason: 'candidate-window' },
    };
}
const status: VacuumStatus = {
    ...emptyStatus('vacuum'), revision: 1,
    observedAtMs: { status: 'known', value: 1000 },
    availability: 'available', activity: 'other',
};
status.status.batteryPercent = { status: 'known', value: 50 };
const runs: RunsPage = {
    schema: 'roborock-runs/2.0', id: 'vacuum', revision: 1,
    history: 'partial', runs: [run()], next: UNKNOWN,
};
const detail = { schema: 'roborock-run/2.0', id: 'vacuum', revision: 1, run: run() };
const samples: SamplesPage = {
    schema: 'roborock-samples/2.0', id: 'vacuum', revision: 1, recordId: 100,
    clock: 'unqualified',
    samples: [{ observationId: 'sample-1', observedAtMs: 101000, batteryPercent: 50 }],
    gaps: [{ startAtMs: 102000, endAtMs: UNKNOWN, reason: 'unavailable' }],
    next: UNKNOWN,
};
const cases: readonly {
    name: string;
    value: unknown;
    decode: Decoder;
}[] = [
    { name: 'status', value: status, decode: value => statusDocument(value, 'vacuum') },
    { name: 'runs', value: runs, decode: value => runsDocument(value, 'vacuum') },
    { name: 'run', value: detail, decode: value => runDocument(value, 'vacuum', 100) },
    { name: 'samples', value: samples, decode: value => samplesDocument(value, 'vacuum', 100) },
];
function container(value: unknown): Record<string | number, unknown> {
    assert.ok(typeof value === 'object' && value !== null);
    return value as Record<string | number, unknown>;
}
function at(value: unknown, path: readonly Key[]): unknown {
    let current = value;
    for (const key of path)
        current = container(current)[key];
    return current;
}
function change(value: unknown, path: readonly Key[], replacement: unknown): unknown {
    const copy: unknown = structuredClone(value);
    const key = path.at(-1);
    assert.ok(key !== undefined);
    container(at(copy, path.slice(0, -1)))[key] = replacement;
    return copy;
}
function objectPaths(value: unknown, path: readonly Key[] = []): readonly Key[][] {
    if (Array.isArray(value)) {
        return value.flatMap((item, index) => objectPaths(item, [...path, index]));
    }
    if (typeof value !== 'object' || value === null)
        return [];
    return [
        [...path],
        ...Object.entries(value).flatMap(([key, item]) => objectPaths(item, [...path, key])),
    ];
}
function refused(decode: Decoder, value: unknown): void {
    assert.throws(() => decode(value), error => {
        assert.ok(error instanceof Refused);
        assert.equal(error.code, 'invalid-message');
        assert.equal(error.message.includes(PRIVATE), false);
        return true;
    });
}
void test('browser documents preserve unknown values and independent measurements', () => {
    for (const item of cases)
        assert.deepEqual(item.decode(item.value), item.value, item.name);
    const result = runDocument(detail, 'vacuum', 100);
    assert.deepEqual(result.run.cleanedAreaMm2, UNKNOWN);
    assert.equal(result.run.durationSeconds.status, 'known');
    assert.equal(statusDocument(status, 'vacuum').consumables.mainBrushSeconds.status, 'unknown');
});
void test('every object boundary rejects extra private fields and missing required fields', () => {
    for (const item of cases) {
        for (const path of objectPaths(item.value)) {
            const extra: unknown = structuredClone(item.value);
            container(at(extra, path)).owner_note = PRIVATE;
            refused(item.decode, extra);
            const original = container(at(item.value, path));
            for (const key of Object.keys(original)) {
                const missing: unknown = structuredClone(item.value);
                delete container(at(missing, path))[key];
                refused(item.decode, missing);
            }
        }
    }
});
void test('schema, owner identity and revision are checked for every document', () => {
    for (const item of cases) {
        for (const schema of ['roborock-vacuum/1.0', '', null]) {
            refused(item.decode, change(item.value, ['schema'], schema));
        }
        for (const id of ['another-vacuum', 'PRIVATE OWNER', '', null]) {
            refused(item.decode, change(item.value, ['id'], id));
        }
        for (const revision of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', null]) {
            refused(item.decode, change(item.value, ['revision'], revision));
        }
    }
    refused(value => runDocument(value, 'vacuum', 101), detail);
    refused(value => samplesDocument(value, 'vacuum', 101), samples);
});
void test('measured values, raw codes, wrappers and declared enumerations stay bounded', () => {
    const decode: Decoder = value => statusDocument(value, 'vacuum');
    for (const value of [-1, 101, 0.5, NaN, Infinity, '50', null]) {
        refused(decode, change(status, ['status', 'batteryPercent'], { status: 'known', value }));
    }
    for (const value of [0, 100]) {
        assert.doesNotThrow(() => decode(change(status, ['status', 'batteryPercent'], { status: 'known', value })));
    }
    for (const value of [-0x80000001, 0x100000000, '5', null]) {
        refused(decode, change(status, ['status', 'state'], { status: 'known', value }));
    }
    for (const value of [-0x80000000, 0xffffffff]) {
        assert.doesNotThrow(() => decode(change(status, ['status', 'state'], { status: 'known', value })));
    }
    for (const path of [
        ['observedAtMs'], ['consumables', 'mainBrushSeconds'], ['totals', 'cleanAreaMm2'],
    ]) {
        refused(decode, change(status, path, { status: 'known', value: -1 }));
        refused(decode, change(status, path, { status: 'unknown', value: 0 }));
        refused(decode, change(status, path, null));
    }
    refused(decode, change(status, ['status', 'dss'], { status: 'known', value: -1 }));
    refused(decode, change(status, ['availability'], 'online'));
    refused(decode, change(status, ['activity'], 'completed'));
    refused(decode, change(status, ['collection', 'lastFailure'], { status: 'known', value: PRIVATE }));
    refused(cases[2]?.decode ?? decode, change(detail, ['run', 'map', 'availability'], 'verified'));
    refused(cases[3]?.decode ?? decode, change(samples, ['gaps', 0, 'reason'], 'unknown-vendor-reason'));
});
void test('pages reject oversized lists, duplicates, bad cursors and malformed array members', () => {
    const decodeRuns: Decoder = value => runsDocument(value, 'vacuum');
    const decodeSamples: Decoder = value => samplesDocument(value, 'vacuum', 100);
    refused(decodeRuns, { ...runs, runs: Array.from({ length: 26 }, (_, index) => run(index + 1)) });
    refused(decodeRuns, { ...runs, runs: [run(), run()] });
    refused(decodeRuns, { ...runs, runs: [null] });
    for (const next of [{ status: 'known', value: '' }, { status: 'known', value: 'x'.repeat(129) }]) {
        refused(decodeRuns, { ...runs, next });
        refused(decodeSamples, { ...samples, next });
    }
    refused(decodeSamples, { ...samples, samples: Array.from({ length: 101 }, (_, index) => ({
            observationId: `sample-${index}`, observedAtMs: index, batteryPercent: 50,
        })) });
    refused(decodeSamples, { ...samples, gaps: Array.from({ length: 101 }, () => ({
            startAtMs: 0, endAtMs: UNKNOWN, reason: 'restart',
        })) });
    const first = samples.samples[0];
    assert.ok(first !== undefined);
    refused(decodeSamples, { ...samples, samples: [first, first] });
    refused(decodeSamples, change(samples, ['samples', 0, 'batteryPercent'], 101));
    refused(decodeSamples, change(samples, ['samples', 0, 'observedAtMs'], -1));
    refused(decodeSamples, change(samples, ['samples', 0, 'observationId'], PRIVATE.repeat(10)));
});
void test('owner-addressed status checks envelope identity and evidence time', () => {
    const message: Message<VacuumStatus> = {
        specversion: '1.0', bunnyprofile: '2.0', id: 'synthetic-message',
        source: 'bunny/modules/roborock', type: 'org.bunny.roborock-vacuum.updated',
        subject: 'vacuum', time: new Date(2000).toISOString(), kind: 'state',
        datacontenttype: 'application/json', dataschema: STATUS_SCHEMA,
        traceparent: '00-11111111111111111111111111111111-1111111111111111-01',
        data: status,
    };
    assert.deepEqual(messageStatus(message, 'vacuum'), status);
    for (const [key, value] of [
        ['source', 'bunny/modules/another'], ['subject', 'another-vacuum'],
        ['type', 'org.bunny.device.updated'], ['kind', 'occurrence'],
        ['dataschema', 'https://synthetic.invalid/private'], ['time', 'invalid'],
    ] as const) {
        refused(value => messageStatus(value as Message<VacuumStatus>, 'vacuum'), { ...message, [key]: value });
    }
    refused(value => messageStatus(value as Message<VacuumStatus>, 'vacuum'), {
        ...message, data: { ...status, observedAtMs: { status: 'known', value: 2001 } },
    });
});
