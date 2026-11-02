import {Ajv2020} from 'ajv/dist/2020.js';
import type {Observation, Head} from './contracts.js';
import {VENDOR_IDENTITY} from './contracts.js';
const vector = (length: number): object => ({type:'array',minItems:length,maxItems:length,items:{type:'number'}});
type VendorState = {t_ns: string; t:number; head:Head; targets:number[]; joints:number[]; loop:{hz:number}; policy:string;
  move:{requested:number[];applied:number[]};safety:{fallen:boolean;limp:boolean;picked_up:boolean}};
const valid = new Ajv2020().compile<{jsonrpc:'2.0';method:'robot.state';params:VendorState}>({
  type:'object',required:['jsonrpc','method','params'],additionalProperties:false,properties:{jsonrpc:{const:'2.0'},method:{const:'robot.state'},params:{
    type:'object',required:['t_ns','t','head','targets','joints','loop','policy','move','safety'],properties:{
      t_ns:{type:'string',pattern:'^[1-9][0-9]{0,19}$'},t:{type:'number',minimum:0},head:vector(4),targets:vector(15),joints:vector(15),
      loop:{type:'object',required:['hz'],properties:{hz:{type:'number',minimum:0}}},policy:{type:'string',minLength:1,maxLength:64},
      move:{type:'object',required:['requested','applied'],properties:{requested:vector(3),applied:vector(3)}},
      safety:{type:'object',required:['fallen','limp','picked_up'],properties:{fallen:{type:'boolean'},limp:{type:'boolean'},picked_up:{type:'boolean'}}},
    },
  }},
});
export function parseWire(line: string): unknown {
  if (Buffer.byteLength(line)>256*1024) throw new Error('MicroDuck frame is too large');
  return JSON.parse(line, (key:string,value:unknown,context?:{source?:string}):unknown => {
    if(key!=='t_ns')return value;
    const source=context?.source;
    if(source===undefined||!/^[1-9][0-9]{0,19}$/.test(source)||BigInt(source)>18446744073709551615n)throw new Error('MicroDuck sensor timestamp is invalid');
    return source;
  });
}
export function parseState(line: string, session: string): Observation {
  const value=parseWire(line);
  if(!valid(value))throw new Error('MicroDuck sensor frame is invalid');
  const s=value.params;
  return {backend:VENDOR_IDENTITY,session,sensorNs:s.t_ns,head:s.head,targets:s.targets,joints:s.joints,syntheticJointIndices:[9],daemonUptimeSeconds:s.t,loopHz:s.loop.hz,policy:s.policy,
    healthy:!s.safety.fallen&&!s.safety.limp&&!s.safety.picked_up,zeroVelocity:[...s.move.requested,...s.move.applied].every(x=>x===0)};
}
