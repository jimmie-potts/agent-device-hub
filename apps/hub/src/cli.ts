import {open,realpath,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startHub,type HubOptions} from './server.js';
import {requestBrowserLaunch} from './browser-launch.js';
import {object,exact} from './common.js';

async function readConfiguration(path:string):Promise<HubOptions> {
  if (process.platform !== 'linux' || resolve(path) !== path || await realpath(path) !== path) throw new Error('invalid-configuration');
  const stat = await lstat(path);
  if (!stat.isFile() || stat.uid !== process.getuid!() || (stat.mode & 0o077) !== 0 || stat.size > 65536) throw new Error('invalid-configuration');
  const file = await open(path,constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes:Buffer;
  try {
    const buffer = Buffer.alloc(65537);let size = 0;
    for (;;) {const part = await file.read(buffer,size,buffer.length-size,null);size += part.bytesRead;if (!part.bytesRead || size === buffer.length) break;}
    if (size > 65536) throw new Error('invalid-configuration');bytes = buffer.subarray(0,size);
  } finally {await file.close();}
  const value:unknown = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if (!object(value) || !exact(value,['directory','ownerId','consumers','credentials','controllers','port',...(Object.hasOwn(value,'editorLinks')?['editorLinks']:[]),...(Object.hasOwn(value,'mcp')?['mcp']:[]),...(Object.hasOwn(value,'codexDesktop')?['codexDesktop']:[])]) || typeof value.directory !== 'string' || typeof value.ownerId !== 'string') throw new Error('invalid-configuration');
  return value as unknown as HubOptions;
}

try {
  if (process.argv.length !== 4 || !['serve','serve-staged','open'].includes(process.argv[2])) throw new Error('usage');
  const configuration=await readConfiguration(process.argv[3]);
  if(process.argv[2]==='open'){
    const launch=await requestBrowserLaunch(configuration.directory);
    const url=launch.url+'/#launch='+launch.code;
    const command=process.env.WSL_DISTRO_NAME?'cmd.exe':'xdg-open';
    const args=process.env.WSL_DISTRO_NAME?['/c','start','',url]:[url];
    await promisify(execFile)(command,args,{timeout:5000,windowsHide:true});
    process.stdout.write('BUNNY opened in the browser.\n');
  } else {
  const hub = await startHub(configuration,process.argv[2] === 'serve-staged' ? {staged:true} : undefined);
  process.stdout.write(JSON.stringify({ready:true,url:hub.url}) + '\n');
  let stopping = false;
  const stop = () => {
    if (stopping) return;stopping = true;
    const deadline = setTimeout(() => process.exit(1),5000);deadline.unref();
    void hub.close().then(() => {clearTimeout(deadline);process.exitCode = 0;},() => {clearTimeout(deadline);process.stderr.write('hub-shutdown-failed\n');process.exitCode = 1;});
  };
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  }
} catch {
  process.stderr.write(process.argv[2]==='open'?'bunny-open-failed\n':'hub-start-failed\n');process.exitCode = 1;
}
