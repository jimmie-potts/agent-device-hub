import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assessHost, inspectDocker } from '../preflight.mjs';

const GiB = 1024 ** 3;
const host = () => ({ platform: 'linux', arch: 'x64', nodeVersion: '24.21.0',
  availableMemoryBytes: 12 * GiB, availableDiskBytes: 2 * GiB });

test('host capacity reserves eight GiB after the full stack allocation', () => {
  assert.equal(assessHost(host()).ready, true);
  for (const change of [{ availableMemoryBytes: 12 * GiB - 1 }, { availableDiskBytes: 2 * GiB - 1 },
    { platform: 'win32' }, { arch: 'arm64' }, { nodeVersion: '22.0.0' }, { availableMemoryBytes: null }]) {
    assert.equal(assessHost({ ...host(), ...change }).ready, false);
  }
});

test('remote Docker endpoints are rejected before any engine command', async () => {
  let calls = 0;
  const result = await inspectDocker({ DOCKER_HOST: 'ssh://SYNTHETIC_SECRET@example.invalid' },
    () => { calls++; throw Error('must not run'); });
  assert.equal(calls, 0);
  assert.equal(result.ready, false);
  assert.equal(result.code, 'nonlocal-docker-endpoint');
  assert.equal(JSON.stringify(result).includes('SYNTHETIC_SECRET'), false);
});

test('Docker context inspection precedes engine access and requires enforceable limits', async () => {
  const calls = [];
  const run = args => {
    calls.push(args);
    return { status: 0, stdout: JSON.stringify(args[0] === 'context'
      ? 'unix:///var/run/docker.sock'
      : { OSType: 'linux', Architecture: 'x86_64', CgroupVersion: '2', NCPU: 4,
        MemTotal: 8 * GiB, MemoryLimit: true, CpuCfsQuota: true }), stderr: '' };
  };
  assert.equal((await inspectDocker({}, run)).ready, true);
  assert.equal(calls[0][0], 'context');
  assert.equal(calls[1][0], 'info');
  const missingLimits = args => args[0] === 'context' ? run(args)
    : { status: 0, stdout: JSON.stringify({ OSType: 'linux', Architecture: 'x86_64', CgroupVersion: '2', NCPU: 4, MemTotal: 8 * GiB }) };
  assert.equal((await inspectDocker({}, missingLimits)).ready, false);
});

test('unavailable, malformed and remote contexts remain unqualified without echoing raw errors', async () => {
  for (const response of [{ status: 1, stderr: 'SYNTHETIC_SECRET' },
    { status: 0, stdout: 'SYNTHETIC_SECRET' },
    { status: 0, stdout: JSON.stringify('tcp://127.0.0.1:2375') }]) {
    const calls = [];
    const result = await inspectDocker({}, args => { calls.push(args); return response; });
    assert.equal(result.ready, false);
    assert.equal(calls.length, 1);
    assert.equal(JSON.stringify(result).includes('SYNTHETIC_SECRET'), false);
  }
});

test('CLI retains an unexecuted receipt and exits nonzero on a refused endpoint', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'bunny-preflight-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const command = new URL('../qualify.mjs', import.meta.url);
  const env = { ...process.env, DOCKER_HOST: 'ssh://SYNTHETIC_SECRET@example.invalid' };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [command.pathname, 'preflight', '--evidence-dir', directory],
    { env, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(await readFile(join(directory, 'preflight.json'), 'utf8'));
  assert.equal(report.qualification, 'unexecuted');
  assert.equal(report.docker.code, 'nonlocal-docker-endpoint');
  assert.equal(JSON.stringify(report).includes('SYNTHETIC_SECRET'), false);
  const second = spawnSync(process.execPath, [command.pathname, 'preflight', '--evidence-dir', directory],
    { env, encoding: 'utf8', timeout: 10_000 });
  assert.notEqual(second.status, 0);
  assert.equal(await readFile(join(directory, 'preflight.json'), 'utf8'), JSON.stringify(report, null, 2) + '\n');
});
