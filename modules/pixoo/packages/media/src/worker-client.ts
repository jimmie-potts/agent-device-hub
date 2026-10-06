import {validateRecord,type DiagnosticRecord} from '@jimmie-potts/bunny-observability';
import type {Readable} from 'node:stream';
import type {WorkerDiagnostics} from './diagnostics.js';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MediaError, type MediaLimits, type MediaProfile, type Transform } from './contracts.js';
export interface WorkerRequest { diagnostics?:WorkerDiagnostics; input: string; output: string; sourceHash: string; id: string; transform: Transform; profile: MediaProfile; limits: MediaLimits }
export function signalError(signal: AbortSignal): MediaError { return new MediaError(signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError' ? 'timeout' : 'cancelled'); }
export function runWorker(request: WorkerRequest, signal: AbortSignal, entry = new URL('./worker.js', import.meta.url), onDiagnostic?:(record:DiagnosticRecord)=>void): Promise<void> {
  if (signal.aborted) return Promise.reject(signalError(signal));
  return new Promise((resolve,reject) => {
    const child = fork(fileURLToPath(entry), { stdio:['ignore','ignore','ignore','ipc',request.diagnostics?'pipe':'ignore'], execArgv:['--max-old-space-size=256'], env:{PATH:process.env.PATH, SystemRoot:process.env.SystemRoot}, serialization:'advanced' });
    const diagnosticPipe=child.stdio[4] as Readable|null;
    let diagnosticBytes=Buffer.alloc(0),diagnosticDone=false;
    diagnosticPipe?.on('error',()=>{});
    diagnosticPipe?.on('data',(chunk:Buffer)=>{
      if(diagnosticDone)return;
      if(diagnosticBytes.length+chunk.length>8192){diagnosticDone=true;return;}
      diagnosticBytes=Buffer.concat([diagnosticBytes,chunk]);
      const end=diagnosticBytes.indexOf(10);if(end<0)return;diagnosticDone=true;
      try{const record:unknown=JSON.parse(diagnosticBytes.subarray(0,end).toString());if(validateRecord(record).ok)onDiagnostic?.(record as DiagnosticRecord);}catch{/* Diagnostic delivery never changes the result. */}
      diagnosticBytes=Buffer.alloc(0);
    });
    let success = false, failure: MediaError | undefined;
    const abort = () => { failure = signalError(signal); child.kill('SIGKILL'); };
    signal.addEventListener('abort',abort,{once:true});
    child.on('message', message => {
      const m = message as {ok?:boolean;code?:string};
      if (m?.ok === true) success = true;
      else {
        const codes = ['invalid-input','unsupported','upload-limit','pixel-limit','profile-limit','decode-failed'];
        failure = new MediaError(codes.includes(m?.code ?? '') ? m.code as MediaError['code'] : 'decode-failed');
      }
    });
    child.once('error',() => { failure ??= new MediaError('decode-failed'); });
    child.once('close',code => { // Reap the process before releasing the caller's slot or staging.
      signal.removeEventListener('abort',abort);
      if (failure) reject(failure); else if (code === 0 && success) resolve(); else reject(new MediaError('decode-failed'));
    });
    child.send(request,error => { if (error) { failure ??= new MediaError('decode-failed'); child.kill('SIGKILL'); } });
  });
}
