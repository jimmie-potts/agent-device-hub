import type {DatabaseSync} from 'node:sqlite';
import {Ajv2020} from 'ajv/dist/2020.js';
import {compileOnFirstUse} from './compile-on-first-use.js';
import {childOf, type TraceContext} from '@jimmie-potts/sdk';
import {ART_SCHEDULE_SCHEMA, type ArtScheduleRecord, type ArtOpportunity} from '@jimmie-potts/event-contracts/v2/art-schedule';
import {initialArtRecord, recordValid, type WakingDay} from './art-schedule-model.js';
import type {CoreHandle} from './core.js';

export type ArtDay = WakingDay & {settingsRevision:number; starts:number[]; claimed:number};
export type ArtScheduleData = {record:ArtScheduleRecord;day:ArtDay|null; latestStartMs:number|null;
  dayWatermarkMs:number; ambientAtMs:number; weatherRevision:number};
const integer={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const valid=compileOnFirstUse(() => new Ajv2020().compile<Omit<ArtScheduleData,'record'>>({type:'object',additionalProperties:false,
  required:['day','latestStartMs','dayWatermarkMs','ambientAtMs','weatherRevision'],properties:{
    latestStartMs:{anyOf:[integer,{type:'null'}]},dayWatermarkMs:integer,ambientAtMs:integer,weatherRevision:integer,
    day:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,required:['key','startAtMs','endAtMs','settingsRevision','starts','claimed'],properties:{
      key:{type:'string',pattern:'^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}$'},startAtMs:integer,endAtMs:integer,settingsRevision:integer,
      starts:{type:'array',maxItems:8,uniqueItems:true,items:integer},claimed:{type:'integer',minimum:0,maximum:8}}}]}}}));
const validDay=(day:ArtDay):boolean=>day.startAtMs<day.endAtMs&&day.starts.every((at,index)=>at>=day.startAtMs&&at<day.endAtMs&&(index===0||at>(day.starts[index-1]??0)));
/** Only this owner's bounded plan is mutable. Every attempt identity remains spent, like core_operations. */
export class ArtScheduleStore {
  constructor(readonly db:DatabaseSync, readonly commit?:CoreHandle['transaction']) {
    db.exec('CREATE TABLE IF NOT EXISTS automation_art_schedule(id INTEGER PRIMARY KEY CHECK(id=1),payload TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS automation_art_claims(id TEXT PRIMARY KEY,payload TEXT NOT NULL) STRICT');
    this.get();
  }
  get(): ArtScheduleData {
    const row=this.db.prepare('SELECT payload FROM automation_art_schedule WHERE id=1').get();
    if(row===undefined)return {record:initialArtRecord(),day:null,latestStartMs:null,dayWatermarkMs:0,ambientAtMs:0,weatherRevision:0};
    const value:unknown=JSON.parse(String(row.payload));
    if(value===null||typeof value!=='object'||!('record' in value))throw new Error('invalid-state');
    const {record,...rest}=value;
    if(!recordValid(record)||!valid(rest)||record.policy.wakingStartMinute===record.policy.wakingEndMinute
      ||rest.day!==null&&!validDay(rest.day))throw new Error('invalid-state');
    return {record,...rest};
  }
  /** Transactional publication and claims share the core lease; callbacks must never await. */
  async change(work:(data:ArtScheduleData)=>void,parent:TraceContext=childOf(undefined)):Promise<ArtScheduleData> {
    const save = (revision: number) => {
      const data = this.get();
      work(data);
      data.record.revision = revision;
      const saved = this.db.prepare('INSERT INTO automation_art_schedule VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload')
        .run(JSON.stringify(data));
      if (Number(saved.changes) !== 1) throw new Error('the art schedule was not stored');
      return data;
    };
    if (this.commit !== undefined) return this.commit(tx => {
      const data = save(tx.revision());
      tx.add('bunny.state.art-schedule.art', {kind: 'state', type: 'org.bunny.art-schedule.updated', subject: 'art',
        dataschema: ART_SCHEDULE_SCHEMA, data: data.record}, {parent});
      return data;
    });
    this.db.exec('BEGIN IMMEDIATE');try{const data=save(this.get().record.revision+1);this.db.exec('COMMIT');return data;}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  handoff(opportunity:ArtOpportunity,surface:string):boolean {
    const work=()=>Number(this.db.prepare('INSERT OR IGNORE INTO automation_art_claims VALUES(?,?)')
      .run(`${opportunity.id}-handoff-${surface}`,JSON.stringify(opportunity)).changes)===1;
    if(this.db.isTransaction)return work();
    this.db.exec('BEGIN IMMEDIATE');try{const accepted=work();this.db.exec('COMMIT');return accepted;}
    catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  /** Called only inside change(): an attempt cannot outlive a failed surrounding commit. */
  claim(opportunity:ArtOpportunity):boolean {
    if(!this.db.isTransaction)throw new Error('invalid-state');
    return Number(this.db.prepare('INSERT OR IGNORE INTO automation_art_claims VALUES(?,?)').run(opportunity.id,JSON.stringify(opportunity)).changes)===1;
  }
}
