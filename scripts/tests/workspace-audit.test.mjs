import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyWorktrees, collect, dockerDate, parseArguments, parseWorktrees, referencedBy, render, sharedImages, staleContainers, staleImages, staleVolumes} from '../workspace-audit.mjs';

const now = new Date('2026-11-02T18:00:00Z');
const at = hoursAgo => {
  const date = new Date(now.getTime() - hoursAgo * 3_600_000);
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)} +0000 UTC`;
};
const coreId = '85c303e8df7ed6f43a11379c37cd4092d8c2276d06cd496d0c8f5ce70186358a';

test('arguments accept only the window and JSON switches', () => {
  assert.deepEqual(parseArguments([]), {hours: 48, json: false});
  assert.deepEqual(parseArguments(['--hours', '12', '--json']), {hours: 12, json: true});
  for (const args of [['--prune'], ['--hours'], ['--hours', 'soon'], ['--json', 'extra']]) assert.throws(() => parseArguments(args));
});

test('docker timestamps parse with their offset and refuse other text', () => {
  assert.equal(dockerDate('2026-11-01 16:03:21 -0400 EDT').toISOString(), '2026-11-01T20:03:21.000Z');
  assert.equal(dockerDate('2026-11-02 09:14:00 -0500 EST').toISOString(), '2026-11-02T14:14:00.000Z');
  assert.equal(dockerDate('3 hours ago'), null);
  assert.equal(dockerDate(undefined), null);
});

test('worktree verdicts follow the cleanup rules', () => {
  const root = '/repo';
  const porcelain = [
    'worktree /repo\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/main',
    'worktree /repo/.local/worktrees/done\nHEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nbranch refs/heads/gh-1-done',
    'worktree /repo/.local/worktrees/moved\nHEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\nbranch refs/heads/gh-2-moved',
    'worktree /repo/.local/worktrees/closed\nHEAD cccccccccccccccccccccccccccccccccccccccc\nbranch refs/heads/gh-3-closed',
    'worktree /repo/.local/worktrees/open\nHEAD dddddddddddddddddddddddddddddddddddddddd\nbranch refs/heads/gh-4-open',
    'worktree /repo/.local/worktrees/review\nHEAD eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\ndetached',
    'worktree /repo/.local/worktrees/dirty\nHEAD ffffffffffffffffffffffffffffffffffffffff\nbranch refs/heads/gh-5-dirty',
    'worktree /repo/.local/worktrees/locked\nHEAD 0000000000000000000000000000000000000000\nbranch refs/heads/gh-6-locked\nlocked',
    'worktree /repo/.claude/worktrees/session\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/claude/session',
    'worktree /home/me/.codex/worktrees/task/repo\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/codex/task',
    'worktree /repo/.local/worktrees/unknown\nHEAD 2222222222222222222222222222222222222222\nbranch refs/heads/gh-7-unknown',
    'worktree /repo/.local/worktrees/gone\nHEAD 3333333333333333333333333333333333333333\nbranch refs/heads/gh-8-gone\nprunable gitdir file points to non-existent location',
  ].join('\n\n');
  const worktrees = parseWorktrees(porcelain);
  assert.equal(worktrees.length, 12);
  assert.equal(worktrees[0].branch, 'main');
  assert.equal(worktrees[5].detached, true);
  assert.equal(worktrees[7].locked, true);
  assert.equal(worktrees[11].prunable, true);
  const prs = new Map([
    ['gh-1-done', {number: 10, state: 'MERGED', headRefOid: 'a'.repeat(40)}],
    ['gh-2-moved', {number: 11, state: 'MERGED', headRefOid: 'b'.repeat(39) + '0'}],
    ['gh-3-closed', {number: 12, state: 'CLOSED', headRefOid: 'c'.repeat(40)}],
    ['gh-4-open', {number: 13, state: 'OPEN', headRefOid: 'd'.repeat(40)}],
    ['gh-6-locked', {number: 14, state: 'MERGED', headRefOid: '0'.repeat(40)}],
    ['gh-7-unknown', {number: 15, state: 'MERGED', headRefOid: '2'.repeat(40)}],
    ['gh-8-gone', {number: 16, state: 'MERGED', headRefOid: '3'.repeat(40)}],
  ]);
  const dirty = new Map(worktrees.filter(worktree => !/\/(?:unknown|gone)$/.test(worktree.path)).map(worktree => [worktree.path, worktree.path.endsWith('/dirty') ? 2 : 0]));
  const verdicts = Object.fromEntries(classifyWorktrees(worktrees, prs, dirty, root).map(entry => [entry.path.split('/').at(-1) === 'repo' ? 'codex' : entry.path.split('/').at(-1), entry.verdict]));
  assert.deepEqual(verdicts, {
    done: 'removable: PR #10 merged at this head',
    moved: 'PR #11 merged, head differs: inspect',
    closed: 'PR #12 closed: ask the owner',
    open: 'PR #13 open: keep',
    review: 'detached, no PR: ask the owner',
    dirty: 'dirty: keep',
    locked: 'locked: keep',
    session: 'tool-managed: leave it to that tool',
    codex: 'tool-managed: leave it to that tool',
    unknown: 'state unknown: inspect',
    gone: 'prunable, directory missing: git worktree prune after the owner confirms',
  });
});

test('stopped containers outside the installed stacks and older than the window are reported', () => {
  const containers = [
    {ID: 'c1', Names: 'bunny-gh9-browser', Image: 'bunny-gh9:test', State: 'exited', Status: 'Exited (0) 3 days ago', CreatedAt: at(72)},
    {ID: 'c2', Names: 'bunny-gh9-fresh', Image: 'bunny-gh9:test', State: 'exited', Status: 'Exited (0) 2 hours ago', CreatedAt: at(2)},
    {ID: 'c3', Names: 'bunny-mac-personal-core-1', Image: 'abc', State: 'running', Status: 'Up 3 days', CreatedAt: at(72)},
    {ID: 'c4', Names: 'bunny-diagnostics-loki-1', Image: 'grafana/loki:3', State: 'exited', Status: 'Exited (255) 3 days ago', CreatedAt: at(72)},
    {ID: 'c5', Names: 'bunny-gh9-running', Image: 'bunny-gh9:test', State: 'running', Status: 'Up 3 days', CreatedAt: at(72)},
    {ID: 'c6', Names: 'bunny-gh9-paused', Image: 'bunny-gh9:test', State: 'paused', Status: 'Up 3 days (Paused)', CreatedAt: at(72)},
    {ID: 'c7', Names: 'bunny-gh9-created', Image: 'bunny-gh9:test', State: 'created', Status: 'Created', CreatedAt: at(72)},
  ];
  assert.deepEqual(staleContainers(containers, now, 48).map(container => container.id), ['c1', 'c7']);
  assert.deepEqual(staleContainers(containers, now, 1).map(container => container.id), ['c1', 'c2', 'c7']);
});

test('every container image reference form protects its image', () => {
  const referenced = referencedBy([
    {Image: 'bunny-gh9:test'},
    {Image: `sha256:${coreId}`},
    {Image: coreId.slice(0, 12)},
    {Image: 'bunny-review'},
    {Image: 'grafana/loki:3.7.9@sha256:0db2000000000000000000000000000000000000000000000000000000000000'},
    {Image: 'bunny-pinned@sha256:1111111111111111111111111111111111111111111111111111111111111111'},
    {Image: 'registry.local:5000/bunny-remote:v1'},
  ]);
  for (const image of [
    {ID: 'aaaa111111111111', Repository: 'bunny-gh9', Tag: 'test'},
    {ID: `sha256:${coreId}`, Repository: 'bunny-gh1354-codex', Tag: '00fa1c7b'},
    {ID: coreId, Repository: 'bunny-gh1354-codex', Tag: '00fa1c7b'},
    {ID: 'aaaa666666666666', Repository: 'bunny-review', Tag: 'latest'},
    {ID: 'aaaa777777777777', Repository: 'grafana/loki', Tag: '3.7.9'},
    {ID: 'bbbb777777777777', Repository: 'grafana/loki', Tag: '<none>'},
    {ID: 'aaaa888888888888', Repository: 'bunny-pinned', Tag: 'anything'},
    {ID: 'aaaa999999999999', Repository: 'registry.local:5000/bunny-remote', Tag: 'v1'},
  ]) assert.equal(referenced(image), true, `${image.Repository}:${image.Tag}`);
  for (const image of [
    {ID: 'aaaa222222222222', Repository: 'bunny-gh9', Tag: 'core'},
    {ID: 'bbbb222222222222', Repository: 'bunny-review', Tag: 'old'},
    {ID: 'cccc222222222222', Repository: 'registry.local:5000/bunny-remote', Tag: 'v2'},
  ]) assert.equal(referenced(image), false, `${image.Repository}:${image.Tag}`);
});

test('images stay when referenced, qualified, third-party, shared, untagged or recent', () => {
  const containers = [{Image: 'bunny-gh9:test'}, {Image: `sha256:${coreId}`}];
  const images = [
    {ID: 'aaaa111111111111', Repository: 'bunny-gh9', Tag: 'test', Size: '4GB', CreatedAt: at(72)},
    {ID: 'aaaa222222222222', Repository: 'bunny-gh9', Tag: 'core', Size: '2GB', CreatedAt: at(72)},
    {ID: `sha256:${coreId}`, Repository: 'bunny-gh1354-codex', Tag: '00fa1c7b', Size: '2GB', CreatedAt: at(72)},
    {ID: 'aaaa333333333333', Repository: 'bunny-core', Tag: 'release-47de5cd44072', Size: '2GB', CreatedAt: at(72)},
    {ID: 'aaaa444444444444', Repository: 'grafana/loki', Tag: '3.7.9', Size: '100MB', CreatedAt: at(72)},
    {ID: 'aaaa555555555555', Repository: 'bunny-gh9', Tag: 'recent', Size: '2GB', CreatedAt: at(1)},
    {ID: 'aaaa777777777777', Repository: 'bunny-core', Tag: 'mac-f5438869', Size: '2GB', CreatedAt: at(72)},
    {ID: 'aaaa888888888888', Repository: 'bunny-runtime-check-tools', Tag: '65b6a8336002b9696a1ad7d0', Size: '3.6GB', CreatedAt: at(72)},
    {ID: 'aaaa999999999999', Repository: '<none>', Tag: '<none>', Size: '3GB', CreatedAt: at(72)},
    {ID: 'aaaa000000000000', Repository: '<none>', Tag: '<none>', Size: '3GB', CreatedAt: at(72)},
  ];
  assert.deepEqual(staleImages(images, containers, now, 48).map(image => image.reference), ['bunny-gh9:core', 'bunny-core:mac-f5438869']);
  const shared = sharedImages(images, [...containers, {Image: 'aaaa000000000000'}]);
  assert.deepEqual(shared.launcherCaches.map(image => image.reference), ['bunny-runtime-check-tools:65b6a8336002b9696a1ad7d0']);
  assert.deepEqual(shared.untagged.map(image => image.id), ['aaaa999999999999']);
});

test('only container-less task-named volumes are reported, never installed or data volumes', () => {
  const volumes = ['acceptance-b7-archives', 'acceptance-b7-restore_state', 'acceptance-b7-scratch', 'bunny-mac-personal_state', 'bunny-mac-personal-archives', 'bunny-diagnostics_loki-data', 'bunny-gh1112-npm-cache', 'bunny-archives', 'bunny_state', 'bunny-runtime-check-abc', 'bunny-1330-fixture', 'unrelated'].map(Name => ({Name}));
  assert.deepEqual(staleVolumes(volumes), ['acceptance-b7-scratch', 'bunny-gh1112-npm-cache', 'bunny-runtime-check-abc', 'bunny-1330-fixture']);
});

test('collection normalizes docker output, skips prunable and unreadable worktrees and notes a truncated PR list', () => {
  const calls = [];
  const porcelain = ['worktree /repo\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/main',
    'worktree /repo/.local/worktrees/done\nHEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nbranch refs/heads/gh-1-done',
    'worktree /repo/.local/worktrees/gone\nHEAD 3333333333333333333333333333333333333333\nbranch refs/heads/gh-8-gone\nprunable gone',
    'worktree /repo/.local/worktrees/broken\nHEAD 4444444444444444444444444444444444444444\nbranch refs/heads/gh-9-broken'].join('\n\n');
  const prs = Array.from({length: 300}, (_, i) => ({number: 400 - i, state: i === 0 ? 'MERGED' : 'OPEN', headRefName: i === 0 ? 'gh-1-done' : `other-${i}`, headRefOid: 'a'.repeat(40)}));
  const run = (program, args) => {
    calls.push([program, ...args]);
    const key = `${program} ${args.join(' ')}`;
    if (key.endsWith('worktree list --porcelain')) return porcelain;
    if (key.includes('/broken status')) throw new Error('unreadable');
    if (key.includes(' status --porcelain')) return '';
    if (program === 'gh') return JSON.stringify(prs);
    if (key.startsWith('docker container')) return `${JSON.stringify({ID: coreId, Names: 'bunny-mac-personal-core-1', Image: `sha256:${coreId}`, State: 'running', Status: 'Up', CreatedAt: at(72)})}\n${JSON.stringify({ID: 'c'.repeat(64), Names: 'bunny-gh9-old', Image: 'aaaa111111111111', State: 'exited', Status: 'Exited (0)', CreatedAt: at(72)})}\n`;
    if (key.startsWith('docker image')) return [{ID: `sha256:${coreId}`, Repository: 'bunny-gh1354-codex', Tag: '00fa1c7b', Size: '2GB', CreatedAt: at(72)}, {ID: 'sha256:aaaa111111111111aaaa', Repository: 'bunny-gh9', Tag: 'test', Size: '2GB', CreatedAt: at(72)}, {ID: 'sha256:bbbb111111111111bbbb', Repository: 'bunny-gh9', Tag: 'core', Size: '2GB', CreatedAt: at(72)}].map(image => JSON.stringify(image)).join('\n');
    if (key.startsWith('docker volume')) return '';
    if (key.startsWith('docker system')) return 'TYPE SIZE\n';
    throw new Error(`unexpected ${key}`);
  };
  const report = collect('/repo', {hours: 48, json: false}, now, run);
  assert.deepEqual(report.worktrees.map(worktree => worktree.verdict), ['removable: PR #400 merged at this head', 'prunable, directory missing: git worktree prune after the owner confirms', 'state unknown: inspect']);
  assert.ok(calls.some(call => call[0] === 'git' && call[1] === '--no-optional-locks' && call.includes('/repo/.local/worktrees/done')));
  assert.equal(calls.some(call => call.includes('/repo/.local/worktrees/gone')), false);
  assert.deepEqual(report.docker.containers.map(container => container.name), ['bunny-gh9-old']);
  assert.deepEqual(report.docker.images.map(image => image.reference), ['bunny-gh9:core'], 'the running core and the stopped container\'s image stay');
  assert.match(report.notes[0], /newest 300 PRs only/);
  assert.equal(calls.some(call => /\b(rm|rmi|prune|stop|kill)\b/.test(call.join(' '))), false, 'the audit only reads');
  const failing = collect('/repo', {hours: 48, json: false}, now, (program, args) => {
    if (program === 'git' && args.includes('list')) return porcelain.split('\n\n')[0];
    throw new Error('missing tool');
  });
  assert.equal(failing.docker, null);
  assert.deepEqual(failing.notes, ['gh pr list failed: PR states are unknown, so no worktree is reported removable', 'docker is unavailable']);
});

test('the report names counts, verdicts and that nothing was removed', () => {
  const text = render({now: now.toISOString(), hours: 48, worktrees: [{path: '/repo/.local/worktrees/done', branch: 'gh-1-done', head: 'aaaaaaaa', verdict: 'removable: PR #10 merged at this head'}],
    docker: {containers: [{id: 'c1', name: 'bunny-gh9-browser', image: 'bunny-gh9:test', status: 'Exited (0) 3 days ago'}], images: [], volumes: ['acceptance-b7-scratch'],
      shared: {launcherCaches: [{id: 'aaaa888888888888', reference: 'bunny-runtime-check-tools:65b6', size: '3.6GB'}], untagged: []}, usage: 'TYPE SIZE'}, notes: ['gh pr list failed']});
  for (const expected of ['Worktrees other than the main checkout: 1', 'removable: PR #10', 'containers older than 48 h: 1', 'bunny-gh9-browser', 'images older than 48 h: 0', 'Container-less task volumes: 1', 'acceptance-b7-scratch', 'Shared launcher caches', 'bunny-runtime-check-tools:65b6', 'Untagged images no container uses', 'Note: gh pr list failed', 'Nothing was removed']) assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(render({now: now.toISOString(), hours: 48, worktrees: [], docker: null, notes: []}), /Docker: unavailable/);
});
