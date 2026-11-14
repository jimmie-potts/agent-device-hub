import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {apartmentSha256} from '../src/apartment/artwork.js';
import {activeApartmentDigest,publishApartment} from '../src/apartment/publish.js';
import {holdRuntimeLease} from '../src/lease.js';
import {createCoreModule} from '../src/core/core.js';
import {apartmentActiveFile,apartmentAssetFile,apartmentDirectory} from '../src/apartment/content.js';
import {edgeConfig,it,run,stateDir} from './support.js';
import {syntheticApartment,syntheticApartmentArtwork} from './fixtures/apartment.js';

const invoke = promisify(execFile);
const helper = fileURLToPath(new URL('../../bin/apartment.mjs',import.meta.url));

it('publishes under the existing lease, preserves prior usable versions and fences uncertain results', async context => {
  const state = await stateDir(context);
  const workspace = await mkdtemp(join(dirname(state),'bunny-apartment-input-'));
  context.after(() => rm(workspace,{recursive:true,force:true}));
  await mkdir(join(workspace,'assets'),{mode:0o700});
  const {bytes,image} = syntheticApartmentArtwork();
  const asset = join(workspace,'assets',image.id+'.png');
  await writeFile(asset,bytes,{mode:0o600});
  const model = syntheticApartment(image);
  const originalPath = join(workspace,'original.candidate.json');
  const original = JSON.stringify(model)+'\n';
  await writeFile(originalPath,original,{mode:0o600});
  const originalDigest = apartmentSha256(Buffer.from(original));
  await mkdir(join(state,'modules'),{mode:0o700});
  await assert.rejects(publishApartment({stateDir:state, candidate:originalPath, expected:null}),{code:'forbidden'});

  const lease = await holdRuntimeLease(state);
  try {
    await assert.rejects(publishApartment({stateDir:state,candidate:originalPath,expected:null}),{code:'unavailable'});
    await assert.rejects(invoke(process.execPath,[helper,'publish',state,'none',originalPath]),error =>
      typeof error === 'object' && error !== null && 'stderr' in error && typeof error.stderr === 'string'
        && JSON.parse(error.stderr).error.code === 'unavailable' && !error.stderr.includes(state));
    await assert.rejects(readFile(join(state,'modules','core','apartment','active.json')),{code:'ENOENT'});
  } finally { lease.release(); }
  assert.equal(await activeApartmentDigest(state),null);
  assert.deepEqual(await publishApartment({stateDir:state,candidate:originalPath,expected:null}),{digest:originalDigest,previous:null});

  const directory = apartmentDirectory(join(state,'modules','core'));
  assert.equal(await activeApartmentDigest(state),originalDigest);
  assert.deepEqual(await readFile(apartmentAssetFile(directory,image.id)),bytes);
  await assert.rejects(publishApartment({stateDir:state,candidate:originalPath,expected:null}),{code:'revision-conflict'});

  const corrected = structuredClone(model);
  const studio = corrected.rooms.find(room => room.id === 'studio');
  assert.ok(studio);
  studio.scan = {id:'corrected-survey',yaw:0,translation:[0,0,0]};
  studio.source = 'measured';
  const correctedFile = join(workspace,'corrected.candidate.json');
  const correctedBytes = Buffer.from(JSON.stringify(corrected)+'\n');
  await writeFile(correctedFile,correctedBytes,{mode:0o600});
  const correctedDigest = apartmentSha256(correctedBytes);

  await writeFile(asset,Buffer.from('invalid prepared artwork'));
  await assert.rejects(publishApartment({stateDir:state,candidate:correctedFile,expected:originalDigest}),{code:'invalid-request'});
  assert.equal(await activeApartmentDigest(state),originalDigest);
  await writeFile(asset,bytes);
  await rm(apartmentAssetFile(directory,image.id));
  await assert.rejects(publishApartment({stateDir:state,candidate:originalPath,expected:originalDigest}),{problem:'missing'});
  await writeFile(apartmentAssetFile(directory,image.id),bytes,{mode:0o600});

  const interrupted = new AbortController();
  await assert.rejects(publishApartment({stateDir:state,candidate:correctedFile,expected:originalDigest,signal:interrupted.signal},{
    beforeActivate:() => interrupted.abort(),
  }),{code:'cancelled'});
  assert.equal(await activeApartmentDigest(state),originalDigest);
  assert.equal(await readFile(apartmentActiveFile(directory),'utf8'),original);
  assert.equal(await readFile(join(directory,'versions',originalDigest+'.json'),'utf8'),original);

  await assert.rejects(publishApartment({stateDir:state,candidate:correctedFile,expected:originalDigest},{
    afterActivate:() => { throw new Error('stopped before receipt'); },
  }),{code:'uncertain-result'});
  assert.equal(await activeApartmentDigest(state),correctedDigest);
  assert.equal(JSON.parse((await invoke(process.execPath,[helper,'status',state])).stdout).digest,correctedDigest);
  await assert.rejects(publishApartment({stateDir:state,candidate:correctedFile,expected:originalDigest}),{code:'revision-conflict'});
  assert.deepEqual(await publishApartment({stateDir:state,candidate:correctedFile,expected:correctedDigest}),{digest:correctedDigest,previous:correctedDigest});
  assert.deepEqual(await readFile(asset),bytes);
  assert.equal(await readFile(originalPath,'utf8'),original);
  assert.deepEqual(await readFile(correctedFile),correctedBytes);

  const reader = {id:'apartment-publish-reader',source:'bunny/parts/apartment-publish-reader',token:'synthetic-reader-token',scopes:['read' as const]};
  const files = await edgeConfig(context,[reader]);
  const authorization = {headers:{authorization:'Bearer '+reader.token}};
  const module = () => createCoreModule();
  const {runtime:first} = await run(context,{modules:[module()],stateDir:state,configFile:files.config,edge:{schemas:{}}});
  const endpoint = '/modules/core/content/apartment-model';
  assert.deepEqual(await (await fetch(first.url+endpoint,authorization)).json(),corrected);
  await first.stop();
  const {runtime:second} = await run(context,{modules:[module()],stateDir:state,configFile:files.config,edge:{schemas:{}}});
  assert.deepEqual(await (await fetch(second.url+endpoint,authorization)).json(),corrected);
  const servedArtwork = await fetch(second.url+'/modules/core/content/apartment-art-'+image.id,authorization);
  assert.equal(servedArtwork.status,200);
  assert.deepEqual(Buffer.from(await servedArtwork.arrayBuffer()),bytes);
});

