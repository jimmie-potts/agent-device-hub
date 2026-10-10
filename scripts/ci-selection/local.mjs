#!/usr/bin/env node
// `npm run ci:select -- [--base <ref>] [--full]`: print the check groups a local change selects and the commands the
// Checks workflow would run for it (Hub #1080). It reads Git and .github/workflows/checks.yml and runs nothing.
// The comparison is <base>...HEAD plus uncommitted and untracked files, so it covers what you are about to push.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YAML from 'yaml';

import { JOBS, conditionJob, selectChecks, stepGroup } from './selection.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const lines = text => text.split('\n').map(line => line.trim()).filter(Boolean);
const runGit = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Every path the local change touches; --no-renames lists a rename as its deletion and its addition. */
export function localPaths({ base = 'origin/main', git = runGit } = {}) {
  return [...new Set([
    ...lines(git(['diff', '--name-only', '--no-renames', `${base}...HEAD`])),
    ...lines(git(['diff', '--name-only', '--no-renames', 'HEAD'])),
    ...lines(git(['diff', '--name-only', '--no-renames', '--cached'])),
    ...lines(git(['ls-files', '--others', '--exclude-standard'])),
  ])];
}

/** The Checks jobs and the commands each would run for `selection`, in workflow order. */
export function selectedCommands(workflow, selection) {
  return Object.entries(workflow.jobs).filter(([id]) => !['select', 'gate'].includes(id)).map(([id, job]) => {
    const conditional = conditionJob(job.if);
    if (job.if !== undefined && !conditional) throw new Error(`${id}: unsupported job condition ${JSON.stringify(job.if)}`);
    if (conditional && !Object.hasOwn(JOBS, conditional)) throw new Error(`${id}: the selection has no job ${conditional}`);
    const selected = conditional ? selection.jobs[conditional] : true;
    const commands = selected ? job.steps.filter(step => step.run && (!step.if || selection.groups.includes(stepGroup(step.if)))).map(step => step.run) : [];
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
  const selection = selectChecks(full ? { event: 'workflow_dispatch', paths: [], complete: true } : { event: 'pull_request', paths: localPaths({ base }), complete: true });
  console.log(`Affected checks against ${full ? 'a full run' : base}: ${selection.mode === 'full' ? 'full coverage' : 'selected groups'}`);
  console.log(`Selected: ${selection.groups.join(', ') || 'none (build, typecheck and lint only)'}`);
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
