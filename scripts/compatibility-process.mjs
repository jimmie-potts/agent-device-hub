import {spawn} from 'node:child_process';
import {once} from 'node:events';

export async function stopChild(child, exited, timeout = 3000, group = false) {
  const signal = name => {
    if (!group) return child.kill(name);
    try {process.kill(-child.pid, name);} catch (error) {if (error.code !== 'ESRCH') throw error;}
  };
  if (child.exitCode !== null || child.signalCode !== null) {await exited;if (group) signal('SIGKILL');return;}
  signal('SIGTERM');
  let timer;
  try {
    const stopped = await Promise.race([exited.then(() => true), new Promise(r => {timer = setTimeout(() => r(false), timeout);})]);
    if (!stopped) {signal('SIGKILL');await exited;}
    // A build's shell can exit before its compiler; kill remaining owned group members.
    if (group) signal('SIGKILL');
  } finally {clearTimeout(timer);}
}

export function ownedChild(command, args, options = {}) {
  const child = spawn(command, args, {...options, detached: true});
  const exited = once(child, 'exit');
  // Consumers attach their own failure handler; retain the rejection meanwhile.
  exited.catch(() => {});
  return {child, exited, stop: () => stopChild(child, exited, 3000, true)};
}
