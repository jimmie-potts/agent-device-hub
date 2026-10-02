import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../dist/arguments.js';
test('commands require explicit flags and reject ambiguous reset, rebind and unknown options',()=>{
 assert.deepEqual(parseArgs(['collect','--config','C:\\private\\config.json']),{configPath:'C:\\private\\config.json',operation:{command:'collect'}});
 assert.deepEqual(parseArgs(['restore','--config','c','--name','backup','--historical-reimport']),{configPath:'c',operation:{command:'restore',name:'backup',historicalReimport:true}});
 for(const args of [[],['collect'],['reset','--config','c'],['rebind','--config','c'],['clear','--config','c','--historical-reimport'],['collect','--config','c','--config','d'],['collect','--config','c','--synthetic'],['export','--config','c','--output','o','--format','text']])assert.throws(()=>parseArgs(args),/invalid-arguments/);
});
