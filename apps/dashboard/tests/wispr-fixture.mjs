import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {executeOperation} from '../../wispr-collector/dist/operations.js';
import {startHub} from '../../hub/dist/server.js';
/** Real synthetic SQLite collector → private aggregate files → real authenticated Hub. */
export async function wisprFixture({configured=true,share=true,empty=false,port}={}){
 const root=await mkdtemp(join(tmpdir(),'wd-')),stateDirectory=join(root,'state'),directory=join(root,'hub');
 await mkdir(stateDirectory,{mode:0o700});await mkdir(directory,{mode:0o700});
 const sourcePath=join(root,'source.sqlite'),db=new DatabaseSync(sourcePath),now=Date.now();
 db.exec('CREATE TABLE History(id TEXT,timestamp TEXT,status TEXT,numWords INTEGER,duration REAL,speechDuration REAL,numWordsCorrected INTEGER,numDictionaryReplacements INTEGER,appName TEXT,asrText TEXT,formattedText TEXT,editedText TEXT,detectedLanguage TEXT,editedTextStatus TEXT,editObservationEnd TEXT)');
 const insert=db.prepare('INSERT INTO History VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
 if(!empty){
 for(const id of ['a','b','c'])insert.run(id,new Date(now).toISOString(),'formatted',60,60,30,1,2,'Slack','hello there','hello world','hello friend','en','complete',new Date(now+1000).toISOString());
 insert.run('d',new Date(now-86400000).toISOString(),'formatted',10,20,10,null,null,'ChatGPT',null,null,null,null,null,null);
 insert.run('e',new Date(now-8*86400000).toISOString(),'formatted',5,null,null,null,null,null,null,null,null,null,null,null);
 }
 db.close();
 const config={schemaVersion:'1.0',namespace:'11111111-1111-4111-8111-111111111111',ownerDirectory:root,stateDirectory,sourcePath,timezone:'America/New_York',collectionEnabled:true,language:{enabled:true}};
 let hub;
 try{
  await executeOperation(config,{command:'collect'},{phase:()=>{}});
  const snapshot=JSON.parse(await readFile(join(stateDirectory,'aggregate.json'),'utf8')),token='w'.repeat(43),wrong='x'.repeat(43);
  const credential=(value,devices)=>({id:value[0],digest:createHash('sha256').update(value).digest('hex'),scopes:['read'],devices});
  hub=await startHub({directory,ownerId:'synthetic-wispr',consumers:[],controllers:[],credentials:[credential(token,['dictation']),credential(wrong,['other'])],...(port?{port}:{}),...(configured?{wispr:{sourceId:'dictation',aggregatePath:join(stateDirectory,'aggregate.json'),diagnosticsPath:join(stateDirectory,'status.json'),exposeToDashboard:true,shareTextAggregates:share}}:{})});
  return {hub,token,wrong,snapshot,root,config,credential,async replaceSource(){const namespace=randomUUID();for(const name of ['aggregate.json','status.json']){const path=join(stateDirectory,name),value=JSON.parse(await readFile(path,'utf8'));value.namespace=namespace;await writeFile(path,JSON.stringify(value));}},async clear(){await executeOperation(config,{command:'clear'},{phase:()=>{}});},async fail(){const path=join(stateDirectory,'status.json'),status=JSON.parse(await readFile(path,'utf8'));status.health='source-unavailable';await writeFile(path,JSON.stringify(status));},async optOut(){config.language.enabled=false;await executeOperation(config,{command:'status'},{phase:()=>{}});},async unsupported(){const path=join(stateDirectory,'status.json'),status=JSON.parse(await readFile(path,'utf8'));status.health='source-schema';await writeFile(path,JSON.stringify(status));},async malformed(){await writeFile(join(stateDirectory,'aggregate.json'),'{malformed');},async close(){await hub.close();await rm(root,{recursive:true,force:true});}};
 }catch(e){await hub?.close();await rm(root,{recursive:true,force:true});throw e;}
}
