import {open, rm} from 'node:fs/promises';
import {basename, dirname, isAbsolute, resolve} from 'node:path';
import {errorBody} from '@jimmie-potts/event-contracts/v2';
import {MAX_APARTMENT_BYTES} from '../dist/src/apartment-model.js';
import {apartmentSha256} from '../dist/src/apartment/artwork.js';
import {ApartmentRefusal, apartmentErrorCode, readApartmentDocument, readApartmentJson, requireApartmentDirectory} from '../dist/src/apartment/content.js';
import {calibrateApartmentPlan, parseApartmentScan, replaceApartmentScan} from '../dist/src/apartment/prepare.js';
import {activeApartmentDigest, publishApartment} from '../dist/src/apartment/publish.js';
import {abortOnSignals} from '../dist/src/signals.js';
import {checkStateDirectory, readPrivateFile} from '../dist/src/state.js';

const usage = [
  'node apps/runtime/bin/apartment.mjs calibrate ABSOLUTE_DRAFT ABSOLUTE_OUTPUT',
  'node apps/runtime/bin/apartment.mjs replace-scan ABSOLUTE_MODEL ABSOLUTE_SCAN ABSOLUTE_OUTPUT',
  'node apps/runtime/bin/apartment.mjs status ABSOLUTE_STATE',
  'node apps/runtime/bin/apartment.mjs publish ABSOLUTE_STATE EXPECTED_ACTIVE_OR_none ABSOLUTE_MODEL',
].join('\n');

async function writeCandidate(file, model) {
  if (!isAbsolute(file) || !basename(file).endsWith('.candidate.json')) {
    throw new ApartmentRefusal('invalid-request','Use an absolute output path ending in .candidate.json.');
  }
  const path = resolve(file);
  const parent = await checkStateDirectory(dirname(path));
  await requireApartmentDirectory(parent);
  const bytes = Buffer.from(JSON.stringify(model) + '\n');
  if (bytes.length > MAX_APARTMENT_BYTES) throw new ApartmentRefusal('too-large');
  const handle = await open(path,'wx',0o600).catch(error => {
    if (error?.code === 'EEXIST') throw new ApartmentRefusal('revision-conflict','Select a new output file.');
    throw error;
  });
  try {
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally { await handle.close(); }
  } catch (error) {
    await rm(path,{force:true}).catch(() => {});
    throw error;
  }
  return {digest:apartmentSha256(bytes)};
}

async function main([operation,...args]) {
  if (operation === 'status' && args.length === 1) return {digest:await activeApartmentDigest(args[0])};
  if (operation === 'publish' && args.length === 3) {
    return publishApartment({stateDir:args[0],expected:args[1] === 'none' ? null : args[1],candidate:args[2],signal:abortOnSignals()});
  }
  if (operation === 'calibrate' && args.length === 2) {
    const draft = readApartmentJson(await readPrivateFile(args[0],MAX_APARTMENT_BYTES));
    return writeCandidate(args[1],calibrateApartmentPlan(draft));
  }
  if (operation === 'replace-scan' && args.length === 3) {
    const {model} = await readApartmentDocument(args[0]);
    const scan = parseApartmentScan(readApartmentJson(await readPrivateFile(args[1],MAX_APARTMENT_BYTES)));
    if (scan === undefined) throw new ApartmentRefusal('invalid-request','Invalid normalized room scan.');
    return writeCandidate(args[2],replaceApartmentScan(model,scan));
  }
  throw new ApartmentRefusal('invalid-request','Run apartment.mjs --help for usage.');
}

if (process.argv[2] === '--help' && process.argv.length === 3) console.log(usage);
else {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)))); }
  catch (error) {
    const detail = error instanceof ApartmentRefusal && error.message !== '' ? error.message : undefined;
    console.error(JSON.stringify(errorBody(apartmentErrorCode(error),detail === undefined ? {} : {detail})));
    process.exitCode = 1;
  }
}
