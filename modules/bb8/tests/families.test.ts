import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {Message} from '@jimmie-potts/event-contracts/v2';
import {bb8Validator} from '../src/families.js';
import {commandType, schemaOf} from '../src/contracts.js';
const data = {requestId: 'request-1', expectedConfigurationRevision: 0, expectedHelperEpoch: 'helper-1', expectedConnectionGeneration: 0, led: {target: 'main', rgb: [1, 2, 3]}};
const message = (payload: object): Message => ({specversion: '1.0', bunnyprofile: '2.0', id: 'message-1', source: 'bunny/parts/test', kind: 'command', datacontenttype: 'application/json', type: commandType('bb8-led-set'), subject: 'bb8', dataschema: schemaOf('bb8-led-set'), data: payload as Record<string, unknown>, traceparent: '00-11111111111111111111111111111111-1111111111111111-01', time: new Date(1_000_000).toISOString(), expiresat: new Date(1_005_000).toISOString()});
void test('strict LED values and guards; no arbitrary target, UUID, persistence or packet fields', () => {
  const v = bb8Validator(); assert.equal(v.validate(message(data)).ok, true);
  for (const payload of [{...data, bytes: [1]}, {...data, led: {...data.led, rgb: [256, 0, 0]}}, {...data, led: {...data.led, rgb: [1, 2, 3, 0]}}, {...data, led: {target: 'motor', brightness: 1}}, {...data, expectedHelperEpoch: undefined}]) assert.equal(v.validate(message(payload)).ok, false);
});
void test('internal operation ID must equal SDK request ID', () => {
  const m = message({...data, operationId: 'operation-1', parentRequestId: 'parent-1', operationExpiresAtMs: 1_005_000, operation: {kind: 'wake'}});
  const {led: _led, ...d} = m.data as typeof data & Record<string, unknown>;
  assert.equal(bb8Validator().validate({...m, type: commandType('bb8-link-execute'), dataschema: schemaOf('bb8-link-execute'), data: d}).ok, false);
});
