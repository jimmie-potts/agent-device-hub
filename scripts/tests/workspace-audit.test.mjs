import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyWorktrees, dockerDate, parseArguments, parseWorktrees, render, staleContainers, staleImages, staleVolumes} from '../workspace-audit.mjs';

const now = new Date('2026-11-02T18:00:00Z');
const at = hoursAgo => {
  const date = new Date(now.getTime() - hoursAgo * 3_600_000);
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 19)} +0000 UTC`;
};

test('arguments accept only the window and JSON switches', () => {
  assert.deepEqual(parseArguments([]), {hours: 48, json: false});
  assert.deepEqual(parseArguments(['--hours', '12', '--json']), {hours: 12, json: true});
  for (const args of [['--prune'], ['--hours'], ['--hours', 'soon'], ['--json', 'extra']]) assert.throws(() => parseArguments(args));
});

test('docker timestamps parse with their offset and refuse other text', () => {
  assert.equal(dockerDate('2026-11-01 16:03:21 -0400 EDT').toISOString(), '2026-11-01T20:03:21.000Z');
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
  ].join('\n\n');
  const worktrees = parseWorktrees(porcelain);
  assert.equal(worktrees.length, 11);
  assert.equal(worktrees[0].branch, 'main');
  assert.equal(worktrees[5].detached, true);
  assert.equal(worktrees[7].locked, true);
  const prs = new Map([
    ['gh-1-done', {number: 10, state: 'MERGED', headRefOid: 'a'.repeat(40)}],
    ['gh-2-moved', {number: 11, state: 'MERGED', headRefOid: 'b'.repeat(39) + '0'}],
    ['gh-3-closed', {number: 12, state: 'CLOSED', headRefOid: 'c'.repeat(40)}],
    ['gh-4-open', {number: 13, state: 'OPEN', headRefOid: 'd'.repeat(40)}],
    ['gh-6-locked', {number: 14, state: 'MERGED', headRefOid: '0'.repeat(40)}],
    ['gh-7-unknown', {number: 15, state: 'MERGED', headRefOid: '2'.repeat(40)}],
  ]);
  const dirty = new Map(worktrees.filter(worktree => !worktree.path.endsWith('/unknown')).map(worktree => [worktree.path, worktree.path.endsWith('/dirty') ? 2 : 0]));
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
  });
});

test('stopped containers outside the installed stacks and older than the window are reported', () => {
  const containers = [
    {ID: 'c1', Names: 'bunny-gh9-browser', Image: 'bunny-gh9:test', State: 'exited', Status: 'Exited (0) 3 days ago', CreatedAt: at(72)},
    {ID: 'c2', Names: 'bunny-gh9-fresh', Image: 'bunny-gh9:test', State: 'exited', Status: 'Exited (0) 2 hours ago', CreatedAt: at(2)},
    {ID: 'c3', Names: 'bunny-mac-personal-core-1', Image: 'abc', State: 'running', Status: 'Up 3 days', CreatedAt: at(72)},
    {ID: 'c4', Names: 'bunny-diagnostics-loki-1', Image: 'grafana/loki:3', State: 'exited', Status: 'Exited (255) 3 days ago', CreatedAt: at(72)},
    {ID: 'c5', Names: 'bunny-gh9-running', Image: 'bunny-gh9:test', State: 'running', Status: 'Up 3 days', CreatedAt: at(72)},
  ];
  assert.deepEqual(staleContainers(containers, now, 48).map(container => container.id), ['c1']);
  assert.deepEqual(staleContainers(containers, now, 1).map(container => container.id), ['c1', 'c2']);
});

test('images stay when referenced, qualified, third-party or recent', () => {
  const containers = [
    {Image: 'bunny-gh9:test'},
    {Image: '85c303e8df7ed6f43a11379c37cd4092d8c2276d06cd496d0c8f5ce70186358a'},
    {Image: 'bunny-review:latest'.replace(':latest', '')},
  ];
  const images = [
    {ID: 'aaaa111111111111', Repository: 'bunny-gh9', Tag: 'test', Size: '4GB', CreatedAt: at(72)},
    {ID: 'aaaa222222222222', Repository: 'bunny-gh9', Tag: 'core', Size: '2GB', CreatedAt: at(72)},
    {ID: '85c303e8df7ed6f43a11379c37cd4092d8c2276d06cd496d0c8f5ce70186358a', Repository: 'bunny-gh1354-codex', Tag: '00fa1c7b', Size: '2GB', CreatedAt: at(72)},
    {ID: 'aaaa333333333333', Repository: 'bunny-core', Tag: 'release-47de5cd44072', Size: '2GB', CreatedAt: at(72)},
    {ID: 'aaaa444444444444', Repository: 'grafana/loki', Tag: '3.7.9', Size: '100MB', CreatedAt: at(72)},
    {ID: 'aaaa555555555555', Repository: 'bunny-gh9', Tag: 'recent', Size: '2GB', CreatedAt: at(1)},
    {ID: 'aaaa666666666666', Repository: 'bunny-review', Tag: 'latest', Size: '2GB', CreatedAt: at(72)},
    {ID: 'aaaa777777777777', Repository: 'bunny-core', Tag: 'mac-f5438869', Size: '2GB', CreatedAt: at(72)},
  ];
  assert.deepEqual(staleImages(images, containers, now, 48).map(image => image.reference), ['bunny-gh9:core', 'bunny-core:mac-f5438869']);
});

test('dangling volumes of the installed stacks are kept', () => {
  assert.deepEqual(staleVolumes([{Name: 'acceptance-b7-archives'}, {Name: 'bunny-mac-personal_state'}, {Name: 'bunny-diagnostics_loki-data'}, {Name: 'bunny-gh1112-npm-cache'}]), ['acceptance-b7-archives', 'bunny-gh1112-npm-cache']);
});

test('the report names counts, verdicts and that nothing was removed', () => {
  const text = render({now: now.toISOString(), hours: 48, worktrees: [{path: '/repo/.local/worktrees/done', branch: 'gh-1-done', head: 'aaaaaaaa', verdict: 'removable: PR #10 merged at this head'}],
    docker: {containers: [{id: 'c1', name: 'bunny-gh9-browser', image: 'bunny-gh9:test', status: 'Exited (0) 3 days ago'}], images: [], volumes: ['acceptance-b7-archives'], usage: 'TYPE SIZE'}, notes: ['gh pr list failed']});
  for (const expected of ['Worktrees: 1', 'removable: PR #10', 'containers older than 48 h: 1', 'bunny-gh9-browser', 'images older than 48 h: 0', 'acceptance-b7-archives', 'Note: gh pr list failed', 'Nothing was removed']) assert.match(text, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(render({now: now.toISOString(), hours: 48, worktrees: [], docker: null, notes: []}), /Docker: unavailable/);
});
