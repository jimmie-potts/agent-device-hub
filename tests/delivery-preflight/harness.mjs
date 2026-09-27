// Runs representative preflight scenarios inside Node's permission model, where
// file writes and child processes are denied. The parent test grants only file
// reads, so any write, installation or runtime command would fail the run.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createReadOnlyClient } from '../../scripts/delivery-preflight/github.mjs';
import { runPreflight } from '../../scripts/delivery-preflight/preflight.mjs';
import {
  BASE, GUIDE_HTML, HEAD, cleanWorld, comment, declaration, fakeTransport, guideRecordBody,
} from './world.mjs';

const [proof, guideReceipt] = process.argv.slice(2);
const now = () => new Date('2026-09-27T08:00:00Z');
const run = (world, overrides) => runPreflight({ github: createReadOnlyClient(fakeTransport(world)), declaration: declaration(overrides), now });

const outcomes = {};
outcomes.clean = (await run(cleanWorld(), { receipts: [proof] })).result;

const guide = cleanWorld();
guide.files = [{ filename: 'docs/work-guide/outputs/agent-device-work-guides.html', status: 'modified' }];
guide.compares[`${BASE}...${HEAD}`].files = guide.files;
guide.checkRuns[HEAD] = [];
guide.checkSuites[HEAD] = [];
guide.blobs[`${HEAD}:docs/work-guide/outputs/agent-device-work-guides.html`] = GUIDE_HTML;
const record = comment(guideRecordBody(HEAD, { html: GUIDE_HTML }));
guide.comments.push(record);
outcomes.guideOnly = (await run(guide, { guideReceipts: [guideReceipt], guideRecords: [record.html_url] })).result;

outcomes.physical = (await run(cleanWorld(), { receipts: [proof], finishLine: 'physical' })).result;
const down = cleanWorld();
down.failures.push({ match: /./ });
outcomes.unavailable = (await run(down)).result;

// Negative controls: the sandbox must actually deny what the preflight never does.
try {
  fs.writeFileSync(path.join(os.tmpdir(), 'delivery-preflight-write-probe'), 'x');
  outcomes.writeAttempt = 'allowed';
} catch (error) {
  outcomes.writeAttempt = error.code;
}
try {
  const result = spawnSync('true');
  outcomes.spawnAttempt = result.error ? result.error.code : 'allowed';
} catch (error) {
  outcomes.spawnAttempt = error.code;
}

process.stdout.write(`${JSON.stringify(outcomes)}\n`);
