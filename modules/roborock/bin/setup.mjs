#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {createInterface} from 'node:readline/promises';
import {SdkError} from '@jimmie-potts/sdk';
import {setupSession} from '../dist/src/transport/account.js';
import {checkPrivateDestination, loadPrivateConfig, savePrivateSession} from '../dist/src/transport/private.js';

async function main() {
  const {values} = parseArgs({options: {config: {type: 'string'}, session: {type: 'string'}}, allowPositionals: false});
  if (typeof values.config !== 'string' || typeof values.session !== 'string' || process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
    process.stderr.write('Usage: run interactively with --config <absolute private config> --session <absolute private session>.\n');
    process.exitCode = 2; return;
  }
  const config = await loadPrivateConfig(values.config);
  await checkPrivateDestination(values.session, config);
  const prompt = createInterface({input: process.stdin, output: process.stdout});
  const controller = new AbortController();
  const interrupt = () => controller.abort(); process.once('SIGINT', interrupt);
  try {
    const email = await prompt.question('Account email: ', {signal: controller.signal});
    const session = await setupSession(config, {email, readCode: signal => prompt.question('Email code: ', {signal})}, {}, controller.signal);
    await savePrivateSession(values.session, session);
    process.stdout.write('Private session saved. No robot command was sent.\n');
  } finally {prompt.close(); process.removeListener('SIGINT', interrupt);}
}
try {await main();} catch (error) {
  // Print only fixed transport error detail, never parseArgs, fetch or filesystem exceptions.
  process.stderr.write(error instanceof SdkError ? `${error.body.error.code}: ${error.body.error.detail ?? 'Setup failed.'}\n` : 'Setup failed. Check the private target and try explicitly.\n');
  process.exitCode = 1;
}
