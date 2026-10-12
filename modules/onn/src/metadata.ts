import {TEXT_FIELDS, type Metadata, type Playback, type MetadataSession, type MetadataSample, type Omission} from './metadata-types.js';
export {TEXT_FIELDS} from './metadata-types.js';
export type {Metadata, Playback, Omission, MetadataSession, MetadataSample} from './metadata-types.js';

const MAX_REPLY_BYTES = 262144;
const MAX_TEXT_BYTES = 8192;
const plain = (value: unknown, keys: readonly string[]): Record<string, unknown> | undefined => {
 if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
 const prototype: unknown = Object.getPrototypeOf(value);
 if (prototype !== Object.prototype && prototype !== null) return undefined;
 const names = Reflect.ownKeys(value);
 if (names.length !== keys.length || names.some(name => typeof name !== 'string' || !keys.includes(name))) return undefined;
 const descriptors = Object.getOwnPropertyDescriptors(value);
 const result: Record<string, unknown> = {};
 for (const key of keys) {
  const descriptor = descriptors[key];
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return undefined;
  result[key] = descriptor.value as unknown;
 }
 return result;
};
const list = (value: unknown, maximum: number): unknown[] | undefined => {
 if (!Array.isArray(value) || value.length > maximum || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
 const keys = Reflect.ownKeys(value);
 if (keys.length !== value.length + 1) return undefined;
 const result: unknown[] = [];
 for (let i = 0; i < value.length; i++) {
  const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
  if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) return undefined;
  result.push(descriptor.value as unknown);
 }
 return result;
};
const integer = (value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number =>
 typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const validUnicode = (value: string): boolean => {
 for (let i = 0; i < value.length; i++) {
  const code = value.charCodeAt(i);
  if (code >= 0xd800 && code <= 0xdbff) {
   const next = value.charCodeAt(++i);
   if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
  } else if (code >= 0xdc00 && code <= 0xdfff) return false;
 }
 return true;
};
const boundedText = (value: unknown): value is string | null => value === null || typeof value === 'string'
 && value.length <= MAX_TEXT_BYTES && validUnicode(value) && Buffer.byteLength(value, 'utf8') <= MAX_TEXT_BYTES;
const REDACTED = '[REDACTED]';
const asciiSpace = String.raw`[ \t\n\x0b\f\r]`;
const valuePattern = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^ \t\n\x0b\f\r,;&]+)`;
const authorization = new RegExp(String.raw`(?<![a-z0-9_])(authorization${asciiSpace}*[:=]${asciiSpace}*)(?:(bearer|basic)[ \t]+)?(${valuePattern})`, 'gi');
const assignment = new RegExp(String.raw`(?<![a-z0-9_])((?:password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|session[_-]?cookie)${asciiSpace}*[:=]${asciiSpace}*)(${valuePattern})`, 'gi');
const bearer = /(?<![a-z0-9_])(bearer[ \t]+)([a-z0-9._~+/-]+={0,2})/gi;
const decodeAscii = (value:string):string => value.replace(/%([0-9a-f]{2})/gi,(_match:string,hex:string)=>String.fromCharCode(Number.parseInt(hex,16)));
const credentialKeys = new Set(['token','access_token','refresh_token','id_token','authorization','auth','api_key','apikey','password','passwd','pwd','client_secret','session_cookie']);
const redactPlain = (value:string):string => value
 .replace(authorization,(_match:string,prefix:string,scheme:string|undefined)=>`${prefix}${scheme===undefined?'':scheme+' '}${REDACTED}`)
 .replace(assignment,(_match:string,prefix:string)=>prefix+REDACTED)
 .replace(bearer,(match:string,prefix:string,token:string)=>token.length>=8 && /[^a-z]/i.test(token)?prefix+REDACTED:match);
const redactParameters = (source:string):string => {
 const parts=source.split(/([&;])/);
 for(let i=0;i<parts.length;i+=2){
  const item=parts[i]??'', equals=item.indexOf('=');
  const key=decodeAscii(item.slice(0,equals)).toLowerCase().replaceAll('-','_');
  if(equals>=0 && credentialKeys.has(key) && equals+1<item.length)parts[i]=item.slice(0,equals+1)+REDACTED;
 }
 return parts.join('');
};
const redactUrl = (source:string):string => {
 let url=source;
 const start=url.indexOf('://')+3;
 let end=url.length;
 for(const delimiter of ['/','?','#']){const found=url.indexOf(delimiter,start);if(found>=0 && found<end)end=found;}
 const authority=url.slice(start,end), at=authority.lastIndexOf('@');
 if(at>=0 && decodeAscii(authority.slice(0,at)).includes(':'))url=url.slice(0,start)+REDACTED+authority.slice(at)+url.slice(end);
 const fragment=url.indexOf('#');
 let base=fragment<0?url:url.slice(0,fragment);
 const query=base.indexOf('?');
 if(query>=0)base=base.slice(0,query+1)+redactParameters(base.slice(query+1));
 return base+(fragment<0?'':'#'+redactParameters(url.slice(fragment+1)));
};
const javaWhitespace = (value:string):boolean => {
 const code=value.charCodeAt(0);
 return code>=0x1c && code<=0x20 || /[\t-\r\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]/.test(value);
};
/** Declared credential syntax only; this does not certify arbitrary prose as secret-free. */
const redactText = (source:string):string => {
 let result='', cursor=0, search=0;
 while(true){
  const colon=source.indexOf('://',search);if(colon<0)break;
  let start=colon;while(start>cursor && /[a-z0-9+.-]/i.test(source[start-1]??''))start--;
  if(start===colon || !/[a-z]/i.test(source[start]??'')){search=colon+3;continue;}
  let end=colon+3;
  while(end<source.length){const char=source[end]??'';if(javaWhitespace(char)||/[<>"']/.test(char))break;end++;}
  result+=redactPlain(source.slice(cursor,start))+redactUrl(source.slice(start,end));cursor=end;search=end;
 }
 return result+redactPlain(source.slice(cursor));
};
const sanitize = (sample:MetadataSample):void => {
 for(const session of sample.sessions){
  if(session.metadata===null)continue;
  for(const field of TEXT_FIELDS){
   const source=session.metadata[field];if(source===null)continue;
   const cleaned=redactText(source);
   const add=(reason:Omission['reason']):void=>{if(!session.omissions.some(value=>value.field===field && value.reason===reason))session.omissions.push({field,reason});};
   if(cleaned!==source)add('credential-redacted');
   if(Buffer.byteLength(cleaned,'utf8')>MAX_TEXT_BYTES){session.metadata[field]=null;add('oversized');}
   else session.metadata[field]=cleaned;
  }
 }
};
/** JSON.parse loses duplicate members; this bounded lexical pass refuses them first. */
const uniqueObjectKeys = (source:string):boolean => {
 const frames:Array<Set<string>|null>=[];
 for(let i=0;i<source.length;i++){
  const char=source[i];
  if(char==='{' || char==='['){if(frames.length===8)return false;frames.push(char==='{'?new Set<string>():null);}
  else if(char==='}' || char===']')frames.pop();
  else if(char==='"'){
   const start=i++;
   while(i<source.length && source[i]!=='"'){if(source[i]==='\\')i++;i++;}
   if(i===source.length)return false;
   let next=i+1;while(next<source.length && /\s/.test(source[next]??''))next++;
   if(source[next]===':'){
    const frame=frames[frames.length-1];if(!frame)return false;
    const key:unknown=JSON.parse(source.slice(start,i+1));if(typeof key!=='string'||frame.has(key))return false;frame.add(key);
   }
  }
 }
 return true;
};
const readSession = (value: unknown): MetadataSession | undefined => {
 const row = plain(value, ['app','metadata','playback','omissions']);
 if (!row || row.app !== 'youtube' && row.app !== 'stremio') return undefined;
 let metadata: Metadata | null = null;
 if (row.metadata !== null) {
  const data = plain(row.metadata, [...TEXT_FIELDS, 'durationMs']);
  if (!data || data.durationMs !== null && !integer(data.durationMs)) return undefined;
  const text: Record<string, string | null> = {};
  for (const field of TEXT_FIELDS) {
   const value = data[field];
   if (!boundedText(value)) return undefined;
   text[field] = value;
  }
  metadata = {...text, durationMs:data.durationMs} as Metadata;
 }
 let playback: Playback | null = null;
 if (row.playback !== null) {
  const data = plain(row.playback, ['state','positionMs','speed','positionUpdatedElapsedMs']);
  if (!data || !integer(data.state,0,11) || !integer(data.positionMs,-1) || !integer(data.positionUpdatedElapsedMs)
   || typeof data.speed !== 'number' || !Number.isFinite(data.speed)) return undefined;
  playback = {state:data.state,positionMs:data.positionMs,speed:data.speed,positionUpdatedElapsedMs:data.positionUpdatedElapsedMs};
 }
 const values = list(row.omissions,16);
 if (!values) return undefined;
 const omissions: Omission[] = [];
 const seen = new Set<string>();
 for (const value of values) {
  const data = plain(value,['field','reason']);
  if (!data || typeof data.field !== 'string' || !TEXT_FIELDS.some(field => field === data.field)
   || data.reason !== 'credential-redacted' && data.reason !== 'oversized') return undefined;
  const key = `${data.field}/${data.reason}`;
  if (seen.has(key)) return undefined;
  seen.add(key);
  omissions.push({field:data.field as Omission['field'],reason:data.reason});
 }
 return {app:row.app,metadata,playback,omissions};
};
/** Validate closed values and return a fresh projection; failures carry no raw reply or exception. */
export const validateMetadataSample = (value: unknown): MetadataSample | undefined => {
 try {
  const row = plain(value,['schema','deviceElapsedMs','sessions']);
  if (!row || row.schema !== 'onn-metadata/2.0' || !integer(row.deviceElapsedMs)) return undefined;
  const values = list(row.sessions,8);
  if (!values) return undefined;
  const sessions: MetadataSession[] = [];
  for (const value of values) {
   const session = readSession(value);
   if (!session) return undefined;
   sessions.push(session);
  }
  const sample: MetadataSample = {schema:'onn-metadata/2.0',deviceElapsedMs:row.deviceElapsedMs,sessions};
  if (Buffer.byteLength(JSON.stringify(sample)+'\n','utf8') > MAX_REPLY_BYTES) return undefined;
  sanitize(sample);
  if (Buffer.byteLength(JSON.stringify(sample)+'\n','utf8') > MAX_REPLY_BYTES) return undefined;
  return sample;
 } catch { return undefined; }
};
export const parseMetadataReply = (stdout:string,exitCode:number,stderr:string): MetadataSample | undefined => {
 try {
  if (exitCode !== 0 || stderr !== '' || typeof stdout !== 'string' || stdout.length > MAX_REPLY_BYTES
   || !validUnicode(stdout) || Buffer.byteLength(stdout,'utf8') > MAX_REPLY_BYTES || !stdout.endsWith('\n')
   || stdout.indexOf('\n') !== stdout.length - 1 || stdout.includes('\r')) return undefined;
  const body=stdout.slice(0,-1);
  if(!uniqueObjectKeys(body))return undefined;
  const value: unknown = JSON.parse(body);
  return validateMetadataSample(value);
 } catch { return undefined; }
};
