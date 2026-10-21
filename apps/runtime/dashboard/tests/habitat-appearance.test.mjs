import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAppearance} from '../src/habitat/appearance.js';
const appearance=createAppearance();
const {palette,colorsFrom,tintPixels}=appearance;
test('ten stable resident colors recover independently from incomplete or malformed saved data',()=>{
 assert.equal(new Set(palette.map(p=>p[1])).size,10);
 assert.deepEqual(colorsFrom('broken'),palette.map(p=>p[1]));
 const colors=colorsFrom(JSON.stringify({'0':'#123ABC','1':'not-a-color','9':'#FFCC00'}));
 assert.equal(colors[0],'#123abc');assert.equal(colors[1],palette[1][1]);assert.equal(colors[9],'#ffcc00');
 assert.equal(colorsFrom('null').length,10);
});
test('palette swaps preserve fur, outlines, transparency, and apron shading',()=>{
 const source=new Uint8ClampedArray([80,95,38,255,40,50,19,255,248,222,164,255,40,25,12,255,0,0,0,0]);
 const tinted=tintPixels(source,'#4488ee');
 assert.notDeepEqual([...tinted.slice(0,3)],[...source.slice(0,3)]);
 assert(tinted[2]>tinted[0]);assert(tinted[2]>tinted[6]);
 assert.deepEqual(tinted.slice(8),source.slice(8));
 for(let i=3;i<source.length;i+=4)assert.equal(tinted[i],source[i]);
 assert.throws(()=>tintPixels(source,'red'),TypeError);
});
