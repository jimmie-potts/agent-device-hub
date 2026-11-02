import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MessageValidator} from '../dist/v2/index.js';
import {registerCoreFamilies} from '../dist/v2/families.js';
const fixtures=JSON.parse(readFileSync(new URL('../fixtures/v2/families.json',import.meta.url),'utf8'));
const validator=new MessageValidator();registerCoreFamilies(validator);
test('MicroDuck dispatch is closed, subject-bound and preserves an absolute candidate deadline',()=>{
 const m=fixtures.valid['microduck-dispatch'];assert.equal(validator.validate(m).ok,true);
 for(const changed of [{subject:'hub'},{data:{...m.data,pose:[1,2]}},{data:{...m.data,gesture:'wake'}},{data:{...m.data,validUntilMs:undefined}},{data:{...m.data,expectedGeneration:undefined}}])assert.equal(validator.validate({...m,...changed}).ok,false);
});
