import { Ajv2020 } from 'ajv/dist/2020.js';
import { MessageValidator, schemas } from '@jimmie-potts/event-contracts/v2';
import { registerCoreFamilies } from '@jimmie-potts/event-contracts/v2/families';
import { registerDeviceFamilies } from '@jimmie-potts/event-contracts/v2/devices';
import { CONSUMABLE_KEYS, STATUS_FIELD_KEYS, STATUS_SCHEMA, type VacuumStatus } from './contracts.js';
const block = (name: string): object => ({ $ref: `#/$defs/${name}` });
export const closed = (properties: Record<string, object>): {
    type: 'object';
    additionalProperties: false;
    required: string[];
    properties: Record<string, object>;
} => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });
const integer = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const code = { type: 'integer', minimum: -0x80000000, maximum: 0xffffffff };
const percent = { type: 'integer', minimum: 0, maximum: 100 };
const known = (value: object): object => ({ oneOf: [block('unknown'), closed({ status: { const: 'known' }, value })] });
const fields = (keys: readonly string[], overrides: Record<string, object> = {}): Record<string, object> => Object.fromEntries(keys.map(key => [key, known(overrides[key] ?? integer)]));
const definitions = (schemas.blocks as {
    $defs: Record<string, object>;
}).$defs;
const document = (properties: Record<string, object>) => ({ ...closed(properties), $defs: definitions });
const mapSchema = closed({ availability: { enum: ['missing', 'unverified'] }, reason: { enum: ['not-observed', 'capture-failed', 'candidate-window', 'ambiguous-window'] } });
export const statusSchema = document({ schema: { const: 'roborock-vacuum/2.0' }, id: block('routingId'), revision: block('revision'), observedAtMs: known(block('instantMs')), availability: { enum: ['unknown', 'available', 'unavailable'] }, activity: { enum: ['unknown', 'cleaning', 'returning', 'other'] },
    status: closed(fields(STATUS_FIELD_KEYS, { batteryPercent: percent, state: code, inCleaning: code, inReturning: code, errorCode: code, dockErrorStatus: code, chargeStatus: code, dustCollectionStatus: code, waterBoxStatus: code, waterShortageStatus: code, washStatus: code, washPhase: code, dryStatus: code, dss: { type: 'integer', minimum: 0, maximum: 0xffffffff } })),
    consumables: closed({ observedAtMs: known(block('instantMs')), ...fields(CONSUMABLE_KEYS) }), totals: closed({ observedAtMs: known(block('instantMs')), ...fields(['cleanTimeSeconds', 'cleanAreaMm2', 'cleanCount', 'dustCollectionCount']) }),
    collection: closed({ retainedRuns: integer, observedSamples: integer, gaps: integer, history: { const: 'partial' }, maps: { const: 'unverified' }, clock: { const: 'unqualified' }, lastFailure: known({ $ref: '#/$defs/errorBody/properties/error/properties/code' }) }) });
const runSchema = closed({ recordId: { type: 'integer', minimum: 1, maximum: 0xffffffff }, observedAtMs: block('instantMs'), startAtMs: block('instantMs'), endAtMs: known(block('instantMs')), ...fields(['durationSeconds', 'areaMm2', 'cleanedAreaMm2', 'errorCode', 'complete', 'startType', 'cleanType', 'finishReason', 'avoidCount', 'washCount'], Object.fromEntries(['errorCode', 'complete', 'startType', 'cleanType', 'finishReason'].map(k => [k, code]))), battery: closed({ availability: { enum: ['missing', 'partial'] }, samples: integer, clock: { const: 'unqualified' } }), map: mapSchema });
const cursor = known({ type: 'string', minLength: 1, maxLength: 128 });
export const runsSchema = document({ schema: { const: 'roborock-runs/2.0' }, id: block('routingId'), revision: block('revision'), history: { const: 'partial' }, runs: { type: 'array', maxItems: 25, items: runSchema }, next: cursor });
export const runDocumentSchema = document({ schema: { const: 'roborock-run/2.0' }, id: block('routingId'), revision: block('revision'), run: runSchema });
export const samplesSchema = document({ schema: { const: 'roborock-samples/2.0' }, id: block('routingId'), revision: block('revision'), recordId: { type: 'integer', minimum: 1, maximum: 0xffffffff }, clock: { const: 'unqualified' }, samples: { type: 'array', maxItems: 100, items: closed({ observationId: block('id'), observedAtMs: block('instantMs'), batteryPercent: percent }) }, gaps: { type: 'array', maxItems: 100, items: closed({ startAtMs: block('instantMs'), endAtMs: known(block('instantMs')), reason: { enum: ['restart', 'unavailable', 'missed-poll', 'storage'] } }) }, next: cursor });
const vacuumSchema = { $schema: 'https://json-schema.org/draft/2020-12/schema', $id: STATUS_SCHEMA, ...statusSchema };
export const roborockSchemas = { [STATUS_SCHEMA]: vacuumSchema };
export function registerRoborockFamilies(validator: MessageValidator): void {
    validator.register(STATUS_SCHEMA, vacuumSchema, message => {
        const d = message.data as unknown as VacuumStatus, at = Date.parse(message.time);
        if (message.kind !== 'state' || message.type !== 'org.bunny.roborock-vacuum.updated' || message.subject !== d.id)
            return 'Roborock identity/kind mismatch';
        for (const value of [d.observedAtMs, d.consumables.observedAtMs, d.totals.observedAtMs])
            if (value.status === 'known' && value.value > at)
                return 'Roborock evidence after envelope';
        return undefined;
    });
}
let validator: MessageValidator | undefined;
export function roborockValidator(): MessageValidator {
    if (validator === undefined) {
        validator = new MessageValidator();
        registerCoreFamilies(validator);
        registerDeviceFamilies(validator);
        registerRoborockFamilies(validator);
    }
    return validator;
}
const ajv = new Ajv2020({ strict: true });
export const validateStatus = ajv.compile(statusSchema), validateRuns = ajv.compile(runsSchema), validateRun = ajv.compile(runDocumentSchema), validateSamples = ajv.compile(samplesSchema);
