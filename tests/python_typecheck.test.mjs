import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'node_modules/pyright/index.js');

test('the pinned Python gate rejects argument and return errors in its included tooling', () => {
  const scratch = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'bunny-python-types-')));
  try {
    cpSync(path.join(root, 'pyrightconfig.json'), path.join(scratch, 'pyrightconfig.json'));
    cpSync(path.join(root, 'docs/skins'), path.join(scratch, 'docs/skins'), {
      recursive: true,
      filter: source => !source.includes('__pycache__'),
    });
    const run = () => {
      const result = spawnSync(process.execPath, [cli, '--warnings', '--outputjson'], {
        cwd: scratch, encoding: 'utf8', timeout: 30_000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.signal, null);
      return { status: result.status, report: JSON.parse(result.stdout) };
    };
    const clean = run();
    assert.equal(clean.status, 0);
    assert.equal(clean.report.summary.filesAnalyzed, 3);
    assert.equal(clean.report.summary.errorCount, 0);

    const consumer = path.join(scratch, 'docs/skins/test_places.py');
    const originalConsumer = readFileSync(consumer, 'utf8');
    writeFileSync(consumer, `${originalConsumer}\nskin.places_strip(7, Path('page.html'))\n`);
    const argument = run();
    assert.equal(argument.status, 1);
    assert.ok(argument.report.generalDiagnostics.some(item =>
      item.file === consumer && item.rule === 'reportArgumentType'), JSON.stringify(argument.report));
    writeFileSync(consumer, originalConsumer);

    const generator = path.join(scratch, 'docs/skins/skin.py');
    const originalGenerator = readFileSync(generator, 'utf8');
    const signature = 'def stylesheet() -> str:\n';
    assert.ok(originalGenerator.includes(signature));
    writeFileSync(generator, originalGenerator.replace(signature, `${signature}    return 7\n`));
    const returned = run();
    assert.equal(returned.status, 1);
    assert.ok(returned.report.generalDiagnostics.some(item =>
      item.file === generator && item.rule === 'reportReturnType'), JSON.stringify(returned.report));
    writeFileSync(generator, originalGenerator);

    const restored = run();
    assert.equal(restored.status, 0);
    assert.equal(restored.report.summary.filesAnalyzed, 3);
    assert.equal(restored.report.summary.errorCount, 0);
    assert.equal(restored.report.summary.warningCount, 0);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
