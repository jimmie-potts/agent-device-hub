// Read-only workspace audit for one developer Mac: worktrees whose PRs are done, and Docker
// containers, images and volumes that task runs left behind. It removes nothing; cleanup follows
// docs/sdlc.md "Cleanup after delivery" and "Workspace audit".
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';

/** Installed stacks on this Mac. Their containers, volumes and networks are never task artifacts. */
export const installedPrefixes = Object.freeze(['bunny-mac-personal', 'bunny-tronbyt', 'bunny-diagnostics']);
const hour = 3_600_000;

export function parseArguments(args) {
  const options = {hours: 48, json: false};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json') options.json = true;
    else if (args[i] === '--hours' && /^\d+$/.test(args[i + 1] ?? '')) options.hours = Number(args[++i]);
    else throw new Error('usage: npm run audit:workspace -- [--hours <n>] [--json]');
  }
  return options;
}

/** Docker's `CreatedAt` text, `2026-11-01 16:03:21 -0400 EDT`, as a Date; null when unreadable. */
export function dockerDate(text) {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})/.exec(text ?? '');
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}${match[3]}:${match[4]}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const olderThan = (text, now, hours) => {
  const date = dockerDate(text);
  return date !== null && now.getTime() - date.getTime() > hours * hour;
};
const installed = name => installedPrefixes.some(prefix => name.startsWith(prefix));

/** `git worktree list --porcelain` as records; the first record is the main checkout. */
export function parseWorktrees(porcelain) {
  const records = [];
  for (const block of porcelain.split('\n\n')) {
    const lines = block.split('\n').filter(Boolean);
    if (!lines.length) continue;
    const record = {path: '', head: '', branch: null, detached: false, locked: false, prunable: false};
    for (const line of lines) {
      const [key, ...rest] = line.split(' ');
      const value = rest.join(' ');
      if (key === 'worktree') record.path = value;
      else if (key === 'HEAD') record.head = value;
      else if (key === 'branch') record.branch = value.replace(/^refs\/heads\//, '');
      else if (key === 'detached') record.detached = true;
      else if (key === 'locked') record.locked = true;
      else if (key === 'prunable') record.prunable = true;
    }
    records.push(record);
  }
  return records;
}

/**
 * Each worktree except the main checkout, with the cleanup verdict docs/sdlc.md gives it.
 * `prs` maps a branch name to its latest PR `{number, state, headRefOid}`; `dirty` maps a path to its
 * changed-entry count; a missing entry means the state is unknown.
 */
export function classifyWorktrees(worktrees, prs, dirty, root) {
  return worktrees.slice(1).map(worktree => {
    const changes = dirty.get(worktree.path);
    const pr = worktree.branch === null ? undefined : prs.get(worktree.branch);
    let verdict;
    if (worktree.path.startsWith(`${root}/.claude/worktrees/`) || worktree.path.includes('/.codex/worktrees/')) verdict = 'tool-managed: leave it to that tool';
    else if (worktree.locked) verdict = 'locked: keep';
    else if (changes === undefined) verdict = 'state unknown: inspect';
    else if (changes > 0) verdict = 'dirty: keep';
    else if (pr === undefined) verdict = worktree.detached ? 'detached, no PR: ask the owner' : 'no PR: keep';
    else if (pr.state === 'MERGED') verdict = pr.headRefOid === worktree.head ? `removable: PR #${pr.number} merged at this head` : `PR #${pr.number} merged, head differs: inspect`;
    else if (pr.state === 'CLOSED') verdict = `PR #${pr.number} closed: ask the owner`;
    else verdict = `PR #${pr.number} open: keep`;
    return {path: worktree.path, branch: worktree.branch, head: worktree.head.slice(0, 8), verdict};
  });
}

/** Stopped containers older than the window that no installed stack owns. */
export function staleContainers(containers, now, hours) {
  return containers.filter(container => container.State !== 'running' && !installed(container.Names) && olderThan(container.CreatedAt, now, hours))
    .map(container => ({id: container.ID, name: container.Names, image: container.Image, status: container.Status}));
}

/** Images older than the window that no container uses and that no rule protects. */
export function staleImages(images, containers, now, hours) {
  const references = new Set(containers.map(container => container.Image));
  const referenced = image => references.has(image.ID) || references.has(`${image.Repository}:${image.Tag}`) || (image.Tag === 'latest' && references.has(image.Repository)) || [...references].some(reference => /^[0-9a-f]{12,}$/.test(reference) && (reference.startsWith(image.ID) || image.ID.startsWith(reference)));
  return images.filter(image => image.Repository.startsWith('bunny') && !(image.Repository === 'bunny-core' && image.Tag.startsWith('release-')) && !referenced(image) && olderThan(image.CreatedAt, now, hours))
    .map(image => ({id: image.ID, reference: `${image.Repository}:${image.Tag}`, size: image.Size, created: image.CreatedAt}));
}

/** Volumes with no container that no installed stack owns. Compose volumes use `<project>_<name>`. */
export function staleVolumes(danglingVolumes) {
  return danglingVolumes.filter(volume => !installed(volume.Name)).map(volume => volume.Name);
}

export function render(report) {
  const lines = [`Workspace audit (${report.hours} h window, ${report.now})`, ''];
  lines.push(`Worktrees: ${report.worktrees.length}`);
  for (const worktree of report.worktrees) lines.push(`  ${worktree.verdict}  ${worktree.path} [${worktree.branch ?? 'detached'} ${worktree.head}]`);
  if (report.docker === null) lines.push('', 'Docker: unavailable');
  else {
    lines.push('', `Stopped task containers older than ${report.hours} h: ${report.docker.containers.length}`);
    for (const container of report.docker.containers) lines.push(`  ${container.id}  ${container.name}  ${container.status}`);
    lines.push('', `Unreferenced task images older than ${report.hours} h: ${report.docker.images.length}`);
    for (const image of report.docker.images) lines.push(`  ${image.id}  ${image.reference}  ${image.size}`);
    lines.push('', `Volumes with no container outside the installed stacks: ${report.docker.volumes.length}`);
    for (const volume of report.docker.volumes) lines.push(`  ${volume}`);
    lines.push('', 'Docker usage:', ...report.docker.usage.split('\n').map(line => `  ${line}`));
  }
  if (report.notes.length) lines.push('', ...report.notes.map(note => `Note: ${note}`));
  lines.push('', 'Nothing was removed. Cleanup rules: docs/sdlc.md "Cleanup after delivery" and "Workspace audit".');
  return lines.join('\n');
}

const run = (program, args) => execFileSync(program, args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024});
const jsonLines = text => text.split('\n').filter(Boolean).map(line => JSON.parse(line));

