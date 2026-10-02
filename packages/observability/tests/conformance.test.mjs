import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRecord, toOtlp} from '../dist/index.js';

const record = {schema_version:'1.1', timestamp:'2026-10-01T12:00:00.123Z',
 severity_number:9,severity_text:'INFO',event_name:'process.started',body:'Process started',
 resource:{'service.namespace':'bunny','service.name':'hub','service.version':'unknown',
 'service.instance.id':'00000000-0000-4000-8000-000000000001','deployment.environment.name':'test'},
 scope:{name:'bunny.host',version:'1.0.0'},attributes:{'bunny.provenance':'source'}};

test('canonical record keeps exact milliseconds through OTLP JSON',()=>{
 assert.equal(validateRecord(record).ok,true);
 assert.equal(toOtlp(record).resourceLogs[0].scopeLogs[0].logRecords[0].timeUnixNano,'1790856000123000000');
});

import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRecord, projectRecord, parseRecord, encodeRecord} from '../dist/index.js';
const cases=JSON.parse(readFileSync(new URL('../fixtures/records.json',import.meta.url))).cases;

test('all shared cases have the expected validity',()=>{
 for(const item of cases)assert.equal(validateRecord(item.record).ok,item.valid,item.name);
});

test('Python and TypeScript normalize and export equivalent fields',()=>{
 const script=`import json,sys\nsys.path.insert(0,sys.argv[1])\nfrom bunny_observability import validate_record,to_otlp\ndata=json.load(sys.stdin)\nprint(json.dumps([{'normalized':validate_record(c['record']),'otlp':to_otlp(c['record'])} for c in data]))`;
 const python=spawnSync(process.env.PYTHON??'python3',['-c',script,fileURLToPath(new URL('../python',import.meta.url))],{input:JSON.stringify(cases),encoding:'utf8'});
 assert.equal(python.status,0,python.stderr);
 const expected=cases.map(c=>({normalized:validateRecord(c.record),otlp:toOtlp(c.record)??null}));
 assert.deepEqual(JSON.parse(python.stdout),expected);
});

test('projection never invokes private getters, serialization or raw errors',()=>{
 let touched=0;
 const raw={...record,attributes:{...record.attributes},error:new Error('SECRET'),toJSON(){touched++;throw Error('SECRET');}};
 Object.defineProperty(raw,'payload',{enumerable:true,get(){touched++;throw Error('SECRET');}});
 Object.defineProperty(raw.attributes,'prompt',{enumerable:true,get(){touched++;throw Error('SECRET');}});
 const projected=createRecord(raw);
 assert.equal(projected.ok,true);assert.equal(touched,0);
 assert.equal(encodeRecord(projected.value).includes('SECRET'),false);
 assert.equal(validateRecord(raw).ok,false);
 assert.equal(touched,0);
 assert.equal(parseRecord('{bad').ok,false);
 assert.equal(projectRecord({...record,attributes:{...record.attributes,'bunny.queue.depth':2}},'1.0').value.attributes['bunny.queue.depth'],undefined);
});
