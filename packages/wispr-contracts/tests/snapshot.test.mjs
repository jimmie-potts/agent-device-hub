import test from 'node:test';
import assert from 'node:assert/strict';

test('attempt status rejects content, incompatible identity fields and impossible freshness',async()=>{
 const {validateStatus}=await import('../dist/index.js');
 const value={schemaVersion:'1.0',namespace:'11111111-1111-4111-8111-111111111111',generation:'22222222-2222-4222-8222-222222222222',revision:1,lastAttemptAt:'2026-10-02T12:00:00.000Z',lastSuccessAt:'2026-10-01T12:00:00.000Z',latestSourceDate:'2026-10-01',health:'source-unavailable',languageEnabled:false};
 assert.equal(validateStatus(value).ok,true);
 for(const patch of [{transcript:'PRIVATE_CANARY'},{health:'PRIVATE_CANARY'},{revision:-1},{latestSourceDate:'2026-10-01T12:00:00Z'},{lastSuccessAt:'2026-10-03T12:00:00.000Z'}])assert.equal(validateStatus({...value,...patch}).ok,false);
});
