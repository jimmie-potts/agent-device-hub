import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'dashboard-routes-'));
try {
 await build({entryPoints:['apps/dashboard/src/routes.ts'],bundle:true,platform:'node',format:'esm',outfile:join(dir,'routes.mjs')});
 const {parseRoute,routeHash,sameRoute,homeRoute}=await import(join(dir,'routes.mjs'));
 test('the home answers to an empty hash and its aliases',()=>{
  for(const hash of ['','#','#/','#/home','#/activity'])assert.deepEqual(parseRoute(hash),homeRoute,hash);
  assert.equal(routeHash(homeRoute),'#/');
 });
 test('built-in pages and components are distinct kinds, so an alias named like a page opens only that component',()=>{
  assert.deepEqual(parseRoute('#/connections'),{kind:'connections'});
  assert.deepEqual(parseRoute('#/component/connections'),{kind:'component',id:'connections'});
  assert.deepEqual(parseRoute('#/component/activity'),{kind:'component',id:'activity'});
  assert.equal(sameRoute(parseRoute('#/component/activity'),homeRoute),false);
  assert.equal(sameRoute(parseRoute('#/component/connections'),{kind:'connections'}),false);
  assert.deepEqual(parseRoute('#/music/ht-a9'),{kind:'playback',sourceId:'ht-a9'});
 });
 test('hashes round-trip through the canonical form, including encoded aliases',()=>{
  for(const route of [{kind:'component',id:'wall'},{kind:'component',id:'living room/lamp'},{kind:'playback',sourceId:'ht-a9'},{kind:'connections'}])assert.deepEqual(parseRoute(routeHash(route)),route);
  assert.equal(routeHash({kind:'component',id:'living room/lamp'}),'#/component/living%20room%2Flamp');
 });
 test('a hash that is not a route is reported as missing rather than guessed',()=>{
  for(const hash of ['#launch=abc','#/component','#/component/','#/component/a/b','#/music','#/other','#connections'])assert.deepEqual(parseRoute(hash),{kind:'missing',hash},hash);
  assert.equal(routeHash({kind:'missing',hash:'#/other'}),'#/other');
 });
} finally {await rm(dir,{recursive:true,force:true});}
