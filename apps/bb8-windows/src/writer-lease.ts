import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {SdkError} from '@jimmie-potts/sdk';
/** One Windows owner per selected robot, even if two helpers use different state directories. */
export function acquireWriterLease(targetAddress: string, onLost: () => void): Promise<{release(): void}> {
  if (process.platform !== 'win32') return Promise.reject(new SdkError(errorBody('unavailable', {detail: 'BB-8 writer lease requires Windows'})));
  const name = `Global\\Bunny-BB8-${createHash('sha256').update(targetAddress.toLowerCase()).digest('hex')}`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('../../bin/writer-lease.ps1', import.meta.url)), '-Name', name], {stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true});
  return new Promise((resolve, reject) => {
    let owned = false, released = false, output = '';
    const fail = (): void => {clearTimeout(timer); if (!released) {released = true; child.kill(); if (owned) onLost(); else reject(new SdkError(errorBody('unavailable', {detail: 'BB-8 writer lease refused'})));}};
    const timer = setTimeout(fail, 10_000);
    child.once('error', fail); child.once('exit', fail);
    child.stdout.on('data', (chunk: Buffer) => {
      if (owned || released) return;
      output += chunk.toString('utf8');
      if (output.length > 32) {fail(); return;}
      if (output.trim() === 'owned') {owned = true; clearTimeout(timer); resolve({release: () => {released = true; child.stdin.end(); child.kill();}});}
    });
  });
}
