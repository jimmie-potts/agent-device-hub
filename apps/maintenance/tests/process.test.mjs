import assert from 'node:assert/strict';
import test from 'node:test';
import { runProcess } from '../dist/process.js';
test('bounded child output and original deadline prevent unbounded work',async()=>{
 const ok=await runProcess(process.execPath,['-e','process.stdout.write("ready")'],{deadline:Date.now()+2000,maxBytes:100});
 assert.equal(ok.stdout,'ready');
 await assert.rejects(runProcess(process.execPath,['-e','process.stdout.write("x".repeat(10000))'],{deadline:Date.now()+2000,maxBytes:100}),/process-output-limit/);
 await assert.rejects(runProcess(process.execPath,['-e','setInterval(()=>{},100)'],{deadline:Date.now()+50,maxBytes:100}),/process-deadline/);
 await assert.rejects(runProcess(process.execPath,['-e','process.exit(0)'],{deadline:Date.now()-1,maxBytes:100}),/process-deadline/);
});
