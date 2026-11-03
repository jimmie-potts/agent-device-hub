// Read-only workspace audit for one developer Mac: worktrees whose PRs are done, and Docker
// containers, images and volumes that task runs left behind. It removes nothing; cleanup follows
// docs/sdlc.md "Cleanup after delivery" and "Workspace audit".
import {execFileSync} from 'node:child_process';
import {readdirSync, readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Installed stacks on this Mac. Their containers, volumes and networks are never task artifacts. */
export const installedPrefixes = Object.freeze(['bunny-mac-personal', 'bunny-tronbyt', 'bunny-diagnostics']);
/** The launcher's shared tool-image cache, keyed by manifest hash, not by task (scripts/runtime-container.mjs). */
export const launcherCacheRepository = 'bunny-runtime-check-tools';
/** Volume names task runs create: an issue number, the launcher's identity or an acceptance exercise. */
const taskVolume = /^(?:bunny-gh\d+|bunny-\d+|bunny-runtime-check|acceptance)-/;
/** Data volumes, whatever created them. docs/bunny-container.md: never remove a data volume. */
const dataVolume = /archives|_state$|_config$|_secrets$/;
const stoppedStates = new Set(['exited', 'dead', 'created']);
/** Where the batch operator keeps its private records (scripts/bunny-operations.mjs) and the installed Compose files. */
export const installedRoots = Object.freeze({operations: join(homedir(), '.local', 'state', 'bunny-operations'), releases: join(homedir(), '.local', 'share', 'bunny', 'releases')});
const imageId = /^(?:sha256:)?[0-9a-f]{64}$/;
const prLimit = 300;
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
    else if (worktree.prunable) verdict = 'prunable, directory missing: git worktree prune after the owner confirms';
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
  return containers.filter(container => stoppedStates.has(container.State) && !installed(container.Names) && olderThan(container.CreatedAt, now, hours))
    .map(container => ({id: container.ID, name: container.Names, image: container.Image, status: container.Status}));
}

/**
 * Whether any container references the image. A container's `Image` is an ID (full or 12-hex prefix,
 * with or without `sha256:`), `repository:tag`, `repository` (tag latest), or either form pinned with
 * `@sha256:<digest>`. A digest pin without a tag names the repository, so every tag of it stays.
 */
export function referencedBy(containers) {
  const ids = new Set();
  const tags = new Set();
  const repositories = new Set();
  for (const container of containers) {
    const pinned = /@sha256:[0-9a-f]+$/.test(container.Image);
    const reference = container.Image.replace(/^sha256:/, '').replace(/@sha256:[0-9a-f]+$/, '');
    const tagged = reference.lastIndexOf(':') > reference.lastIndexOf('/');
    if (/^[0-9a-f]{12,64}$/.test(reference)) ids.add(reference);
    else if (tagged) tags.add(reference);
    else if (!pinned) tags.add(`${reference}:latest`);
    // A digest-pulled image's local row carries Tag `<none>`, so a pin protects its whole repository.
    if (pinned && !/^[0-9a-f]{12,64}$/.test(reference)) repositories.add(tagged ? reference.slice(0, reference.lastIndexOf(':')) : reference);
  }
  return image => {
    const id = image.ID.replace(/^sha256:/, '');
    return [...ids].some(reference => id.startsWith(reference) || reference.startsWith(id))
      || tags.has(`${image.Repository}:${image.Tag}`) || repositories.has(image.Repository);
  };
}

const protectedImage = image => !image.Repository.startsWith('bunny') || image.Repository === launcherCacheRepository || (image.Repository === 'bunny-core' && image.Tag.startsWith('release-'));

/**
 * Image IDs the installation names: `previousImage`, `targetImage` and the observed image of every batch
 * record under the operation root, and the `image` of every `compose*` file (installed Compose files and
 * batch replacements) at the root of each release directory. Release inputs below that root, such as
 * `private-inputs/`, are not read. The previous image is the return target docs/bunny-container.md keeps.
 * Only IDs are read; nothing else in those private files is retained. Unreadable roots yield no IDs.
 */
