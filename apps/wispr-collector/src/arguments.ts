import type { Operation } from './operations.js';
export function parseArgs(args:string[]):{configPath:string;operation:Operation} {
  const [command,...rest]=args,values=new Map<string,string|true>();
  const fail=():never=>{throw new Error('invalid-arguments');};
  for(let i=0;i<rest.length;i++){
    const key=rest[i];if(!key.startsWith('--')||values.has(key))fail();
    if(['--historical-reimport','--confirm-same-source'].includes(key))values.set(key,true);
    else {const value=rest[++i];if(!value||value.startsWith('--'))fail();values.set(key,value);}
  }
  const configPath=values.get('--config');if(typeof configPath!=='string')fail();values.delete('--config');
  const name=values.get('--name');
  let operation:Operation;
  switch(command){
    case 'collect':case 'status':case 'clear':case 'clear-text':case 'zone':operation={command};break;
    case 'reset':if(values.get('--historical-reimport')!==true)fail();values.delete('--historical-reimport');operation={command,historicalReimport:true};break;
    case 'rebind':if(values.get('--confirm-same-source')!==true)fail();values.delete('--confirm-same-source');operation={command,confirmSameSource:true};break;
    case 'backup':case 'restore':
      if(typeof name!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name))fail();values.delete('--name');
      if(command==='restore'){const historicalReimport=values.get('--historical-reimport')===true;values.delete('--historical-reimport');operation={command,name:name as string,historicalReimport};}
      else operation={command,name:name as string};break;
    case 'export':{
      const format=values.get('--format'),output=values.get('--output');if((format!=='json'&&format!=='csv')||typeof output!=='string')fail();
      values.delete('--format');values.delete('--output');operation={command,format:format as 'json'|'csv',output:output as string};break;
    }
    default:return fail();
  }
  if(values.size)fail();return {configPath:configPath as string,operation};
}
