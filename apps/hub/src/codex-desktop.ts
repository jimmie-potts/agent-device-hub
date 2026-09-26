import {lstat,opendir,readFile,stat} from 'node:fs/promises';
import {isAbsolute,join,normalize} from 'node:path';
import type {Identity,Outcome,Snapshot} from '@jimmie-potts/agent-state';
import {exact,id,object} from './common.js';

// Read-only Codex Desktop read evidence for #191. See the standalone-hub-host
// specification and docs/provider-qualification.md for the source and rule.
export type CodexDesktopOptions = {home:string; hostId:string; sourceId:string};
type Owner = {snapshot():Snapshot; ingest(input:unknown):Promise<Outcome>};

const MARKER = '.codex-global-state.json', MAX_BYTES = 16*1024*1024, POLL_MS = 2000;
// Desktop sets the unread flag shortly after Stop; legacy Nanoleaf used the same wait.
export const READ_SETTLE_MS = 5000;

/** Archive admission uses positive filename evidence only; title enrichment is separate. */
export async function archivedSession(source:CodexDesktopOptions,identity:Identity,signal:AbortSignal,ancestors:readonly Identity[]=[]):Promise<boolean> {
  const ids=new Set([identity,...ancestors].filter(item=>item.provider==='codex'&&item.client==='desktop'&&
    item.hostId===source.hostId&&item.sourceId===source.sourceId).map(item=>item.sessionId));
  if(!ids.size)return false;
  try{
    const path=join(source.home,'archived_sessions'),info=await lstat(path);
    if(signal.aborted||!info.isDirectory()||info.isSymbolicLink())return false;
    const directory=await opendir(path);let entries=0;
    for await(const entry of directory){
      if(signal.aborted||++entries>10000)return false;
      const match=/^rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-([A-Za-z0-9_.-]{1,128})\.jsonl$/.exec(entry.name);
      if(entry.isFile()&&match&&ids.has(match[1]))return true;
    }
  }catch{/* Missing or unreadable archive evidence cannot prevent monitoring. */}
  return false;
}

export function codexDesktopOptions(value:unknown):CodexDesktopOptions {
  if (!object(value) || !exact(value,['home','hostId','sourceId']) || typeof value.home !== 'string' || value.home.length > 1024 ||
      value.home.includes('\0') || !isAbsolute(value.home) || normalize(value.home) !== value.home || !id(value.hostId) || !id(value.sourceId))
    throw new Error('invalid-configuration');
  return {home:value.home,hostId:value.hostId,sourceId:value.sourceId};
}

/** Returns the unread thread IDs, or null when the marker is not the known version 1 shape. */
export function unreadSessions(text:string):Set<string>|null {
  try {
    const state:unknown = JSON.parse(text);
    const marker = object(state) ? state['electron-thread-read-state-v1'] : undefined;
    if (!object(marker) || marker.version !== 1 || !object(marker.unreadByIdentity)) return null;
    const unread = new Set<string>();
    for (const host of Object.values(marker.unreadByIdentity)) {
      if (!object(host)) return null;
      for (const list of Object.values(host)) {
        if (!Array.isArray(list) || !list.every(id)) return null;
        for (const session of list) unread.add(session);
      }
    }
    return unread;
  } catch { return null; }
}

function readEvents(snapshot:Snapshot,unread:ReadonlySet<string>,source:CodexDesktopOptions,now:number) {
  const events = [];
  for (const session of snapshot.sessions) {
    const {identity} = session;
    // Desktop lists unopened subagent threads indefinitely, so only top-level sessions qualify.
    if (identity.provider !== 'codex' || identity.client !== 'desktop' || identity.hostId !== source.hostId ||
        identity.sourceId !== source.sourceId || session.parent.status === 'known') continue;
    // The marker lists only unread threads, so absence means read once the flag has had time to appear.
    // Unordered interrupt and end hooks leave activity unknown, so only a known running turn waits.
    const state = unread.has(identity.sessionId) ? 'unread' : session.read === 'unread' || (session.read === 'unknown' &&
      session.activity !== 'active' && now - session.lastEvidenceAtMs >= READ_SETTLE_MS) ? 'read' : null;
    if (state && state !== session.read) events.push({apiVersion:'1.0',identity,turn:session.turn,parent:{status:'unknown'},
      event:{kind:'read.observed',state},observedAtMs:now,ordering:{status:'unknown'}});
  }
  return events;
}

export function createDesktopRead(source:CodexDesktopOptions,owner:Owner,clock:()=>number) {
  const path = join(source.home,MARKER);
  let stamp = '', unread:Set<string>|null = null;
  const version = async () => {const info = await stat(path,{bigint:true});return {file:info.isFile(),size:info.size,stamp:`${info.mtimeNs}:${info.size}`};};
  async function refresh() {
    try {
      const before = await version();
      if (before.stamp === stamp) return;
      unread = null;
      if (!before.file || before.size > MAX_BYTES) {stamp = before.stamp;return;}
      const bytes = await readFile(path);
      // Retry a file that changed while being read; keep a stable unusable file until it changes.
      if ((await version()).stamp !== before.stamp || bytes.length > MAX_BYTES) {stamp = '';return;}
      stamp = before.stamp;
      unread = unreadSessions(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    } catch { stamp = '';unread = null; }
  }
  return {
    async tick() {
      await refresh();
      if (!unread) return;
      for (const event of readEvents(owner.snapshot(),unread,source,clock())) await owner.ingest(event).catch(() => {});
    }
  };
}

export function startDesktopRead(source:CodexDesktopOptions,owner:Owner,clock:()=>number,active:()=>boolean) {
  const reader = createDesktopRead(source,owner,clock);
  let running:Promise<void>|undefined;
  const timer = setInterval(() => {
    if (running || !active()) return;
    running = reader.tick().catch(() => {}).finally(() => {running = undefined;});
  },POLL_MS);
  timer.unref();
  return {async close() {clearInterval(timer);await running;}};
}
