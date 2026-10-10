// Exercise the actual manual command blocks on disposable byte fixtures.
// Store reopening, systemd ownership and installed acceptance have separate evidence.
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {chmod, link, mkdir, mkdtemp, readFile, readlink, readdir, rm, stat, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';

const run = promisify(execFile);
const digest = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
async function command(name: string): Promise<string> {
  const document = await readFile('apps/runtime/UPGRADE.md', 'utf8');
  const match = document.match(new RegExp('<!-- qualification: ' + name + ' -->\\s*```bash\\n([\\s\\S]*?)\\n```'));
  const block = match?.[1];
  assert.ok(typeof block === 'string' && block.length > 0, 'the owning manual procedure contains the named command block');
  return block;
}

void test('manual running checks bound observations and retain failed attempts without service replay', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-running-bound-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const bin = join(root, 'bin'); await mkdir(bin, {mode: 0o700});
  await writeFile(join(bin, 'node'), `#!/bin/bash
if [[ "$1" == --input-type=module ]]; then printf '2 1 0.1 synthetic'; exit 0; fi
printf 'observation\\n' >> "$BUNNY_TEST_TRACE"
case "$BUNNY_TEST_MODE" in
  fail) exit 2 ;;
  timeout) /usr/bin/sleep 5; printf 'unexpected late completion\\n' >> "$BUNNY_TEST_TRACE"; exit 0 ;;
  retry) if [[ "$(/usr/bin/wc -l < "$BUNNY_TEST_TRACE")" -lt 2 ]]; then exit 2; fi ;;
esac
printf '{"verified":true}\\n'
`, {mode: 0o700});
  const block = await command('verify-running');
  const execute = async (mode: string, installation: string, trace: string) => run('bash', ['--noprofile', '--norc', '-c', block], {
    timeout: 6000, cwd: process.cwd(), env: {...process.env, PATH: bin + ':' + (process.env.PATH ?? ''),
      BUNNY_CHECK_PHASE: 'candidate', BUNNY_REQUEST_FILE: 'synthetic-request', BUNNY_PLAN_FILE: 'synthetic-plan',
      BUNNY_INSTALL_ROOT: installation, BUNNY_TEST_MODE: mode, BUNNY_TEST_TRACE: trace},
  });
  for (const mode of ['good', 'retry', 'fail', 'timeout']) {
    await t.test(mode, async () => {
      const installation = join(root, mode), trace = join(root, mode + '.trace');
      await mkdir(join(installation, 'provenance'), {recursive: true, mode: 0o700});
      if (mode === 'good' || mode === 'retry') await execute(mode, installation, trace);
      else await assert.rejects(execute(mode, installation, trace));
      const attempts = (await readFile(trace, 'utf8')).trim().split('\n');
      assert.deepEqual(attempts, Array.from({length: mode === 'good' ? 1 : 2}, () => 'observation'));
      const evidence = join(installation, 'provenance/running-synthetic-candidate');
      if (mode === 'fail' || mode === 'timeout') {
        for (const attempt of [1, 2]) {
          const code = (await readFile(join(evidence, 'attempt-' + attempt + '.exit'), 'utf8')).trim();
          if (mode === 'fail') assert.equal(code, '2');
          else assert.ok(['124', '137'].includes(code), 'the timeout retains its nonzero timeout or kill result');
        }
      }
      const before = [...await readdir(evidence)].sort();
      await assert.rejects(execute(mode, installation, trace));
      assert.deepEqual([...await readdir(evidence)].sort(), before);
      assert.deepEqual((await readFile(trace, 'utf8')).trim().split('\n'), attempts);
    });
  }
});