export function installedImageIds(roots = installedRoots, read = {readdir: readdirSync, readFile: path => readFileSync(path, 'utf8')}) {
  const ids = new Set();
  const add = value => {if (typeof value === 'string' && imageId.test(value)) ids.add(value.replace(/^sha256:/, ''));};
  const list = directory => {try {return read.readdir(directory);} catch {return [];}};
  for (const entry of list(roots.operations).filter(name => name.endsWith('.records'))) {
    for (const file of list(join(roots.operations, entry)).filter(name => name.endsWith('.json'))) {
      try {
        const record = JSON.parse(read.readFile(join(roots.operations, entry, file)));
        add(record.previousImage); add(record.targetImage); add(record.observation?.image);
      } catch {/* not a record */}
    }
  }
  for (const release of list(roots.releases)) {
    for (const file of list(join(roots.releases, release)).filter(name => name.startsWith('compose'))) {
      try {
        const text = read.readFile(join(roots.releases, release, file));
        if (file.endsWith('.json')) for (const service of Object.values(JSON.parse(text).services ?? {})) add(service?.image);
        else for (const match of text.matchAll(/^\s*image:\s*["']?(\S+?)["']?\s*$/gm)) add(match[1]);
      } catch {/* not a Compose file */}
    }
  }
  return ids;
}

/** Task images older than the window that no container uses, that the installation does not name and that no rule protects. */
export function staleImages(images, containers, now, hours, installed = new Set()) {
  const referenced = referencedBy(containers);
  const named = image => installed.has(image.ID.replace(/^sha256:/, ''));
  return images.filter(image => !protectedImage(image) && image.Repository !== '<none>' && !referenced(image) && !named(image) && olderThan(image.CreatedAt, now, hours))
    .map(image => ({id: image.ID.replace(/^sha256:/, ''), reference: `${image.Repository}:${image.Tag}`, size: image.Size, created: image.CreatedAt}));
}

/** The launcher's shared tool-image caches and untagged leftovers, listed for the owner, never as task artifacts. */
export function sharedImages(images, containers) {
  const referenced = referencedBy(containers);
  const entry = image => ({id: image.ID.replace(/^sha256:/, ''), reference: `${image.Repository}:${image.Tag}`, size: image.Size, created: image.CreatedAt});
  return {
    launcherCaches: images.filter(image => image.Repository === launcherCacheRepository).map(entry),
    untagged: images.filter(image => image.Repository === '<none>' && !referenced(image)).map(entry),
  };
}

/** Container-less volumes that a task run created. Installed-stack and data volumes never appear. */
export function staleVolumes(danglingVolumes) {
  return danglingVolumes.filter(volume => taskVolume.test(volume.Name) && !installed(volume.Name) && !dataVolume.test(volume.Name)).map(volume => volume.Name);
}

const imageLine = image => `  ${image.id.slice(0, 12)}  ${image.reference}  ${image.size}`;

export function render(report) {
  const lines = [`Workspace audit (${report.hours} h window, ${report.now})`, ''];
  lines.push(`Worktrees other than the main checkout: ${report.worktrees.length}`);
  for (const worktree of report.worktrees) lines.push(`  ${worktree.verdict}  ${worktree.path} [${worktree.branch ?? 'detached'} ${worktree.head}]`);
  if (report.docker === null) lines.push('', 'Docker: unavailable');
  else {
    lines.push('', `Stopped task containers older than ${report.hours} h: ${report.docker.containers.length}`);
    for (const container of report.docker.containers) lines.push(`  ${container.id.slice(0, 12)}  ${container.name}  ${container.status}`);
    lines.push('', `Unreferenced task images older than ${report.hours} h: ${report.docker.images.length}`);
    for (const image of report.docker.images) lines.push(imageLine(image));
    lines.push('', `Images the installation names (deployment records and installed Compose files, kept): ${report.docker.installed.length}`);
    for (const id of report.docker.installed) lines.push(`  ${id.slice(0, 12)}`);
    lines.push('', `Container-less task volumes: ${report.docker.volumes.length}`);
    for (const volume of report.docker.volumes) lines.push(`  ${volume}`);
    lines.push('', `Shared launcher caches (${launcherCacheRepository}, owner decision, not task artifacts): ${report.docker.shared.launcherCaches.length}`);
    for (const image of report.docker.shared.launcherCaches) lines.push(imageLine(image));
    lines.push('', `Untagged images no container uses (left by rebuilt tags, owner decision): ${report.docker.shared.untagged.length}`);
    for (const image of report.docker.shared.untagged) lines.push(imageLine(image));
    lines.push('', 'Docker usage:', ...report.docker.usage.split('\n').map(line => `  ${line}`));
  }
  if (report.notes.length) lines.push('', ...report.notes.map(note => `Note: ${note}`));
  lines.push('', 'Nothing was removed. Cleanup rules: docs/sdlc.md "Cleanup after delivery" and "Workspace audit".');
  return lines.join('\n');
}

const defaultRun = (program, args) => execFileSync(program, args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024});
const jsonLines = text => text.split('\n').filter(Boolean).map(line => JSON.parse(line));

/** The report. `run(program, args)` returns a command's stdout or throws; tests inject it and `installed`. */
export function collect(root, options, now = new Date(), run = defaultRun, installed = installedImageIds()) {
  const notes = [];
  const worktrees = parseWorktrees(run('git', ['-C', root, 'worktree', 'list', '--porcelain']));
  const dirty = new Map();
  for (const worktree of worktrees) {
    if (worktree.prunable) continue;
    try {dirty.set(worktree.path, run('git', ['--no-optional-locks', '-C', worktree.path, 'status', '--porcelain']).split('\n').filter(Boolean).length);} catch {/* unreadable: reported as unknown */}
  }
  const prs = new Map();
  try {
    const rows = JSON.parse(run('gh', ['pr', 'list', '--state', 'all', '--limit', String(prLimit), '--json', 'number,state,headRefName,headRefOid']));
    for (const pr of rows.reverse()) prs.set(pr.headRefName, pr);
    if (rows.length >= prLimit) notes.push(`gh pr list returned the newest ${prLimit} PRs only: a worktree whose PR is older is reported as "no PR"`);
  } catch {notes.push('gh pr list failed: PR states are unknown, so no worktree is reported removable');}
  let docker = null;
  try {
    const containers = jsonLines(run('docker', ['container', 'ls', '--all', '--no-trunc', '--format', '{{json .}}']));
    const images = jsonLines(run('docker', ['image', 'ls', '--no-trunc', '--format', '{{json .}}']));
    const volumes = jsonLines(run('docker', ['volume', 'ls', '--filter', 'dangling=true', '--format', '{{json .}}']));
    if (installed.size === 0) notes.push('no deployment record or installed Compose file named an image: the previous installed image, if any, is not protected by name');
    docker = {containers: staleContainers(containers, now, options.hours), images: staleImages(images, containers, now, options.hours, installed), volumes: staleVolumes(volumes), shared: sharedImages(images, containers), installed: [...installed].sort(), usage: run('docker', ['system', 'df']).trim()};
  } catch {notes.push('docker is unavailable');}
  return {now: now.toISOString(), hours: options.hours, worktrees: classifyWorktrees(worktrees, prs, dirty, root), docker, notes};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArguments(process.argv.slice(2));
  const root = defaultRun('git', ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim().replace(/\/\.git$/, '');
  const report = collect(root, options);
  process.stdout.write(`${options.json ? JSON.stringify(report, null, 2) : render(report)}\n`);
}
