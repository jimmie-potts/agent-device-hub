#!/usr/bin/env node
// `npm run ci:select -- [--base <ref>] [--full]`: print the check groups a local change selects and the commands the
// Checks workflow would run for it (Hub #1080). It reads Git and .github/workflows/checks.yml and runs nothing.
// The comparison is <base>...HEAD plus uncommitted and untracked files, so it covers what you are about to push.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YAML from 'yaml';

import {standaloneOwners,OWNERS} from './standalone.mjs';
import { JOBS, conditionJob, selectChecks, stepGroup, stepOwner } from './selection.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
// Git filenames may contain whitespace, tabs and newlines. Never normalize a path.
const nulRecords = text => {
  if (text === '') return [];
  if (!text.endsWith('\0')) throw new Error('Git returned an incomplete NUL-delimited path list');
  return text.slice(0, -1).split('\0');
};
const runGit = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Every path the local change touches; --no-renames lists a rename as its deletion and its addition. */
export function localPaths({ base = 'origin/main', git = runGit } = {}) {
  return [...new Set([
    ...nulRecords(git(['diff', '--name-only', '--no-renames', '-z', `${base}...HEAD`])),
    ...nulRecords(git(['diff', '--name-only', '--no-renames', '-z', 'HEAD'])),
    ...nulRecords(git(['diff', '--name-only', '--no-renames', '-z', '--cached'])),
    ...nulRecords(git(['ls-files', '--others', '--exclude-standard', '-z'])),
  ])];
}

/** A dirty local comparison cannot establish committed file-status/type evidence. */
export function localChanges({base='origin/main',git=runGit}={}){
  if(git(['status','--porcelain','-z'])!=='')return undefined;
  const records=nulRecords(git(['diff','--name-status','--no-renames','-z',`${base}...HEAD`]));
  if(records.length%2)throw new Error('Git returned incomplete name/status records');
  const changes=[];
  for(let index=0;index<records.length;index+=2){
    const [status,filename]=records.slice(index,index+2);
    if(!/^[A-Z][0-9]*$/.test(status)||!filename)throw new Error('Git returned invalid name/status records');
    changes.push({filename,status:status==='M'?'modified':status});
  }
  if(!standaloneOwners(changes.map(file=>file.filename),changes,{requireModes:false}))return changes;
  const mergeBase=git(['merge-base',base,'HEAD']).trim();
  return changes.map(file=>({...file,...Object.fromEntries([['beforeMode',mergeBase],['mode','HEAD']].map(([key,ref])=>{
    const entries=nulRecords(git(['ls-tree','-z',ref,'--',file.filename]));
    const entry=entries.length===1?entries[0].match(/^100644 blob [a-f0-9]{40}\t([\s\S]+)$/):null;
    return [key,entry?.[1]===file.filename?'100644':null];
  }))}));
}

/** The Checks jobs and the commands each would run for `selection`, in workflow order. */
export function selectedCommands(workflow, selection) {
  return Object.entries(workflow.jobs).filter(([id]) => !['select', 'gate'].includes(id)).map(([id, job]) => {
    const conditional = conditionJob(job.if);
    if (job.if !== undefined && !conditional) throw new Error(`${id}: unsupported job condition ${JSON.stringify(job.if)}`);
    if (conditional && !Object.hasOwn(JOBS, conditional)) throw new Error(`${id}: the selection has no job ${conditional}`);
    const selected = conditional ? selection.jobs[conditional] : true;
    const commands = selected ? job.steps.filter(step => step.run && (!step.if || selection.groups.includes(stepGroup(step.if)) || (selection.owners??[]).includes(stepOwner(step.if)))).flatMap(step => step.run==='node scripts/ci-selection/run-standalone.mjs'&&selection.owners?.length ? selection.owners.flatMap(owner=>Object.keys(OWNERS[owner].scripts).map(script=>'npm run '+script)): [step.run]) : [];
    return { id, name: job.name, selected, commands };
  });
}

function main(argv) {
  let base = 'origin/main';
  let full = false;
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base' && argv[index + 1]) base = argv[(index += 1)];
    else if (argv[index] === '--full') full = true;
    else {
      console.error('usage: npm run ci:select -- [--base <ref>] [--full]');
      return 2;
    }
  }
  const selection = selectChecks(full ? { event: 'workflow_dispatch', paths: [], complete: true } : { event: 'pull_request', paths: localPaths({ base }), changes:localChanges({base}), complete: true });
  console.log(`Affected checks against ${full ? 'a full run' : base}: ${selection.mode === 'full' ? 'full coverage' : 'selected groups'}`);
  console.log(`Selected: ${selection.owners?.join(', ') || selection.groups.join(', ') || 'none (build, typecheck and lint only)'}`);
  console.log(`Omitted: ${selection.omitted.join(', ') || 'none'}`);
  for (const item of selection.full) console.log(`  full coverage: ${item.path ? `${item.path} is ` : ''}${item.reason}`);
  for (const item of selection.reasons) console.log(`  ${item.path}: ${item.groups.join(', ') || 'no group'}`);
  const workflow = YAML.parse(readFileSync(join(root, '.github/workflows/checks.yml'), 'utf8'));
  for (const job of selectedCommands(workflow, selection)) {
    console.log(`\n${job.name}: ${job.selected ? 'runs' : 'skipped, not selected'}`);
    for (const command of job.commands) console.log(`  ${command.trim().split('\n').join('\n  ')}`);
  }
  console.log('\nThe Workflow workflow runs every change in full. Run local checks under docs/sdlc.md step 1.');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exitCode = main(process.argv.slice(2));
