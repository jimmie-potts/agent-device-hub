import {createHubDiagnostics} from './host-diagnostics.js';
import {open,realpath,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {startHub,type HubOptions,type PreviewProof} from './server.js';
import {requestBrowserLaunch} from './browser-launch.js';
import {object,exact} from './common.js';
import {startupFailureCode} from './startup-failure.js';

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
  if (!object(value) || !exact(value,['directory','ownerId','consumers','credentials','controllers','port',...(Object.hasOwn(value,'editorLinks')?['editorLinks']:[]),...(Object.hasOwn(value,'placeLinks')?['placeLinks']:[]),...(Object.hasOwn(value,'mcp')?['mcp']:[]),...(Object.hasOwn(value,'codexDesktop')?['codexDesktop']:[]),...(Object.hasOwn(value,'playback')?['playback']:[]),...(Object.hasOwn(value,'wispr')?['wispr']:[]),...(Object.hasOwn(value,'browserAccess')?['browserAccess']:[]),...(Object.hasOwn(value,'observability')?['observability']:[])]) || typeof value.directory !== 'string' || typeof value.ownerId !== 'string') throw new Error('invalid-configuration');
  return value as unknown as HubOptions;
}

/** Shared process lifecycle; only the verification entrypoint supplies a proof mount. */
export async function runHubCli(args:string[], previewProof?:PreviewProof):Promise<void> {
let diagnostics:Awaited<ReturnType<typeof createHubDiagnostics>>;
try {
  if (args.length !== 2 || !['serve','serve-staged','open'].includes(args[0])) throw new Error('usage');
  if(args[0]==='open'){
    const configuration=await readConfiguration(args[1]);
    const launch=await requestBrowserLaunch(configuration.directory);
    const url=launch.url+'/#launch='+launch.code;
    const command=process.env.WSL_DISTRO_NAME?'cmd.exe':'xdg-open';
    const launchArgs=process.env.WSL_DISTRO_NAME?['/c','start','',url]:[url];
    await promisify(execFile)(command,launchArgs,{timeout:5000,windowsHide:true});
    process.stdout.write('B.U.N.N.Y. opened in the browser.\n');
  } else {
  // Remember signals during configuration/startup, then use the existing close path.
  let hub:Awaited<ReturnType<typeof startHub>> | undefined;
  let requested = false;
  let stopping = false;
  const stop = () => {
    requested = true;
    if (!hub || stopping) return;stopping = true;
    const deadline = setTimeout(() => process.exit(1),5000);deadline.unref();
    void hub.close().then(async () => {diagnostics?.runtime.event('process.stopped','bunny.host',{'bunny.operation':'shutdown'});await diagnostics?.runtime.shutdown();clearTimeout(deadline);process.exitCode = 0;},async () => {diagnostics?.runtime.event('process.failed','bunny.host',{'bunny.operation':'shutdown'},'ERROR');await diagnostics?.runtime.shutdown();clearTimeout(deadline);process.stderr.write('hub-shutdown-failed\n');process.exitCode = 1;});
  };
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
  const configuration=await readConfiguration(args[1]);
  diagnostics=await createHubDiagnostics(configuration.observability);
  hub = await startHub({...configuration,...(diagnostics?{diagnostics:diagnostics.commands,hostDiagnostics:diagnostics.runtime}:{})},args[0] === 'serve-staged' ? {staged:true} : undefined,previewProof);
  diagnostics?.runtime.event('process.started','bunny.host',{'bunny.operation':'startup'});
  process.stdout.write(JSON.stringify({ready:true,url:hub.url}) + '\n');
  if (requested) stop();
  }
} catch (error) {
  diagnostics?.runtime.event('process.failed','bunny.host',{'bunny.operation':'startup'},'ERROR');
  await diagnostics?.runtime.shutdown();
  // Name a stable cause, never a path or private value, so an operator can tell what to fix.
  const code=startupFailureCode(error);
  process.stderr.write((args[0]==='open'?'bunny-open-failed':'hub-start-failed')+(code?': '+code:'')+'\n');process.exitCode = 1;
}
}
