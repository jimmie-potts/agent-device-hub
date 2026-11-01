import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {stateDir} from './support.js';

const LAUNCHER = fileURLToPath(new URL('../../bin/codex-with-read.mjs', import.meta.url));

void test('the Mac launcher enrolls updated Codex bundles and preserves normal launch for another bundle', {skip: process.platform !== 'darwin'}, async context => {
  const root = await stateDir(context), bundle = join(root, 'Synthetic.app'), contents = join(bundle, 'Contents');
  const nativeDir = join(contents, 'Resources/codex-cli/bin'), appDir = join(contents, 'MacOS');
  await mkdir(nativeDir, {recursive: true}); await mkdir(appDir);
  const env = {...process.env};
  delete env.CODEX_CLI_PATH; delete env.CODEX_APP_SERVER_FORCE_CLI;
  delete env.BUNNY_CODEX_NATIVE; delete env.BUNNY_CODEX_RECEIPT_PRODUCER;
  await writeFile(join(appDir, 'Synthetic'), `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({
    observer: process.env.CODEX_CLI_PATH?.endsWith('/bin/codex-observer.mjs') ?? false,
    native: process.env.BUNNY_CODEX_NATIVE, producer: process.env.BUNNY_CODEX_RECEIPT_PRODUCER,
  }));\n`, {mode: 0o700});
  const producer = join(root, 'absent-producer.json');
  for (const [version, build, cli] of [['26.1027.30824', '22943', '0.166.0-alpha.5.1'],
    ['26.1027.51404', '23880', '0.166.0-alpha.5.1'], ['27.1.0', '30000', '1.0.0']]) {
    await writeFile(join(nativeDir, 'codex'), `#!/bin/sh\nprintf '%s\\n' 'codex-cli ${cli}'\n`, {mode: 0o700});
    for (const bundleId of ['com.openai.codex', 'example.unrelated']) {
      await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>
        <key>CFBundleIdentifier</key><string>${bundleId}</string>
        <key>CFBundleExecutable</key><string>Synthetic</string>
        <key>CFBundleShortVersionString</key><string>${version}</string>
        <key>CFBundleVersion</key><string>${build}</string></dict></plist>`);
      const selected = bundleId === 'com.openai.codex';
      const check = spawnSync(process.execPath, [LAUNCHER, '--check', bundle, producer], {env, encoding: 'utf8', timeout: 5000});
      assert.equal(check.status, selected ? 0 : 2);
      assert.deepEqual(JSON.parse(check.stdout), {status: selected ? 'observer-ready' : 'observer-unavailable', bundleId,
        desktop: version, build, native: selected ? `codex-cli ${cli}` : '', compatibility: 'checked-per-action', installedAcceptance: false});
      const launched = spawnSync(process.execPath, [LAUNCHER, bundle, producer], {env, encoding: 'utf8', timeout: 5000});
      assert.equal(launched.status, 0);
      assert.deepEqual(JSON.parse(launched.stdout), selected
        ? {observer: true, native: join(nativeDir, 'codex'), producer} : {observer: false});
    }
  }
});