it('calibrates plan units and prepares an aligned correction without overwriting private inputs', async context => {
  const directory = await stateDir(context);
  const model = syntheticApartment();
  const draft = {...model,schema:'apartment-plan/1.0',calibration:{...model.calibration,planUnits:8}};
  const input = join(directory,'draft.json'), base = join(directory,'scaled.candidate.json');
  const original = JSON.stringify(draft);
  await writeFile(input,original,{mode:0o600});
  const preparedReceipt = JSON.parse((await invoke(process.execPath,[helper,'calibrate',input,base])).stdout);
  const preparedBytes = await readFile(base);
  assert.equal(preparedReceipt.digest,apartmentSha256(preparedBytes));
  const prepared = JSON.parse(preparedBytes.toString());
  assert.deepEqual(prepared.rooms[0].footprint,[[0,0],[2,0],[2,1.5],[0,1.5]]);
  await assert.rejects(invoke(process.execPath,[helper,'calibrate',base,join(directory,'double.candidate.json')]));
  await assert.rejects(invoke(process.execPath,[helper,'calibrate',input,base]));
  const room = {...prepared.rooms[0],scan:{id:'new-survey',yaw:0,translation:[0,0,0]},source:'measured'};
  const scan = join(directory,'scan.json'), candidate = join(directory,'refined.candidate.json');
  const scanText = JSON.stringify({schema:'apartment-scan/1.0',room});
  await writeFile(scan,scanText,{mode:0o600});
  await invoke(process.execPath,[helper,'replace-scan',base,scan,candidate]);
  const corrected = JSON.parse(await readFile(candidate,'utf8'));
  assert.deepEqual(corrected.rooms,[room,prepared.rooms[1]]);
  assert.deepEqual(corrected.objects,prepared.objects);
  assert.equal(await readFile(input,'utf8'),original);
  assert.equal(await readFile(scan,'utf8'),scanText);
  assert.deepEqual(await readFile(base),preparedBytes);
});
