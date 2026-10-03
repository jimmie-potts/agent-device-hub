import test from 'node:test';
import assert from 'node:assert/strict';
import {parseInstallArguments} from '../dist/install/cli.js';
test('mutation requires a saved plan and exact approval, while plan/status have no implicit effects',()=>{
 assert.deepEqual(parseInstallArguments(['plan','main','--owner','operator','--token-file','/private/read-token']),{command:'plan',target:'main',owner:'operator',tokenFile:'/private/read-token',rollback:false});
 assert.deepEqual(parseInstallArguments(['status']),{command:'status',rollback:false});
 assert.throws(()=>parseInstallArguments(['upgrade','main']),/install-approval-required/);
 assert.throws(()=>parseInstallArguments(['upgrade','a'.repeat(40),'--force']),/invalid-install-arguments/);
 assert.throws(()=>parseInstallArguments(['upgrade','a'.repeat(40),'--plan','/private/plan.json','--approve','yes']),/install-approval-required/);
 assert.throws(()=>parseInstallArguments(['plan','main','--owner','operator','--token-file','relative']),/invalid-install-arguments/);
 const rollback=parseInstallArguments(['rollback','--plan','/private/plan.json','--approve','a'.repeat(64)]);assert.equal(rollback.command,'rollback');assert.equal(rollback.target,undefined);
});