void test('manual stopped backup preserves complete synthetic bytes and refuses unsafe or reused destinations', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-upgrade-procedure-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const state = join(root, 'state'), modules = join(state, 'modules'), config = join(root, 'runtime.json');
  const original = join(modules, 'pixoo', 'media', 'originals', 'synthetic-original');
  await mkdir(join(modules, 'pixoo', 'media', 'originals'), {recursive: true, mode: 0o700});
  const expected = new Map<string, Buffer>([
    ['modules/core.sqlite', Buffer.from('synthetic database bytes')],
    ['modules/core.sqlite-wal', Buffer.from('synthetic newest WAL bytes')],
    ['modules/core.sqlite-shm', Buffer.from('synthetic sidecar bytes')],
    ['modules/core.sqlite-owner', Buffer.from('synthetic lease bytes')],
    ['modules/pixoo/media/originals/synthetic-original', Buffer.from('synthetic permanent original')],
    ['spans.ndjson', Buffer.from('synthetic retained diagnostic observation\n')],
  ]);
  for (const [name, bytes] of expected) await writeFile(join(state, name), bytes, {mode: 0o600});
  await link(original, join(modules, 'pixoo', 'retained-reference'));
  await writeFile(config, '{"synthetic":true}\n', {mode: 0o600});
  // This server owns only the disposable socket, never the module files.
  // The backup must omit this actual transient Unix socket.
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject); socket.listen(join(state, 'bunny-launch.sock'), resolve);
  });
  t.after(() => new Promise<void>((resolve, reject) => socket.close(error => {
    if (error !== undefined) reject(error); else resolve();
  })));
  const block = await command('stopped-backup');
  const backup = join(root, 'backup');
  const backupAt = (directory: string, environment: NodeJS.ProcessEnv = {}) => run('bash', ['--noprofile', '--norc', '-c', block], {
    cwd: process.cwd(), timeout: 10000,
    env: {...process.env, ...environment, BUNNY_STATE_DIRECTORY: state, BUNNY_CONFIG_FILE: config, BUNNY_BACKUP_DIRECTORY: directory},
  });
  await backupAt(backup);
  for (const [name, bytes] of expected) assert.deepEqual(await readFile(join(backup, 'state', name)), bytes);
  assert.deepEqual(await readFile(join(backup, 'runtime.json')), await readFile(config));
  assert.ok(!(await readdir(join(backup, 'state'))).includes('bunny-launch.sock'));
  const archive = await readFile(join(backup, 'backup.tar'));
  assert.equal((await readFile(join(backup, 'backup.sha256'), 'utf8')).split(' ')[0], digest(archive));
  const extracted = join(root, 'extracted'); await mkdir(extracted, {mode: 0o700});
  await run('tar', ['--extract', '--file=' + join(backup, 'backup.tar'), '--directory=' + extracted]);
  for (const [name, bytes] of expected) assert.deepEqual(await readFile(join(extracted, 'state', name)), bytes);

  await t.test('inherited tar options cannot rename retained backup entries', async () => {
    const destination = join(root, 'inherited-options');
    await backupAt(destination, {TAR_OPTIONS: '--transform=s,^state,renamed-state,'});
    const extraction = join(root, 'inherited-extracted');
    await mkdir(extraction, {mode: 0o700});
    await run('tar', ['--extract', '--file=' + join(destination, 'backup.tar'), '--directory=' + extraction],
      {env: {...process.env, TAR_OPTIONS: ''}});
    for (const [name, bytes] of expected) assert.deepEqual(await readFile(join(extraction, 'state', name)), bytes);
  });

  await t.test('an existing backup is retained and never overwritten', async () => {
    await assert.rejects(backupAt(backup));
    assert.deepEqual(await readFile(join(backup, 'backup.tar')), archive);
  });
  await t.test('a linked backup destination refuses without touching its target', async () => {
    const alias = join(root, 'backup-alias'); await symlink(backup, alias);
    await assert.rejects(backupAt(alias));
    assert.deepEqual(await readFile(join(backup, 'backup.tar')), archive);
  });
  await t.test('an external link in the module tree refuses before copying state', async () => {
    const alias = join(modules, 'external'); await symlink(config, alias);
    const destination = join(root, 'unsafe-link');
    await assert.rejects(backupAt(destination));
    assert.deepEqual(await readdir(join(destination, 'state')), []);
    await rm(alias);
  });
  await t.test('unsupported objects and public state refuse before copying', async () => {
    const fifo = join(modules, 'unexpected-pipe'); await run('mkfifo', ['-m', '600', fifo]);
    await assert.rejects(backupAt(join(root, 'unsafe-object'))); await rm(fifo);
    await chmod(original, 0o644);
    await assert.rejects(backupAt(join(root, 'unsafe-mode'))); await chmod(original, 0o600);
  });
});

