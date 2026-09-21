import {resolve,join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import assert from 'node:assert/strict';
import {ControllerClient} from '../apps/hub/dist/controllers.js';
const source=resolve(process.argv[2]??'');assert.equal(source,process.argv[2],'absolute prepared source required');
const pin=JSON.parse(await readFile(new URL('../apps/hub/fixtures/nanoleaf-source.json',import.meta.url),'utf8'));
for(const [path,hash] of Object.entries(pin.sourceFiles))assert.equal(createHash('sha256').update(await readFile(join(source,path))).digest('hex'),hash,path);
const child=spawn('python3',[new URL('./hub-native-nanoleaf.py',import.meta.url).pathname,source],{stdio:['pipe','pipe','inherit']});
const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();let client;
try{
 const ready=await lines.next();assert.equal(ready.done,false);const native=JSON.parse(ready.value);
 client=new ControllerClient({id:'wall',kind:'nanoleaf',controllerId:'controller',deviceId:'device',...native});
 const snapshot=await client.integrationSnapshot();assert.equal(snapshot.apiVersion,'nanoleaf.integration/1.0');
 const request={apiVersion:snapshot.apiVersion,controllerId:'controller',deviceId:'device',requestId:snapshot.nextRequestId,expectedRevision:snapshot.revision,command:{kind:'settings.set',style:'project'}};
 const queued=await client.integrationCommand(request);assert.equal(queued.status,202);assert.equal(queued.body.outcome,'queued');
 child.stdin.write('process\n');assert.equal((await lines.next()).value,'processed');
 const applied=await client.integrationReceipt(request.requestId);assert.equal(applied.body.outcome,'applied');assert.equal(applied.body.physicalOutcome,'unknown');
 const updated=await client.integrationSnapshot();assert.equal(updated.settings.style,'project');
 assert.equal((await client.integrationCommand(request)).body.outcome,'applied');
 console.log(JSON.stringify({contract:snapshot.apiVersion,source:'f12ac6653a9f3267fa9ef62a2d6667072183d8b3',http:true,queued:true,applied:true,replay:true,physical:false}));
}finally{client?.close();child.stdin.end('stop\n');await new Promise(r=>child.once('exit',r));}
