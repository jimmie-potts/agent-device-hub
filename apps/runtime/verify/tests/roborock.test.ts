import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCaptureStep } from '@jimmie-potts/app-verify';
import plugin from '../plugin.js';
import { base, startRun } from './support.js';
void test('Roborock catalog observations pass in the disposable shipped runtime', { timeout: 90000 }, async (context) => {
    const at = await base(context);
    const run = await startRun(context, at, 'roborock-observations');
    try {
        const result = await runCaptureStep(plugin, 'scenario-roborock-observations', {
            url: run.url, outputDir: join(at, 'proof'), scenario: 'roborock-observations',
            dataDir: run.dataDir, runtimeDir: run.runtimeDir, endpoints: { harness: run.harness },
        });
        assert.equal(result.outcome, 'passed', result.reason);
        const file = result.attachments.find(path => path.endsWith('scenario-result.json'));
        assert.ok(file !== undefined);
        const proof = JSON.parse(await readFile(file, 'utf8')) as {
            synthetic: boolean;
            physical: boolean;
            outcome: string;
            tier: string;
            problems: unknown[];
        };
        assert.deepEqual([proof.synthetic, proof.physical, proof.outcome, proof.tier, proof.problems], [true, false, 'passed', 'run', []]);
        assert.equal(run.stderr().includes('Synthetic private'), false);
    }
    finally {
        assert.equal((await run.stop()).code, 0, 'the owned disposable runtime stopped cleanly');
    }
});