void test('manual selection adopts the anchor, recovers on latest bytes and refuses foreign or non-link targets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-upgrade-selection-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const old = join(root, 'releases', 'a'.repeat(40)), next = join(root, 'releases', 'b'.repeat(40));
  await mkdir(old, {recursive: true, mode: 0o700}); await mkdir(next, {mode: 0o700});
  const state = join(root, 'latest-state'); await writeFile(state, 'baseline', {mode: 0o600});
  const block = await command('select-release');
  const select = (directory: string) => run('bash', ['-euo', 'pipefail', '-c', block], {
    cwd: process.cwd(), timeout: 10000,
    env: {...process.env, BUNNY_INSTALL_ROOT: root, BUNNY_SELECTION_DIRECTORY: directory},
  });
  await select(old); assert.equal(await readlink(join(root, 'current')), old);
  await select(next); assert.equal(await readlink(join(root, 'current')), next);
  await writeFile(state, 'candidate-written latest state', {mode: 0o600});
  await select(old); assert.equal(await readlink(join(root, 'current')), old);
  assert.equal(await readFile(state, 'utf8'), 'candidate-written latest state');
  await select(next); assert.equal(await readlink(join(root, 'current')), next);
  assert.equal(await readFile(state, 'utf8'), 'candidate-written latest state');
  await t.test('unknown or missing release refuses without changing the anchor', async () => {
    for (const target of [root, join(root, 'legacy', 'legacy-' + 'c'.repeat(64)), join(root, 'releases', 'c'.repeat(40))]) {
      await assert.rejects(select(target)); assert.equal(await readlink(join(root, 'current')), next);
    }
  });
  await t.test('an unexpected regular anchor is preserved', async () => {
    await rm(join(root, 'current')); await writeFile(join(root, 'current'), 'unrelated anchor', {mode: 0o600});
    await assert.rejects(select(old)); assert.equal(await readFile(join(root, 'current'), 'utf8'), 'unrelated anchor');
  });
});

void test('a failed selection synchronization can leave the candidate selected and requires inspection', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-selection-interrupted-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const old = join(root, 'releases', 'a'.repeat(40)), next = join(root, 'releases', 'b'.repeat(40));
  await mkdir(old, {recursive: true, mode: 0o700}); await mkdir(next, {mode: 0o700});
  await symlink(old, join(root, 'current'));
  const state = join(root, 'latest-state'); await writeFile(state, 'latest retained state', {mode: 0o600});
  const preload = join(root, 'selection-sync-fault.mjs');
  await writeFile(preload, `import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const original = fs.promises.open;
fs.promises.open = async (...args) => {
  const handle = await original(...args);
  if (args[0] === process.env.BUNNY_INSTALL_ROOT && args[1] === 'r') {
    handle.sync = async () => { throw new Error('synthetic selection directory sync refusal'); };
  }
  return handle;
};
syncBuiltinESMExports();
`, {mode: 0o600});
  const block = await command('select-release');
  const env = {...process.env, BUNNY_INSTALL_ROOT: root, BUNNY_SELECTION_DIRECTORY: next};
  await assert.rejects(run('bash', ['--noprofile', '--norc', '-c', block], {
    cwd: process.cwd(), timeout: 10000, env: {...env, NODE_OPTIONS: '--import=' + preload},
  }), (error: unknown) => {
    assert.match((error as {stderr: string}).stderr, /synthetic selection directory sync refusal/);
    return true;
  });
  assert.equal(await readlink(join(root, 'current')), next, 'a nonzero selection does not prove it failed before replacement');
  assert.equal(await readFile(state, 'utf8'), 'latest retained state');
  assert.ok(!(await readdir(root)).some(name => name.startsWith('current.next-')));
  // After inspecting the failed operation, one explicitly selected recovery uses latest state.
  await run('bash', ['--noprofile', '--norc', '-c', block], {
    cwd: process.cwd(), timeout: 10000, env: {...env, BUNNY_SELECTION_DIRECTORY: old},
  });
  assert.equal(await readlink(join(root, 'current')), old);
  assert.equal(await readFile(state, 'utf8'), 'latest retained state');
});

