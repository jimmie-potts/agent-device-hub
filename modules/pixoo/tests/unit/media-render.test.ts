import { describe, expect, it } from 'vitest';
import { renderMedia } from '../../src/media/render.js';
import { DEFAULT_TRANSFORM, SIMULATOR_PROFILE, DEFAULT_LIMITS, type RenderedMedia } from '../../src/media/contracts.js';
import { gifFixture } from '../helpers/media-fixtures.js';
import sharp from 'sharp';
import { PIXOO64_SMOKE_PROFILE } from '../../src/media/contracts.js';

const render = (b: Buffer) => renderMedia(b, DEFAULT_TRANSFORM, SIMULATOR_PROFILE, DEFAULT_LIMITS);
const pixel = (b: Uint8Array, x: number, y: number) => [...b.slice((y * 64 + x) * 3, (y * 64 + x) * 3 + 3)];
/** The rendered frame at an index; a missing frame fails the test. */
const frame = (r: RenderedMedia, index: number) => r.frames[index] ?? expect.unreachable(`no frame ${index}`);
describe('GIF source composition', () => {
  it('retains control metadata across multiple comment extensions before an image', async () => {
    const original=gifFixture(1,1,[{width:1,height:1,pixels:[1],delay:4},{width:1,height:1,pixels:[0],transparent:true,delay:20}]);
    const lastImage=original.lastIndexOf(0x2c);
    const bytes=Buffer.concat([original.subarray(0,lastImage),Buffer.from([0x21,0xfe,1,65,0,0x21,0xfe,1,66,0]),original.subarray(lastImage)]);
    const r=await render(bytes);
    expect(r.source.delaysMs).toEqual([40,200]);
    expect(pixel(frame(r,0).rgb,0,0)).toEqual([255,0,0]);
    expect(pixel(frame(r,1).rgb,0,0)).toEqual([255,0,0]);
    const oracle=await sharp(bytes,{animated:true}).removeAlpha().raw().toBuffer();
    expect([...oracle]).toEqual([255,0,0,255,0,0]);
  });
  it('composites transparent patches, disposal background and previous with distinct timing', async () => {
    const bytes = gifFixture(2, 2, [
      { width: 2, height: 2, pixels: [1,1,1,1], delay: 4, transparent: true },
      { width: 1, height: 1, pixels: [2], delay: 20, disposal: 3, transparent: true },
      { x: 1, width: 1, height: 1, pixels: [3], delay: 0, disposal: 2, transparent: true },
      { x: 1, y: 1, width: 1, height: 1, pixels: [0], delay: null, transparent: true },
    ]);
    const result = await render(bytes);
    expect(result.source.delaysMs).toEqual([40,200,0,null]);
    expect(result.frames.map(f => f.delayMs)).toEqual([40,200,100,100]);
    expect(result.warnings.map(w => w.frame)).toEqual([2,3]);
    expect(pixel(frame(result,1).rgb, 0, 0)).toEqual([0,255,0]);
    expect(pixel(frame(result,2).rgb, 0, 0)).toEqual([255,0,0]);
    expect(pixel(frame(result,2).rgb, 63, 0)).toEqual([0,0,255]);
    expect(pixel(frame(result,3).rgb, 63, 0)).toEqual([0,0,0]);
    // The final frame has no GCE, so palette index zero is opaque black.
    expect(pixel(frame(result,3).rgb, 63, 63)).toEqual([0,0,0]);
  });
});

