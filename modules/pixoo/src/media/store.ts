import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { canonicalLimits, canonicalProfile, canonicalTransform, DEFAULT_TRANSFORM, MediaError, RENDERER_VERSION, SIMULATOR_PROFILE,
  type MediaLimits, type MediaProfile, type Rendition, type Transform } from './contracts.js';
import { runWorker, signalError } from './worker-client.js';
const hash = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const validHash = (s: string) => /^[a-f0-9]{64}$/.test(s);
const code = (e: unknown) => (e as NodeJS.ErrnoException)?.code;
export function renditionId(sourceHash: string, transform: Transform, profile: MediaProfile): string {
  return hash(JSON.stringify({sourceHash,transform:canonicalTransform(transform),renderer:RENDERER_VERSION,profile:canonicalProfile(profile)}));
}
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void pending.catch(()=>{}); return Promise.reject(signalError(signal)); }
  return new Promise((resolve,reject) => {
    const abort = () => { reject(signalError(signal)); };
    signal.addEventListener('abort',abort,{once:true});
    pending.then(resolve,reject).finally(() => signal.removeEventListener('abort',abort));
  });
}
async function storageRoot(directory: string): Promise<string> {
  if (!isAbsolute(directory)) throw new MediaError('storage-error');
  // Check real ancestors before creating anything, including symlink aliases into Git.
  let ancestor = directory;
  while (true) {
    try { ancestor = await realpath(ancestor); break; } catch (e) { if (code(e) !== 'ENOENT') throw e; }
    const parent = dirname(ancestor); if (parent === ancestor) throw new MediaError('storage-error'); ancestor = parent;
  }
  for (let p = ancestor;; p = dirname(p)) {
    try {
      const marker=join(p,'.git'), info=await stat(marker);
      if(info.isFile() && (await readFile(marker,'utf8')).startsWith('gitdir: ')) throw new MediaError('storage-error');
      if(info.isDirectory()) { await stat(join(marker,'HEAD')); throw new MediaError('storage-error'); }
    } catch (e) { if (code(e) !== 'ENOENT') throw e; }
    if (p === dirname(p)) break;
  }
  await mkdir(directory,{recursive:true,mode:0o700});
  const root = await realpath(directory);
  for (const name of ['originals','renditions','staging']) {
    const path = join(root,name); await mkdir(path,{recursive:true,mode:0o700});
    if (!(await lstat(path)).isDirectory()) throw new MediaError('storage-error');
  }
  return root;
}
interface Waiting { signal: AbortSignal; start(): void; abort: () => void }
export class MediaStore {
  private readonly limits: MediaLimits;
  private readonly directory: string;
  private root: Promise<string> | undefined;
  private active = 0;
  private readonly queue: Waiting[] = [];
  constructor(options: {directory:string;limits?:Partial<MediaLimits>}) { this.directory=options.directory; this.limits=canonicalLimits(options.limits); }
  private getRoot() { return this.root ??= storageRoot(this.directory); }
  async initialize(): Promise<void> { await this.getRoot(); }
  async getRendition(id:string): Promise<Rendition> {
    const root=await this.getRoot(), rendition=await this.load(root,id,false);
    await this.verifyOriginal(root,rendition.sourceHash);
    return rendition;
  }
  async readFrames(id:string,signal?:AbortSignal):Promise<{rendition:Rendition;frames:Buffer[]}> {
    const check=()=>{if(signal?.aborted===true)throw new MediaError('cancelled');};
    check();
    const rendition=await this.getRendition(id),root=await this.getRoot(),frames:Buffer[]=[];
    try {
      for(const frame of rendition.frames){
        check();
        const bytes=await readFile(join(root,'renditions',id,`${frame.index}.rgb`));
        if(hash(bytes)!==frame.rgbHash)throw new MediaError('cache-corrupt');
        frames.push(bytes);
      }
      check();
      return {rendition,frames};
    }catch(error){if(error instanceof MediaError)throw error;throw new MediaError('cache-corrupt');}
  }
  private acquire(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(signalError(signal));
    if (this.active < this.limits.concurrency) { this.active++; return Promise.resolve(); }
    if (this.queue.length >= this.limits.maxQueued) return Promise.reject(new MediaError('busy'));
    return new Promise((resolve,reject) => {
      const waiting: Waiting = { signal, start:() => { signal.removeEventListener('abort',waiting.abort); this.active++; resolve(); },
        abort:() => { const i=this.queue.indexOf(waiting); if(i>=0) this.queue.splice(i,1); reject(signalError(signal)); } };
      this.queue.push(waiting); signal.addEventListener('abort',waiting.abort,{once:true});
    });
  }
  private release() { this.active--; this.queue.shift()?.start(); }
  async render(input: AsyncIterable<Uint8Array>, options: {transform?:Transform;profile?:MediaProfile;signal?:AbortSignal} = {}): Promise<Rendition> {
    const transform=canonicalTransform(options.transform ?? DEFAULT_TRANSFORM), profile=canonicalProfile(options.profile ?? SIMULATOR_PROFILE);
    const signal=AbortSignal.any([AbortSignal.timeout(this.limits.timeoutMs), ...(options.signal ? [options.signal] : [])]);
    await this.acquire(signal);
    let staging: string | undefined;
    try {
      const root=await this.getRoot();
      if(signal.aborted) throw signalError(signal);
      staging=await mkdtemp(join(root,'staging','request-'));
      const inputPath=join(staging,'original'), output=join(staging,'rendition');
      await mkdir(output);
      const file=await open(inputPath,'wx',0o600), digest=createHash('sha256'); let total=0;
      const iterator=input[Symbol.asyncIterator]();
      try {
        while(true) {
          if(signal.aborted) throw signalError(signal);
          const next=await abortable(iterator.next(),signal); if(next.done===true) break;
          if(!(next.value instanceof Uint8Array)) throw new MediaError('invalid-input');
          total+=next.value.byteLength; if(total>this.limits.maxUploadBytes) throw new MediaError('upload-limit');
          // Copy producer-owned chunks before an asynchronous write.
          const chunk=Buffer.from(next.value); digest.update(chunk); await file.writeFile(chunk);
        }
      } finally { await file.close(); void iterator.return?.().catch(()=>{}); }
      if(signal.aborted) throw signalError(signal);
      if(total===0) throw new MediaError('invalid-input');
      const sourceHash=digest.digest('hex'), id=renditionId(sourceHash,transform,profile);
      const existing=await this.load(root,id,true);
      if(existing) {
        if(existing.source.width * existing.source.height * existing.source.frameCount > this.limits.maxSourcePixels) throw new MediaError('pixel-limit');
        await this.verifyOriginal(root,sourceHash);
        if(signal.aborted) throw signalError(signal);
        return existing;
      }
      await runWorker({input:inputPath,output,sourceHash,id,transform,profile,limits:this.limits},signal);
      if(signal.aborted) throw signalError(signal);
      try { await link(inputPath,join(root,'originals',sourceHash)); }
      catch(e) { if(code(e)!=='EEXIST') throw e; await this.verifyOriginal(root,sourceHash); }
      try { await rename(output,join(root,'renditions',id)); }
      catch(e) { if(!['EEXIST','ENOTEMPTY','EPERM'].includes(code(e) ?? '')) throw e; }
      const published=await this.load(root,id,false);
      if(signal.aborted) throw signalError(signal);
      return published;
    } catch(error) { if(error instanceof MediaError) throw error; throw new MediaError('storage-error'); }
    finally { try { if(staging!==undefined) await rm(staging,{recursive:true,force:true}); } finally { this.release(); } }
  }
  private async verifyOriginal(root:string,sourceHash:string) {
    const path=join(root,'originals',sourceHash);
    try { const info=await lstat(path); if(!info.isFile() || info.size>this.limits.maxUploadBytes || hash(await readFile(path))!==sourceHash) throw new Error(); }
    catch { throw new MediaError('cache-corrupt'); }
  }
  private load(root:string,id:string,optional:false,verifyFrames?:boolean): Promise<Rendition>;
  private load(root:string,id:string,optional:boolean,verifyFrames?:boolean): Promise<Rendition | undefined>;
  private async load(root:string,id:string,optional:boolean,verifyFrames=true): Promise<Rendition | undefined> {
    if(!validHash(id)) throw new MediaError('invalid-input');
    const path=join(root,'renditions',id);
    try {
      if(!(await lstat(path)).isDirectory()) throw new Error();
      const manifestPath=join(path,'manifest.json'); if(!(await lstat(manifestPath)).isFile() || (await stat(manifestPath)).size>1024*1024) throw new Error();
      const m=JSON.parse(await readFile(manifestPath,'utf8')) as Rendition;
      if(m.id!==id || !validHash(m.sourceHash) || m.renderer!==RENDERER_VERSION || renditionId(m.sourceHash,m.transform,m.profile)!==id || !Array.isArray(m.frames) || m.frames.length===0 || m.frames.length>m.profile.maxFrames || m.source.frameCount!==m.frames.length) throw new Error();
      if(!['png','jpeg','gif'].includes(m.source.format) || !Number.isSafeInteger(m.source.width) || m.source.width<1 || !Number.isSafeInteger(m.source.height) || m.source.height<1 ||
        !Array.isArray(m.source.delaysMs) || m.source.delaysMs.length!==m.frames.length || !Array.isArray(m.warnings)) throw new Error();
      const expectedWarnings=[];
      let sourceTotal:number|null=0, effectiveTotal:number|null=0;
      for(const [i,f] of m.frames.entries()) {
        if(f.index!==i || !(f.delayMs===null || Number.isSafeInteger(f.delayMs) && f.delayMs>0)) throw new Error();
        const sourceDelay=m.source.delaysMs[i];
        if(sourceDelay===undefined || !(sourceDelay===null || Number.isSafeInteger(sourceDelay) && sourceDelay>=0)) throw new Error();
        if(m.source.format==='gif') {
          const effective=sourceDelay===null || sourceDelay===0 ? 100 : sourceDelay;
          if(f.delayMs!==effective || effective<m.profile.minDelayMs || effective>m.profile.maxDelayMs || (m.profile.uniformTiming && effective!==m.frames[0]?.delayMs)) throw new Error();
          if(sourceDelay===null || sourceDelay===0) expectedWarnings.push({frame:i,code:sourceDelay===null?'missing-delay':'zero-delay',effectiveDelayMs:100});
        } else if(m.frames.length!==1 || sourceDelay!==null || f.delayMs!==null) throw new Error();
        sourceTotal=sourceTotal===null || sourceDelay===null ? null : sourceTotal+sourceDelay;
        effectiveTotal=effectiveTotal===null || f.delayMs===null ? null : effectiveTotal+f.delayMs;
        for(const [ext,digest] of [['rgb',f.rgbHash],['png',f.previewHash]] as const) {
          if(!validHash(digest))throw new Error();
          if(!verifyFrames)continue;
          const file=join(path,`${i}.${ext}`), info=await lstat(file);
          if(!info.isFile() || info.size>65536 || (ext==='rgb' && info.size!==12288) || hash(await readFile(file))!==digest) throw new Error();
        }
      }
      if(sourceTotal!==m.source.durationMs || effectiveTotal!==m.effectiveDurationMs || JSON.stringify(expectedWarnings)!==JSON.stringify(m.warnings)) throw new Error();
      return m;
    } catch(e) {
      if(optional && code(e)==='ENOENT') {
        // Only a wholly absent rendition is a miss. Incomplete existing directories are corrupt.
        try { await lstat(path); } catch(missing) { if(code(missing)==='ENOENT') return undefined; }
      }
      throw new MediaError('cache-corrupt');
    }
  }
  /** Read only the requested immutable representation, not every frame in the animation. */
  async readPreview(expected:Rendition,index:number|null,signal?:AbortSignal):Promise<{rendition:Rendition;bytes?:Buffer}>{
    if(index!==null&&(!Number.isSafeInteger(index)||index<0||index>=expected.frames.length))throw new MediaError('invalid-input');
    const check=()=>{if(signal?.aborted===true)throw signalError(signal);};
    check();
    try {
      if(!validHash(expected.id)||renditionId(expected.sourceHash,expected.transform,expected.profile)!==expected.id)throw new MediaError('cache-corrupt');
      const root=await this.getRoot(),path=join(root,'renditions',expected.id);check();
      const rendition=await this.load(root,expected.id,false,false);
      if(JSON.stringify(rendition)!==JSON.stringify(expected))throw new MediaError('cache-corrupt');
      check();if(index===null)return {rendition};
      const framePath=join(path,`${index}.png`),frameInfo=await lstat(framePath);
      if(!frameInfo.isFile()||frameInfo.size>65536)throw new MediaError('cache-corrupt');
      const bytes=await readFile(framePath,signal?{signal}:undefined);check();
      if(hash(bytes)!==rendition.frames[index]?.previewHash)throw new MediaError('cache-corrupt');
      return {rendition,bytes};
    }catch(error){check();if(error instanceof MediaError)throw error;throw new MediaError('cache-corrupt');}
  }
  async readFrame(id:string,index:number,format:'rgb'|'png'): Promise<Buffer> {
    if(!Number.isSafeInteger(index) || index<0 || !['rgb','png'].includes(format)) throw new MediaError('invalid-input');
    const root=await this.getRoot(), m=await this.load(root,id,false);
    if(index>=m.frames.length) throw new MediaError('invalid-input');
    return readFile(join(root,'renditions',id,`${index}.${format}`));
  }
}