void test('adoption draft preserves the complete observed invocation and creates only a private proposal', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-adoption-draft-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'provenance'), {mode: 0o700});
  const entry = join(root, 'direct/apps/runtime/dist/src/main.js');
  const argv = [process.execPath, entry, '--port', '8788', '--state-dir', join(root, 'state'),
    '--config', join(root, 'config.json'), '--edge', '--environment', 'production'];
  const destination = join(root, 'provenance', 'anchor.conf');
  const plannedArgv = [...argv]; plannedArgv[1] = join(root, 'current/apps/runtime/dist/src/main.js');
  const plannedBytes = '[Service]\nWorkingDirectory=' + join(root, 'current') + '\nExecStart=\nExecStart=' + plannedArgv.join(' ') + '\n';
  const body = {schema: 'runtime-upgrade-plan/1.0', eligibility: 'eligible-under-coordinator-admission', operation: 'adoption',
    paths: {directories: [{path: root}], adoptionDraftSha256: digest(Buffer.from(plannedBytes))},
    execution: {adoption: {draftFile: destination}}, owner: {executable: process.execPath, entry, argv}};
  const planFile = join(root, 'provenance', 'synthetic-plan.json');
  const seal = async (value: object): Promise<void> => {
    const result = await run(process.execPath, ['--input-type=module', '-e',
      'import {canonical,sha256} from "./apps/hub/dist/install/files.js";const body=JSON.parse(process.argv[1]);process.stdout.write(JSON.stringify({...body,planSha256:sha256(canonical(body))}));', JSON.stringify(value)], {cwd: process.cwd()});
    await writeFile(planFile, result.stdout, {mode: 0o600});
  };
  await seal(body);
  const block = await command('draft-adoption');
  const draftAt = (destination: string) => run('bash', ['-euo', 'pipefail', '-c', block], {
    cwd: process.cwd(), timeout: 10000,
    env: {...process.env, BUNNY_PLAN_FILE: planFile, BUNNY_INSTALL_ROOT: root, BUNNY_DRAFT_OVERRIDE: destination},
  });
  await draftAt(destination);
  const selected = [...argv]; selected[1] = join(root, 'current/apps/runtime/dist/src/main.js');
  const bytes = await readFile(destination, 'utf8');
  assert.equal(bytes, '[Service]\nWorkingDirectory=' + join(root, 'current') + '\nExecStart=\nExecStart=' + selected.join(' ') + '\n');
  assert.equal((await stat(destination)).mode & 0o777, 0o600);
  assert.deepEqual((await readdir(root)).sort(), ['provenance']);
  await t.test('an existing draft refuses and preserves its reviewed bytes', async () => {
    await assert.rejects(draftAt(destination)); assert.equal(await readFile(destination, 'utf8'), bytes);
  });
  await t.test('a changed or non-adoption frame refuses without creating a proposal', async () => {
    const current = JSON.parse(await readFile(planFile, 'utf8')) as {operation: string};
    await writeFile(planFile, JSON.stringify({...current, operation: 'upgrade'}), {mode: 0o600});
    await assert.rejects(draftAt(join(root, 'provenance', 'changed.conf')));
    await seal({...body, operation: 'upgrade'});
    await assert.rejects(draftAt(join(root, 'provenance', 'upgrade.conf')));
    await seal(body);
  });
  await t.test('systemd substitution or quoting characters refuse rather than change arguments', async () => {
    for (const value of ['%h/state', '$HOME/state', '/private path/state', '/private\nstate']) {
      const changed = [...argv]; changed[5] = value;
      const unsafe = join(root, 'provenance', 'unsafe.conf');
      await seal({...body, execution: {adoption: {draftFile: unsafe}}, owner: {...body.owner, argv: changed}});
      await assert.rejects(draftAt(unsafe));
    }
    await seal(body);
  });
  await t.test('proposal paths outside the private provenance directory refuse', async () => {
    await assert.rejects(draftAt(join(root, 'not-provenance.conf')));
    assert.deepEqual((await readdir(root)).sort(), ['provenance']);
  });
});