describe('rendering limits and effective previews', () => {
  it('preserves transparent patch pixels and interlaced row order', async () => {
    const rows = Array.from({length: 8}, (_, y) => y % 3 + 1);
    const bytes = gifFixture(1,8,[{width:1,height:8,pixels:rows,interlaced:true},{width:1,height:8,pixels:Array<number>(8).fill(0),transparent:true}]);
    const result = await render(bytes);
    expect(frame(result,0).rgb).toEqual(frame(result,1).rgb);
    expect(pixel(frame(result,0).rgb,32,0)).toEqual([255,0,0]);
    expect(pixel(frame(result,0).rgb,32,8)).toEqual([0,255,0]);
    expect(pixel(frame(result,0).rgb,32,16)).toEqual([0,0,255]);
  });
  it('keeps single-frame GIF identity and a positive 10ms delay', async () => {
    const r = await render(gifFixture(1,1,[{width:1,height:1,pixels:[1],delay:1}]));
    expect(r.source).toMatchObject({format:'gif',frameCount:1,delaysMs:[10],durationMs:10});
    expect(frame(r,0).delayMs).toBe(10); expect(r.warnings).toEqual([]);
  });
  it('rejects damaged streams, truncated containers and unsupported blocks', async () => {
    const valid = gifFixture(1,1,[{width:1,height:1,pixels:[1]}]);
    await expect(render(valid.subarray(0,-1))).rejects.toMatchObject({code:'invalid-input'});
    const badLzw = Buffer.from(valid); badLzw[badLzw.length - 5] = 0; badLzw[badLzw.length - 4] = 0;
    await expect(render(badLzw)).rejects.toMatchObject({code:'invalid-input'});
    await expect(render(gifFixture(1,1,[{width:1,height:1,pixels:[1],disposal:4}]))).rejects.toMatchObject({code:'unsupported'});
    await expect(render(gifFixture(1,1,[{width:2,height:1,pixels:[1,1]}]))).rejects.toMatchObject({code:'invalid-input'});
    await expect(render(Buffer.from('<svg/>'))).rejects.toMatchObject({code:'unsupported'});
  });
  it('counts complete source canvases across frames before decompression', async () => {
    const b = gifFixture(100,100,[{width:1,height:1,pixels:[1]},{width:1,height:1,pixels:[2]}]);
    await expect(renderMedia(b,DEFAULT_TRANSFORM,SIMULATOR_PROFILE,{...DEFAULT_LIMITS,maxSourcePixels:19999})).rejects.toMatchObject({code:'pixel-limit'});
    await expect(renderMedia(b,DEFAULT_TRANSFORM,{...SIMULATOR_PROFILE,maxFrames:1},DEFAULT_LIMITS)).rejects.toMatchObject({code:'profile-limit'});
    await expect(renderMedia(b,DEFAULT_TRANSFORM,PIXOO64_SMOKE_PROFILE,DEFAULT_LIMITS)).rejects.toMatchObject({code:'profile-limit'});
  });
  it('accepts only the narrow recorded physical profile without changing timing', async () => {
    const b = gifFixture(1,1,[{width:1,height:1,pixels:[1],delay:50},{width:1,height:1,pixels:[2],delay:50}]);
    const r = await renderMedia(b,DEFAULT_TRANSFORM,PIXOO64_SMOKE_PROFILE,DEFAULT_LIMITS);
    expect(r.frames.map(f=>f.delayMs)).toEqual([500,500]);
    await expect(renderMedia(b,DEFAULT_TRANSFORM,{...PIXOO64_SMOKE_PROFILE,maxFrames:100},DEFAULT_LIMITS)).rejects.toMatchObject({code:'invalid-input'});
  });
  it('applies JPEG orientation before fit and keeps image duration separate', async () => {
    const jpeg = await sharp({create:{width:4,height:2,channels:3,background:'red'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    const r = await render(jpeg);
    expect(r.source).toMatchObject({format:'jpeg',width:4,height:2,delaysMs:[null],durationMs:null});
    expect(pixel(frame(r,0).rgb,0,32)).toEqual([0,0,0]);
    expect(pixel(frame(r,0).rgb,32,0)[0]).toBeGreaterThan(240);
  });
  it('fits with explicit padding, crops centrally, flattens alpha and encodes exact previews', async () => {
    const png = await sharp({create:{width:4,height:2,channels:4,background:{r:255,g:0,b:0,alpha:0.5}}}).png().toBuffer();
    const r = await renderMedia(png,{fit:'fit',scaling:'nearest',background:[0,0,255]},SIMULATOR_PROFILE,DEFAULT_LIMITS);
    expect(pixel(frame(r,0).rgb,0,0)).toEqual([0,0,255]);
    expect(pixel(frame(r,0).rgb,32,32)).toEqual([128,0,127]);
    const preview = await sharp(frame(r,0).preview).removeAlpha().raw().toBuffer();
    expect(preview).toEqual(frame(r,0).rgb);
    const cropped = await renderMedia(png,{fit:'crop',scaling:'smooth',background:[0,0,255]},SIMULATOR_PROFILE,DEFAULT_LIMITS);
    expect(pixel(frame(cropped,0).rgb,0,0)).toEqual(pixel(frame(cropped,0).rgb,32,32));
  });
  it('decodes normally compressed GIF dictionary growth against sharp', async () => {
    const pixels = Buffer.from(Array.from({length:64*64*3},(_,i)=> (i*19+Math.floor(i/32)*43)%256));
    const gif = await sharp(pixels,{raw:{width:64,height:64,channels:3}}).gif().toBuffer();
    const r = await render(gif);
    const oracle = await sharp(gif).removeAlpha().raw().toBuffer();
    expect(frame(r,0).rgb).toEqual(oracle);
  });
  it('center-crops colored columns and distinguishes smooth interpolation from nearest', async () => {
    const raw=Buffer.from([255,0,0, 0,255,0, 0,0,255, 255,0,0, 255,0,0, 0,255,0, 0,0,255, 255,0,0]);
    const png=await sharp(raw,{raw:{width:4,height:2,channels:3}}).png().toBuffer();
    const crop=await renderMedia(png,{...DEFAULT_TRANSFORM,fit:'crop'},SIMULATOR_PROFILE,DEFAULT_LIMITS);
    expect(pixel(frame(crop,0).rgb,0,32)).toEqual([0,255,0]);
    expect(pixel(frame(crop,0).rgb,63,32)).toEqual([0,0,255]);
    const smooth=await renderMedia(png,{...DEFAULT_TRANSFORM,fit:'crop',scaling:'smooth'},SIMULATOR_PROFILE,DEFAULT_LIMITS);
    expect(frame(smooth,0).rgb).not.toEqual(frame(crop,0).rgb);
  });
  it('rejects PNG/JPEG pixel excess and damaged or animated PNG before rendering', async () => {
    const png=await sharp({create:{width:4,height:4,channels:3,background:'red'}}).png().toBuffer();
    const jpeg=await sharp(png).jpeg().toBuffer();
    for(const b of [png,jpeg]) await expect(renderMedia(b,DEFAULT_TRANSFORM,SIMULATOR_PROFILE,{...DEFAULT_LIMITS,maxSourcePixels:15})).rejects.toMatchObject({code:'pixel-limit'});
    await expect(render(png.subarray(0,-5))).rejects.toMatchObject({code:'invalid-input'});
    const chunk=Buffer.alloc(20); chunk.writeUInt32BE(8); chunk.write('acTL',4);
    await expect(render(Buffer.concat([png.subarray(0,33),chunk,png.subarray(33)]))).rejects.toMatchObject({code:'unsupported'});
  });
});

it('admits all 500 frames and rejects 501 without truncation or duration caps',async()=>{
 const frames=Array.from({length:500},(_,i)=>({width:1,height:1,pixels:[i%4],delay:i===499?65535:10+i}));
 const admitted=await render(gifFixture(1,1,frames));
 expect(admitted.frames).toHaveLength(500);expect(admitted.frames.map(f=>f.delayMs)).toEqual(frames.map(f=>f.delay*10));
 await expect(render(gifFixture(1,1,[...frames,...frames.slice(0,1)]))).rejects.toMatchObject({code:'profile-limit'});
});
describe('a GIF that declares a huge canvas', () => {
  /** A 43-byte GIF: a `side` x `side` logical screen with one 1x1 image, which a decoder would composite on a full canvas. */
  const declared = (side: number): Buffer => {
    const screen = Buffer.alloc(7);
    screen.writeUInt16LE(side, 0);
    screen.writeUInt16LE(side, 2);
    screen[4] = 0x80;
    const image = Buffer.alloc(10);
    image[0] = 0x2c;
    image.writeUInt16LE(1, 5);
    image.writeUInt16LE(1, 7);
    return Buffer.concat([Buffer.from('GIF89a', 'ascii'), screen, Buffer.from([0, 0, 0, 255, 255, 255]), Buffer.from([0x21, 0xf9, 4, 0, 10, 0, 0, 0]), image,
      Buffer.from([2, 2, 0x4c, 0x01, 0]), Buffer.from([0x3b])]);
  };
  it('is refused by its declared canvas, before any decoding, above 4096 x 4096 pixels', async () => {
    expect(DEFAULT_LIMITS.maxGifCanvasPixels).toBe(4096 * 4096);
    // 7000 x 7000 is within the 50-megapixel source limit, but its canvases would take about 440 MiB outside the heap.
    await expect(render(declared(7000))).rejects.toMatchObject({code: 'pixel-limit'});
    await expect(render(declared(4097))).rejects.toMatchObject({code: 'pixel-limit'});
    await expect(renderMedia(declared(64), DEFAULT_TRANSFORM, SIMULATOR_PROFILE, {...DEFAULT_LIMITS, maxGifCanvasPixels: 4095})).rejects.toMatchObject({code: 'pixel-limit'});
    expect((await render(declared(64))).frames).toHaveLength(1);
  });
});
