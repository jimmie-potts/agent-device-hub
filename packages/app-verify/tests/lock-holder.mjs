// Holder records for receipt-lock tests: a live one for this process, or a dead one
// taken from a child process that has already exited.
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';

async function startTime(pid) {
  const text = await readFile(`/proc/${pid}/stat`, 'utf8');
  return text.slice(text.lastIndexOf(')') + 2).split(' ')[19];
}

export async function holderRecord({dead}) {
  if (!dead) return `${process.pid} ${await startTime(process.pid)}\n`;
  // An exited process: its PID and a start time no live process has.
  const child = spawnSync('sh', ['-c', 'echo $$']);
  return `${Number(String(child.stdout).trim())} 1\n`;
}