void test('manual exit check refuses a live writer, active service and populated cgroup before backup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-stopped-writer-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const bin = join(root, 'bin'), cgroup = join(root, 'owned-cgroup');
  await mkdir(bin, {mode: 0o700}); await mkdir(cgroup, {mode: 0o700});
  // This fixture shadows systemctl only in the disposable command environment.
  // It accepts the two exact read-only queries and cannot call the host manager.
  await writeFile(join(bin, 'systemctl'), `#!/bin/bash
set -eu
if test "$*" = '--user show --value --property=MainPID bunny-runtime.service'; then
  printf '%s\\n' "$FIXTURE_MAIN_PID"
elif test "$*" = '--user show --value --property=ActiveState bunny-runtime.service'; then
  printf '%s\\n' "$FIXTURE_ACTIVE_STATE"
else
  exit 91
fi
`, {mode: 0o700});
  // Refuse accidental use of an optional search tool even on hosts where it exists.
  await writeFile(join(bin, 'rg'), '#!/bin/bash\nexit 127\n', {mode: 0o700});
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {stdio: 'ignore'});
  assert.ok(child.pid !== undefined);
  await once(child, 'exit');
  const block = await command('stopped-writer');
  const check = (options: {pid?: number; mainPid?: string; active?: string} = {}) => run('bash', ['--noprofile', '--norc', '-c', block], {
    timeout: 3000,
    env: {...process.env, PATH: bin + ':' + (process.env.PATH ?? ''), BUNNY_OLD_PID: String(options.pid ?? child.pid),
      BUNNY_OLD_CGROUP: cgroup, FIXTURE_MAIN_PID: options.mainPid ?? '0', FIXTURE_ACTIVE_STATE: options.active ?? 'inactive'},
  });
  await writeFile(join(cgroup, 'cgroup.events'), 'populated 0\n', {mode: 0o600});
  await t.test('the recorded PID still exists despite inactive service status', async () => {
    await assert.rejects(check({pid: process.pid}));
  });
  await t.test('a reported main owner or active service refuses', async () => {
    await assert.rejects(check({mainPid: String(process.pid)}));
    await assert.rejects(check({active: 'active'}));
  });
  await t.test('descendants still populate the recorded cgroup', async () => {
    await writeFile(join(cgroup, 'cgroup.events'), 'populated 1\n', {mode: 0o600});
    await assert.rejects(check());
  });
  await t.test('missing cgroup evidence refuses while the directory remains', async () => {
    await rm(join(cgroup, 'cgroup.events')); await assert.rejects(check());
  });
  await t.test('exited owner and empty or removed cgroup satisfy only this exit check', async () => {
    await writeFile(join(cgroup, 'cgroup.events'), 'populated 0\n', {mode: 0o600}); await check();
    await rm(cgroup, {recursive: true}); await check();
  });
});

void test('release recipes propagate every failed step in an ordinary operator shell', async t => {
  for (const name of ['release-extract']) {
    const block = await command(name);
    const count = 3;
    for (let failure = 1; failure <= count; failure++) {
      await t.test(`${name} stops at failed step ${failure}`, async () => {
        const stub = `calls=0
step() { calls=$((calls + 1)); printf 'step=%s\\n' "$calls"; if [ "$calls" -eq ${failure} ]; then return 19; fi; return 0; }
git() { step; }
fnm() { step; }
node() { step; }
test() { step; }
`;
        await assert.rejects(run('bash', ['--noprofile', '--norc', '-c', stub + block], {
          cwd: process.cwd(), timeout: 10000,
          env: {...process.env, BUNNY_SOURCE_REVISION: 'a'.repeat(40),
            BUNNY_IDENTITY_FILE: 'synthetic', BUNNY_RELEASE_DIRECTORY: 'synthetic',
            BUNNY_ARCHIVE_FILE: 'synthetic', BUNNY_EXTRACT_DIRECTORY: 'synthetic'},
        }), (error: unknown) => {
          const result = error as {code?: number; stdout?: string};
          assert.equal(result.code, 19);
          assert.equal(result.stdout?.trim().split('\n').at(-1), `step=${failure}`);
          return true;
        });
      });
    }
  }
});

void test('first adoption stops before later effects when an override or startup step fails', async t => {
  const root = await mkdtemp(join(tmpdir(), 'bunny-adoption-propagation-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const block = await command('adoption-install');
  const names = ['directory', 'copy', 'compare', 'sync', 'reload', 'start'];
  for (const failure of names) {
    await t.test(`failure at ${failure} stops the exact adoption block`, async () => {
      const trace = join(root, failure + '.trace');
      const override = join(root, failure + '.conf');
      const stub = `step() { printf '%s\\n' "$1" >> "$BUNNY_TEST_TRACE"; [ "$1" != "$BUNNY_TEST_FAILURE" ]; }
mkdir() { step directory; }
cat() { step copy; }
cmp() { step compare; }
sync() { step sync; }
systemctl() { if [ "$2" = daemon-reload ]; then step reload; else step start; fi; }
`;
      await assert.rejects(run('bash', ['--noprofile', '--norc', '-c', stub + block], {
        cwd: process.cwd(), timeout: 10000,
        env: {...process.env, BUNNY_TEST_TRACE: trace, BUNNY_TEST_FAILURE: failure,
          BUNNY_UNIT_OVERRIDE_DIRECTORY: join(root, 'synthetic-unit-directory'),
          BUNNY_UNIT_OVERRIDE_FILE: override, BUNNY_DRAFT_OVERRIDE: 'synthetic-draft'},
      }));
      assert.deepEqual((await readFile(trace, 'utf8')).trim().split('\n'),
        names.slice(0, names.indexOf(failure) + 1));
    });
  }
});
