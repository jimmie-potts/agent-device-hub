import sharp, { type Sharp } from 'sharp';
import { canonicalProfile, canonicalTransform, MediaError, type MediaLimits, type MediaProfile, type RenderedMedia, type Transform } from './contracts.js';
import { compositeGif, inspectGif } from './gif.js';
sharp.cache(false);
sharp.concurrency(1);

function format(bytes: Buffer): 'png' | 'jpeg' | 'gif' {
  if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString('ascii'))) return 'gif';
  throw new MediaError('unsupported');
}
function checkPng(bytes: Buffer) {
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset), type = bytes.toString('ascii', offset + 4, offset + 8);
    if (offset + length + 12 > bytes.length) throw new MediaError('invalid-input');
    if (type === 'acTL') throw new MediaError('unsupported');
    offset += length + 12;
    if (type === 'IEND') { if (offset !== bytes.length) throw new MediaError('invalid-input'); return; }
  }
  throw new MediaError('invalid-input');
}
export async function renderMedia(bytes: Buffer, requestedTransform: Transform, requestedProfile: MediaProfile, limits: MediaLimits): Promise<RenderedMedia> {
  const transform = canonicalTransform(requestedTransform), profile = canonicalProfile(requestedProfile);
  if (!bytes.length) throw new MediaError('invalid-input');
  if (bytes.length > limits.maxUploadBytes) throw new MediaError('upload-limit');
  try {
    const kind = format(bytes);
    if (kind === 'png') checkPng(bytes);
    const gif = kind === 'gif' ? inspectGif(bytes, limits, profile) : undefined;
    const image = gif ? undefined : sharp(bytes, { limitInputPixels: limits.maxSourcePixels, failOn: 'warning' });
    const metadata = await image?.metadata();
    if (metadata?.pages && metadata.pages !== 1) throw new MediaError('unsupported');
    const width = gif?.width ?? metadata!.width, height = gif?.height ?? metadata!.height;
    if (width * height > limits.maxSourcePixels) throw new MediaError('pixel-limit');
    const delays = gif ? gif.patches.map(p => p.delay) : [null];
    const result: RenderedMedia = { source: { format: kind, width, height, frameCount: delays.length, delaysMs: delays, durationMs: delays.some(d => d === null) ? null : delays.reduce<number>((a,b) => a + b!, 0) }, frames: [], warnings: [] };
    const effective = delays.map((d, frame) => {
      if (gif && (d === null || d === 0)) { result.warnings.push({ frame, code: d === null ? 'missing-delay' : 'zero-delay', effectiveDelayMs: 100 }); return 100; }
      return d;
    });
    if (effective.length > profile.maxFrames || effective.some(d => d !== null && (d < profile.minDelayMs || d > profile.maxDelayMs || (profile.uniformTiming && d !== effective[0])))) throw new MediaError('profile-limit');
    const [r,g,b] = transform.background;
    const finish = async (input: Sharp, delayMs: number | null) => {
      const rgb = await input.autoOrient().resize(64,64,{ fit: transform.fit === 'fit' ? 'contain' : 'cover', position: 'centre', kernel: transform.scaling === 'nearest' ? 'nearest' : 'lanczos3', background: {r,g,b,alpha:1} })
        .flatten({background:{r,g,b}}).toColourspace('srgb').removeAlpha().raw().toBuffer();
      if (rgb.length !== 12288) throw new MediaError('decode-failed');
      const preview = await sharp(rgb,{raw:{width:64,height:64,channels:3}}).png().toBuffer();
      result.frames.push({ rgb, preview, delayMs });
    };
    if (gif) {
      let index = 0;
      for (const canvas of compositeGif(bytes,gif)) await finish(sharp(canvas,{raw:{width,height,channels:4}}), effective[index++]!);
    } else await finish(image!,null);
    return result;
  } catch (error) {
    if (error instanceof MediaError) throw error;
    if (error instanceof Error && error.message.includes('pixel limit')) throw new MediaError('pixel-limit');
    throw new MediaError('invalid-input');
  }
}
