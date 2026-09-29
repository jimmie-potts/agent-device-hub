// Same Hub CLI configuration, readiness and signal lifecycle, with a proof
// mount supplied only by this disposable verification entrypoint.
import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {createProofHandler} from '@jimmie-potts/app-verify';
import {runHubCli} from '../dist/cli-runner.js';

const proof = JSON.parse(await readFile(join(dirname(process.argv[3]), 'proof.json'), 'utf8'));
await runHubCli(process.argv.slice(2), createProofHandler(proof));
