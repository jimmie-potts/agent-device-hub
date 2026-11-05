import assert from 'node:assert/strict';
import {test} from 'node:test';
import sharp from 'sharp';
import type {RainNotice} from '@jimmie-potts/event-contracts/v2/art-notice';
import {prepareArt} from '../src/art-media.js';
import {artNotice} from '../src/art-notice.js';
import {artStage,gifFrames} from './art-fixtures.js';

const notice:RainNotice={kind:'rain-forecast',likelihood:'chance',forecastStartAtMs:new Date(2030,0,1,14,0).getTime(),forecastEndAtMs:new Date(2030,0,1,15,0).getTime(),forecastUpdatedAtMs:1,observedAtMs:1,staleAtMs:1000,weatherRevision:1};
void test('native rain art preserves duplicates, frame delays and staged bytes while separating its factual band',async()=>{
 const stage=artStage(gifFrames([{index:1,delay:200},{index:1,delay:300},{index:2,delay:400}]),{frames:3,durationMs:900});
 const copy=await prepareArt(stage);assert.ok(copy.ok);const before=Buffer.from(copy.webp);
 const rendered=await artNotice(copy.webp,copy.delays,notice);assert.ok(rendered.ok);assert.deepEqual(copy.webp,before);
 const metadata=await sharp(rendered.webp,{animated:true}).metadata();assert.equal(metadata.pages,3);assert.deepEqual(metadata.delay,[200,300,400]);
 const pixels=await sharp(rendered.webp,{animated:true}).removeAlpha().raw().toBuffer();
 assert.deepEqual(pixels.subarray(0,6144),pixels.subarray(6144,12288));assert.notDeepEqual(pixels.subarray(0,6144),pixels.subarray(12288));
 assert.deepEqual([...pixels.subarray((8*64+32)*3,(8*64+32)*3+3)],[255,0,0]);
 assert.deepEqual([...pixels.subarray(12288+(8*64+32)*3,12288+(8*64+32)*3+3)],[0,0,255]);
 const likely=await artNotice(copy.webp,copy.delays,{...notice,likelihood:'likely'});assert.ok(likely.ok);
 const other=await sharp(likely.webp,{animated:true}).removeAlpha().raw().toBuffer();
 assert.deepEqual(pixels.subarray(0,26*64*3),other.subarray(0,26*64*3));assert.notDeepEqual(pixels.subarray(26*64*3,6144),other.subarray(26*64*3,6144));
 assert.deepEqual([...new Set(pixels.subarray(20*64*3,6144))].sort((a,b)=>a-b),[0,255]);
});
void test('native rain art refuses malformed or false retained animation metadata',async()=>{
 const copy=await prepareArt(artStage());assert.ok(copy.ok);
 assert.equal((await artNotice(copy.webp,[100,100],notice)).ok,false);
 assert.equal((await artNotice(new Uint8Array(200_000),[],notice)).ok,false);
 assert.equal((await artNotice(new Uint8Array([1,2,3]),[],notice)).ok,false);
});
