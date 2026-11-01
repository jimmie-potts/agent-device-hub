import {spawnSync} from 'node:child_process';
import {runSuites} from '../runtime-container.mjs';

const run = (program, args) => {
  const result = spawnSync(program, args, {stdio:'inherit'});
  if (result.error) throw result.error;
  return result.status ?? 1;
};
const commands = [
  ['chown',['-R','0:0','.']],
  ['git',['init','-q']],
  ['git',['add','.']],
  ['git',['-c','user.name=Disposable runtime checks','-c','user.email=checks@invalid','commit','-q','-m','Current task source snapshot']],
  ['npm',['ci','--include=dev','--offline','--no-audit','--no-fund','--cache','/root/.npm']],
  ['npm',['run','build']],
];
let status = 0;
for (const [program,args] of commands) {
  status = run(program,args);
  if (status !== 0) break;
}
if (status === 0) status = await runSuites(process.argv[2], args => run('npm',args));
process.exitCode = status;
