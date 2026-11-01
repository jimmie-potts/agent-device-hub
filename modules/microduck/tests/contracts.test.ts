import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Ajv2020} from 'ajv/dist/2020.js';
import {microduckSchemas} from '../src/families.js';
import {schemaOf} from '../src/contracts.js';
const ajv=new Ajv2020({strict:false});
void test('gesture and control shapes require guards and forbid raw payloads',()=>{
  const gesture=ajv.compile(microduckSchemas[schemaOf('microduck-gesture')]??{}),control=ajv.compile(microduckSchemas[schemaOf('microduck-control')]??{});
  const base={requestId:'one',expectedConfigurationRevision:1,expectedGeneration:{epoch:'fixture',sequence:1}};
  assert.equal(gesture({...base,gesture:'notice'}),true);assert.equal(control({...base,action:'takeover'}),true);
  for(const bad of [{gesture:'notice'}, {...base,gesture:'walk'},{...base,gesture:'neutral',yaw:.1},{...base,gesture:'notice',durationMs:1600}])assert.equal(gesture(bad),false);
  assert.equal(control({...base,action:'enable'}),false);
});
void test('local Stop needs only its request identity',()=>{
  const stop=ajv.compile(microduckSchemas[schemaOf('microduck-stop')]??{});
  assert.equal(stop({requestId:'stop'}),true);assert.equal(stop({requestId:'stop',expectedGeneration:{epoch:'old',sequence:1}}),false);assert.equal(stop({requestId:'stop',method:'robot.stop'}),false);
});
