import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {idSchema,hashSchema,nameSchema,revisionSchema,policySchema,LibraryError,validate,type Playlist} from './contracts.js';
const playlistSchema=z.object({
  id:idSchema,name:nameSchema,revision:revisionSchema,repeat:z.boolean(),shuffle:z.boolean(),
  createdAt:z.iso.datetime(),updatedAt:z.iso.datetime(),
  items:z.array(z.object({id:idSchema,renditionId:hashSchema,playback:policySchema}).strict()).min(1).max(1000),
}).strict();
export const checkpointSchema=z.object({
  version:z.literal(1),sessionId:idSchema,snapshot:playlistSchema,
  source:z.discriminatedUnion('kind',[z.object({kind:z.literal('playlist')}).strict(),z.object({kind:z.literal('media'),assetId:idSchema,renditionId:hashSchema}).strict()]).optional(),
  order:z.array(idSchema).min(1).max(1000),cursor:z.number().int().nonnegative(),
  history:z.array(idSchema).max(10000),historyCursor:z.number().int().nonnegative().nullable(),
  currentItemId:idSchema,frontierPlayed:z.boolean(),
  intent:z.enum(['active','paused','stopped']),state:z.enum(['idle','loading','playing','paused','reconnecting','error']),
  requestedScreenOn:z.boolean(),lastError:z.object({code:z.string().min(1).max(64),itemId:idSchema.optional(),priorEffects:z.enum(['none','possible']).optional()}).strict().nullable(),
}).strict().refine(record=>{
  const ids=new Set(record.snapshot.items.map(item=>item.id));
  return (record.source?.kind!=='media'||record.snapshot.items.length===1&&record.snapshot.items[0]!.renditionId===record.source.renditionId) && ids.size===record.snapshot.items.length && record.order.length===ids.size && new Set(record.order).size===ids.size &&
    record.order.every(id=>ids.has(id)) && record.cursor<record.order.length && record.history.every(id=>ids.has(id)) &&
    (record.historyCursor===null ? !record.frontierPlayed && record.currentItemId===record.order[record.cursor] :
      record.historyCursor<record.history.length && record.currentItemId===record.history[record.historyCursor]);
});
export type PlaybackCheckpoint=z.infer<typeof checkpointSchema>;
export function readCheckpoint(db:DatabaseSync):PlaybackCheckpoint|undefined {
  const row=db.prepare('SELECT session_id,payload FROM playback_checkpoint WHERE slot=1').get();
  if(!row)return undefined;
  try {
    const record=checkpointSchema.parse(JSON.parse(String(row.payload)));
    const expected=[...new Set(record.snapshot.items.map(item=>item.renditionId))].sort();
    const retained=db.prepare('SELECT rendition_id FROM session_refs WHERE session_id=? ORDER BY rendition_id').all(String(row.session_id)).map(ref=>String(ref.rendition_id));
    if(record.source?.kind==='media'){const media=db.prepare('SELECT asset_id FROM renditions WHERE id=?').get(record.source.renditionId);if(media?.asset_id!==record.source.assetId)throw new Error();}
    if(record.sessionId!==row.session_id || JSON.stringify(expected)!==JSON.stringify(retained))throw new Error();
    return record;
  }catch {throw new LibraryError('catalog-corrupt');}
}
export function clearCheckpoint(db:DatabaseSync):void {
  const row=db.prepare('SELECT session_id FROM playback_checkpoint WHERE slot=1').get();
  db.prepare('DELETE FROM playback_checkpoint WHERE slot=1').run();
  if(row)db.prepare('DELETE FROM sessions WHERE id=?').run(String(row.session_id));
}
export interface CaptureHooks {guard?:()=>boolean;prepare?:(record:PlaybackCheckpoint)=>void;adopt?:(record:PlaybackCheckpoint)=>void}
export function createCheckpoint(db:DatabaseSync,snapshot:Playlist,hooks:CaptureHooks={},source?:PlaybackCheckpoint['source']):PlaybackCheckpoint {
  if(!snapshot.items.length)throw new LibraryError('invalid-input');
  const order=snapshot.items.map(item=>item.id);
  const record=validate(checkpointSchema,{version:1,sessionId:randomUUID(),snapshot,...(source?{source}:{}),order,cursor:0,history:[],historyCursor:null,currentItemId:order[0],frontierPlayed:false,
    intent:'paused',state:'paused',requestedScreenOn:true,lastError:null});
  hooks.prepare?.(record);
  validate(checkpointSchema,record);
  if(hooks.guard&&!hooks.guard())throw new LibraryError('cancelled');
  clearCheckpoint(db);
  db.prepare('INSERT INTO sessions VALUES (?,?)').run(record.sessionId,new Date().toISOString());
  const insert=db.prepare('INSERT INTO session_refs VALUES (?,?)');
  for(const id of new Set(snapshot.items.map(item=>item.renditionId)))insert.run(record.sessionId,id);
  db.prepare('INSERT INTO playback_checkpoint VALUES (1,?,?)').run(record.sessionId,JSON.stringify(record));
  return record;
}
export function saveCheckpoint(db:DatabaseSync,record:PlaybackCheckpoint):void {
  const previous=readCheckpoint(db);
  if(!previous || previous.sessionId!==record.sessionId)throw new LibraryError('revision-conflict');
  if(JSON.stringify(previous.snapshot)!==JSON.stringify(record.snapshot)||JSON.stringify(previous.source)!==JSON.stringify(record.source))throw new LibraryError('invalid-input');
  db.prepare('UPDATE playback_checkpoint SET payload=? WHERE slot=1').run(JSON.stringify(record));
}