export function collect(root, options, now = new Date()) {
  const notes = [];
  const worktrees = parseWorktrees(run('git', ['-C', root, 'worktree', 'list', '--porcelain']));
  const dirty = new Map();
  for (const worktree of worktrees) {
    try {dirty.set(worktree.path, run('git', ['-C', worktree.path, 'status', '--porcelain']).split('\n').filter(Boolean).length);} catch {/* unreadable: reported as unknown */}
  }
  const prs = new Map();
  try {
    for (const pr of JSON.parse(run('gh', ['pr', 'list', '--state', 'all', '--limit', '300', '--json', 'number,state,headRefName,headRefOid'])).reverse()) prs.set(pr.headRefName, pr);
  } catch {notes.push('gh pr list failed: PR states are unknown, so no worktree is reported removable');}
  let docker = null;
  try {
    const containers = jsonLines(run('docker', ['container', 'ls', '--all', '--no-trunc', '--format', '{{json .}}']));
    const images = jsonLines(run('docker', ['image', 'ls', '--no-trunc', '--format', '{{json .}}'])).map(image => ({...image, ID: image.ID.replace(/^sha256:/, '')}));
    const volumes = jsonLines(run('docker', ['volume', 'ls', '--filter', 'dangling=true', '--format', '{{json .}}']));
    docker = {containers: staleContainers(containers, now, options.hours), images: staleImages(images, containers.map(container => ({...container, Image: container.Image.replace(/^sha256:/, '')})), now, options.hours), volumes: staleVolumes(volumes), usage: run('docker', ['system', 'df']).trim()};
  } catch {notes.push('docker is unavailable');}
  return {now: now.toISOString(), hours: options.hours, worktrees: classifyWorktrees(worktrees, prs, dirty, root), docker, notes};
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  const options = parseArguments(process.argv.slice(2));
  const root = run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim().replace(/\/\.git$/, '');
  const report = collect(root, options);
  process.stdout.write(`${options.json ? JSON.stringify(report, null, 2) : render(report)}\n`);
}
