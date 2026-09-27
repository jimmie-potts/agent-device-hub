// One contender for lock.test.mjs: it takes the composition lock over and over,
// marks the critical section, and sometimes dies while holding it, as a killed
// orchestrator would. An overlap is another live process found inside.
import {appendFileSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {DirectoryLock} from '../lock.mjs';

const [dir, until, crashPercent] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4])];
const lock = new DirectoryLock(dir, '.composition.lock');
const inside = join(dir, 'inside');
const live = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};
while (Date.now() < until) {
  await lock.run(async stillHeld => {
    try {
      writeFileSync(inside, String(process.pid), {flag: 'wx'});
    } catch {
      const other = Number(readFileSync(inside, 'utf8'));
      if (other !== process.pid && live(other)) appendFileSync(join(dir, 'overlaps'), `${process.pid} found ${other}\n`);
      writeFileSync(inside, String(process.pid));
    }
    await new Promise(done => setTimeout(done, 1 + Math.floor(Math.random() * 4)));
    if (Math.random() * 100 < crashPercent) process.exit(9);
    if (!(await stillHeld())) appendFileSync(join(dir, 'overlaps'), `${process.pid} lost the lock while inside\n`);
    rmSync(inside, {force: true});
  }).catch(error => {
    if (error.name !== 'LockedError') throw error;
  });
}
