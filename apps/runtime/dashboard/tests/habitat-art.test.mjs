import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const accepted={"habitat-desk-entry.webp": "c57843a48504f6509b06b668c5adb50564d36370af79e0ce2e9f311dfea8181d", "bunnies-sleep-variants.png": "a123cfcee90f241c4cd25310dfadaadd2b9508440bb0d3713fe8cd427657de23", "work-platform.png": "0f03adf8c907c7d0949bb9c5119e8be7b559cd04dfc56958b1a60b1e37c5f2c9", "work-platform-front.png": "1d35b2048ee7d80cdb9e5b58a196a6d8405515886a07396780a73da577e4ad12"};
test('the four selected artwork files preserve the reviewed prototype bytes',async()=>{for(const [name,digest]of Object.entries(accepted))assert.equal(createHash('sha256').update(await readFile(new URL('../assets/habitat/'+name,import.meta.url))).digest('hex'),digest,name);});
