// Evidence claims change only through merge, and a downgrade without new evidence does not compile (Hub #1140).
import assert from 'node:assert/strict';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {absent, hold, merge, observed, transmitted, uncertain, type Evidence, type EvidenceLevel} from '../src/index.js';
import {it} from './support.js';

it('merge keeps the stronger claim in either order', () => {
  const levels = [absent(), transmitted(), uncertain(), observed()] as Evidence<EvidenceLevel>[];
  for (const [i, prev] of levels.entries()) {
    for (const [j, next] of levels.entries()) assert.equal(merge(prev, next).level, levels[Math.max(i, j)]?.level);
  }
});

it('an uncertain claim stays uncertain until observed evidence arrives', () => {
  const held: Evidence<'uncertain'> = merge(uncertain(), transmitted());
  assert.equal(held.level, 'uncertain');
  const confirmed: Evidence<'observed'> = merge(held, observed());
  assert.equal(confirmed.level, 'observed');
  const kept: Evidence<'transmitted'> = merge(transmitted(), absent());
  assert.equal(kept.level, 'transmitted');
});

it('a downgrade without new evidence is a type error', () => {
  // @ts-expect-error uncertain merged with transmitted is not a confident transmitted claim.
  const overclaim: Evidence<'transmitted'> = merge(uncertain(), transmitted());
  // @ts-expect-error uncertain merged with absent is not a confident absent claim.
  const nothingSent: Evidence<'absent'> = merge(uncertain(), absent());
  // @ts-expect-error an acknowledged transmission cannot be replaced by absent.
  const lost: Evidence<'transmitted'> = absent();
  // @ts-expect-error a claim cannot be forged without a level function.
  const forged: Evidence<'observed'> = {level: 'observed'};
  assert.deepEqual([overclaim.level, nothingSent.level, lost.level, forged.level], ['uncertain', 'uncertain', 'absent', 'observed']);
});

it('the #1126 F1 pre-fix refused-Stop shape fails to compile', () => {
  // The test runs from dist/tests; the fixture stays in the package source.
  const fixture = resolve(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/evidence/refused-stop-prefix.ts');
  const config = ts.getParsedCommandLineOfConfigFile(join(dirname(fixture), '../../../tsconfig.json'), {}, {...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined});
  assert.ok(config);
  const program = ts.createProgram([fixture], {...config.options, noEmit: true});
  const errors = ts.getPreEmitDiagnostics(program).filter(diagnostic => diagnostic.file?.fileName === fixture);
  assert.equal(errors.length, 1, errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
  assert.match(ts.flattenDiagnosticMessageText(errors[0]?.messageText, '\n'), /'Evidence<"absent">' is not assignable to type 'Evidence<"transmitted">'/);
});

it('a held claim changes only through merge and never drops', () => {
  const held = hold<'absent' | 'transmitted'>(absent());
  assert.equal(held.merge(transmitted()).level, 'transmitted');
  assert.equal(held.merge(absent()).level, 'transmitted');
  const forbidden = (): void => {
    // @ts-expect-error the held claim is read-only.
    held.claim = absent();
    // @ts-expect-error new evidence must stay within the held levels.
    held.merge(observed());
  };
  assert.equal(typeof forbidden, 'function');
});
