import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {chromium} from 'playwright';
import {record} from './sample.mjs';

test('browser core runs with strict CSP and opens no exporter',async()=>{
 const entry=process.env.OBSERVABILITY_BROWSER_ENTRY??fileURLToPath(new URL('../dist/index.js',import.meta.url));
 const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`import {createRecord,toOtlp} from ${JSON.stringify(entry)}; globalThis.contractResult=toOtlp(createRecord(${JSON.stringify(record)}).value);`},bundle:true,platform:'browser',format:'iife',write:false});
 const paths=[];
 const server=createServer((req,res)=>{
  paths.push(req.url);
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; connect-src 'none'");
  if(req.url==='/contract.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);}
  else if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><script src="/contract.js"></script>');}
  else{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result=await page.evaluate(()=>globalThis.contractResult);
  assert.deepEqual(errors,[]);
  assert.equal(result.resourceLogs[0].scopeLogs[0].logRecords[0].eventName,'process.started');
  assert.deepEqual(paths.filter(path=>path!=='/favicon.ico'),['/','/contract.js']);
 } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
