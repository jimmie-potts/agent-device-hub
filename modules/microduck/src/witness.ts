import {createHash} from 'node:crypto';
import {lstatSync, readFileSync, readlinkSync, readdirSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {VENDOR_IDENTITY} from './contracts.js';
import {Ajv2020} from 'ajv/dist/2020.js';
export const VENDOR = {
  revision:VENDOR_IDENTITY.revision,api:VENDOR_IDENTITY.apiVersion,version:VENDOR_IDENTITY.daemonVersion,
  binary:'/work/microduck/target/release/robotd',binaryHash:'4a69d80b1d9f25972fa54abba8527a4727407ff9f5aac07fd394b45447800697',
  python:'/opt/venv/bin/python',rl:'/work/microduck_rl/src',policy:'/work/policies/velstand.onnx',
  policyHash:'2fc7f8ee6acd7d0d3f66a99927b5d5a56589aeed02ec714de329b252d5ccf492',
} as const;
export const params = `[policy]\nenabled = true\nwalk = "${VENDOR.policy}"\nstand = "none"\nsitstand = "none"\nground_pick = "none"\nkick_left = "none"\nkick_right = "none"\nroulade = "none"\n[audio]\nenabled = false\ngreet = false\n[idle]\nenabled = false\n[pickup]\nenabled = false\n[chorale]\naccept = false\n[theremin]\nenabled = false\n[netpad]\nenabled = false\n`;
export type ProcessIdentity = {pid:number;start:string;argv:string[]};
export type Witness = {schema:'microduck-fixture/1';session:string;namespace:string;networkNamespace:string;pidNamespace:string;
  body:ProcessIdentity;daemon:ProcessIdentity;supervisor:ProcessIdentity;bodyListenerInode:number;socketInode:number;files:{path:string;sha256:string;size:number;mtimeMs:number;ctimeMs:number;ino:number}[]};
const id={type:'string',pattern:'^[a-f0-9-]{36}$'},integer={type:'integer',minimum:1,maximum:Number.MAX_SAFE_INTEGER};
const proc={type:'object',additionalProperties:false,required:['pid','start','argv'],properties:{pid:integer,start:{type:'string',pattern:'^[0-9]+$'},argv:{type:'array',minItems:1,maxItems:32,items:{type:'string',maxLength:1024}}}};
const check=new Ajv2020().compile<Witness>({type:'object',additionalProperties:false,required:['schema','session','namespace','networkNamespace','pidNamespace','body','daemon','supervisor','bodyListenerInode','socketInode','files'],properties:{
  schema:{const:'microduck-fixture/1'},session:id,namespace:{type:'string'},networkNamespace:{type:'string'},pidNamespace:{type:'string'},body:proc,daemon:proc,supervisor:proc,bodyListenerInode:integer,socketInode:integer,
  files:{type:'array',minItems:128,maxItems:160,items:{type:'object',additionalProperties:false,required:['path','sha256','size','mtimeMs','ctimeMs','ino'],properties:{path:{type:'string',maxLength:1024},sha256:{type:'string',pattern:'^[0-9a-f]{64}$'},size:{type:'integer',minimum:0,maximum:67108864},mtimeMs:{type:'number'},ctimeMs:{type:'number'},ino:integer}}},
}});
type Input={path:string;sha256:string;bytes:number};
const inputCheck=new Ajv2020().compile<Input[]>({type:'array',minItems:125,maxItems:125,items:{type:'object',additionalProperties:false,required:['path','sha256','bytes'],properties:{path:{type:'string',pattern:'^[a-zA-Z0-9_./-]+$'},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},bytes:{type:'integer',minimum:0}}}});
const document:unknown=JSON.parse(readFileSync(new URL('../../fixture/rl-inputs.json',import.meta.url),'utf8'));
if(!inputCheck(document)||createHash('sha256').update(JSON.stringify(document)).digest('hex')!=='b1f234c0ccf2fca85076850883149ac409599f678c4c43ee76162b8ab43cf011')throw new Error('MicroDuck input manifest is invalid');
const inputs=document;
export const digest=(value:string|Buffer):string=>createHash('sha256').update(value).digest('hex');
export function processIdentity(pid:number):ProcessIdentity {
  const root=`/proc/${pid}`,s=readFileSync(join(root,'stat'),'utf8'),fields=s.slice(s.lastIndexOf(')')+2).split(' ');
  if(fields[0]==='Z'||fields[19]===undefined||statSync(root).uid!==process.getuid?.())throw new Error('MicroDuck process identity unavailable');
  return {pid,start:fields[19],argv:readFileSync(join(root,'cmdline'),'utf8').split('\0').filter(Boolean)};
}
export function pinnedFiles(root:string):{path:string;sha256:string}[] {
  return [{path:VENDOR.binary,sha256:VENDOR.binaryHash},{path:VENDOR.policy,sha256:VENDOR.policyHash},{path:join(root,'robotd.toml'),sha256:digest(params)},...inputs.map(x=>({path:join(VENDOR.rl,x.path),sha256:x.sha256}))];
}
export function fileEvidence(root:string):Witness['files'] {
  return pinnedFiles(root).map(input=>{
    const s=lstatSync(input.path);
    if(!s.isFile()||s.isSymbolicLink()||s.size>67108864||digest(readFileSync(input.path))!==input.sha256)throw new Error('MicroDuck pinned input mismatch');
    return {...input,size:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs,ino:s.ino};
  });
}
export function namespace(name:'time'|'net'|'pid',pid:'self'|number='self'):string {return readlinkSync(`/proc/${pid}/ns/${name}`);}
export function bodyListener(pid:number):number {
  const text=readFileSync('/proc/net/tcp','utf8');if(text.length>65536)throw new Error('MicroDuck listener inventory exceeded');
  const rows=text.split('\n').slice(1).map(line=>line.trim().split(/\s+/)).filter(fields=>fields[1]?.endsWith(':4589')===true&&fields[3]==='0A');
  if(rows.length!==1||rows[0]?.[1]!=='0100007F:4589')throw new Error('MicroDuck body listener is not exclusive loopback');
  const inode=Number(rows[0][9]);if(!Number.isSafeInteger(inode)||inode<1)throw new Error('MicroDuck listener identity unavailable');
  const owner=readdirSync(`/proc/${pid}/fd`).some(fd=>{try{return readlinkSync(`/proc/${pid}/fd/${fd}`)===`socket:[${inode}]`;}catch{return false;}});
  if(!owner)throw new Error('MicroDuck listener is not owned by the body');return inode;
}
export function checkRoot(root:string):void {
  if(process.platform!=='linux'||process.arch!=='arm64'||!/^\/tmp\/bunny-md-[a-f0-9]{32}$/.test(root))throw new Error('MicroDuck requires a Linux ARM64 fixture');
  const s=lstatSync(root);
  if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o700)throw new Error('MicroDuck fixture directory is not private');
}
export class FixtureWitness {
  readonly #root:string;
  readonly #witness:Witness;
  readonly #bytes:string;
  constructor(root:string) {
    checkRoot(root);this.#root=root;
    const path=join(root,'witness.json'),s=lstatSync(path);
    if(!s.isFile()||s.isSymbolicLink()||s.uid!==process.getuid?.()||(s.mode&0o777)!==0o600||s.size>65536)throw new Error('MicroDuck witness unavailable');
    this.#bytes=readFileSync(path,'utf8');const value:unknown=JSON.parse(this.#bytes);
    if(!check(value))throw new Error('MicroDuck witness is invalid');this.#witness=value;
    const expected=pinnedFiles(root);
    if(expected.length!==value.files.length||expected.some((f,i)=>f.path!==value.files[i]?.path||f.sha256!==value.files[i]?.sha256))throw new Error('MicroDuck witness pins mismatch');
    for(const f of value.files)if(digest(readFileSync(f.path))!==f.sha256)throw new Error('MicroDuck input hash mismatch');
    this.guard();
  }
  get socket():string {return join(this.#root,'robotd.sock');}
  guard():string {
    checkRoot(this.#root);const w=this.#witness;
    if(readFileSync(join(this.#root,'witness.json'),'utf8')!==this.#bytes||namespace('time')!==w.namespace||namespace('net')!==w.networkNamespace||namespace('pid')!==w.pidNamespace)throw new Error('MicroDuck fixture session changed');
    for(const p of [w.supervisor,w.body,w.daemon]) {
      if(JSON.stringify(processIdentity(p.pid))!==JSON.stringify(p)||namespace('time',p.pid)!==w.namespace||namespace('net',p.pid)!==w.networkNamespace||namespace('pid',p.pid)!==w.pidNamespace)throw new Error('MicroDuck owned process changed');
    }
    const body=[VENDOR.python,'-m','mjlab_microduck.sim.body_server','--host','127.0.0.1','--port','17801','--ducks','1','--headless','--keyframe','HOME'];
    const daemon=[VENDOR.binary,'--sim','127.0.0.1:17801','--params',join(this.#root,'robotd.toml'),'--socket',this.socket];
    if(JSON.stringify(w.body.argv)!==JSON.stringify(body)||JSON.stringify(w.daemon.argv)!==JSON.stringify(daemon))throw new Error('MicroDuck backend arguments mismatch');
    if(bodyListener(w.body.pid)!==w.bodyListenerInode)throw new Error('MicroDuck body listener changed');
    const socket=lstatSync(this.socket);
    if(!socket.isSocket()||socket.uid!==process.getuid?.()||socket.ino!==w.socketInode)throw new Error('MicroDuck socket identity changed');
    for(const f of w.files){const s=lstatSync(f.path);if(!s.isFile()||s.isSymbolicLink()||s.size!==f.size||s.mtimeMs!==f.mtimeMs||s.ctimeMs!==f.ctimeMs||s.ino!==f.ino)throw new Error('MicroDuck input changed');}
    return w.session;
  }
}
