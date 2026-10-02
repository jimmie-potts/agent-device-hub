import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readPreparedBackend } from './backend-files.mjs';
import { readHostRoots } from './host-roots.mjs';
import { applicationSnapshot } from './application-measurement.mjs';

/** One fresh owned application group, separate from workload/query drivers.
 * No retries; caller retains returned evidence and cleans only registered state. */
export async function startWorkloadProcess(directory, { enabled, signal, onStart = () => {} } = {}) {
  if (typeof enabled !== 'boolean' || signal?.aborted || typeof onStart !== 'function') throw new Error('Application invocation invalid');
  await readPreparedBackend(directory); await readHostRoots(directory);
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [new URL('./workload-entry.mjs', import.meta.url).pathname],
    { env, detached: true, stdio: ['ignore','pipe','pipe','ipc'] });
  let readyValue, result, reason = null, outputBytes = 0, stderrBytes = 0, messages = 0, messageBytes = 0, killTimer, stopping = false;
  const executions = [], stderrHash = createHash('sha256');
  let acceptReady, rejectReady;
  const ready = new Promise((resolve,reject) => { acceptReady = resolve; rejectReady = reject; });
  ready.catch(() => {});
  const terminate = why => {
    if (reason) return; reason = why;
    if (child.pid) {
      try { process.kill(-child.pid,'SIGTERM'); } catch {}
      killTimer = setTimeout(() => { try { process.kill(-child.pid,'SIGKILL'); } catch {} },2000);
    }
  };
  const abort = () => terminate('aborted'); signal?.addEventListener('abort',abort,{once:true});
  const startup = setTimeout(() => terminate('startup-deadline'),20000), lifetime = setTimeout(() => terminate('lifetime-deadline'),150000);
  let stopTimer;
  child.stdout.on('data', chunk => { outputBytes += chunk.length; terminate('unexpected-stdout'); });
  child.stderr.on('data', chunk => { stderrBytes += chunk.length;stderrHash.update(chunk);if(stderrBytes>8192)terminate('stderr-limit'); });
  child.on('error', () => terminate('spawn-failed'));
  child.on('message', message => {
    messages++;messageBytes += Buffer.byteLength(JSON.stringify(message));
    if (messages>4000 || messageBytes>8*1024*1024) return terminate('evidence-limit');
    if (message?.kind==='ready' && !readyValue && !stopping) {
      readyValue=message;clearTimeout(startup);acceptReady(message);
    } else if (message?.kind==='executions' && Array.isArray(message.executions) && executions.length+message.executions.length<=2000) {
      executions.push(...message.executions);
    } else if (message?.kind==='closed' && !result) result=message;
    else terminate('invalid-message');
  });
  const closed = new Promise(resolve => child.on('close',(code,exitSignal) => {
    clearTimeout(startup);clearTimeout(lifetime);clearTimeout(killTimer);clearTimeout(stopTimer);signal?.removeEventListener('abort',abort);
    rejectReady(new Error('Application startup incomplete'));
    resolve({pid:child.pid??null,code,exitSignal,reason,result:result??null,executions,outputBytes,stderrBytes,stderrSha256:stderrHash.digest('hex')});
  }));
  try {
    const initial=await applicationSnapshot({pid:child.pid,parentPid:process.pid});
    const identity={pid:child.pid,parentPid:process.pid,startTicks:initial.startTicks};
    // Persist the owned identity before asking the child to initialize state or
    // listeners. A caller's receipt failure must prevent application startup.
    const returned=onStart(identity);
    if(returned && typeof returned.then==='function') {
      Promise.resolve(returned).catch(()=>{});throw new Error('Synchronous ownership recorder required');
    }
    if(signal?.aborted)abort();else child.send({directory,enabled},error=>{if(error)terminate('input-failed');});
    const value=await ready;
    if (value.pid!==child.pid || value.contractSource!=='verified-released-archive' || !/^http:\/\/127\.0\.0\.1:[0-9]+$/.test(value.url)) throw new Error('Application ready invalid');
    await applicationSnapshot(identity);
    return { ready:value, identity, closed,
      stop() {
        if (!stopping && child.connected) {
          stopping=true;stopTimer=setTimeout(()=>terminate('stop-deadline'),3000);
          child.send({kind:'stop'},error=>{if(error)terminate('stop-input-failed');});
        }
        return closed;
      } };
  } catch(error) { terminate('startup-incomplete');await closed;throw error; }
}
