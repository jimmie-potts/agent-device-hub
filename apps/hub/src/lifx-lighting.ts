import {validate} from '@jimmie-potts/device-contracts';
import {object} from './common.js';

// Strict hub-side projection of the LIFX controller's `lifx-light` 1.0.0 profile. The owner validates again with its own schema.
type Check=(value:unknown)=>boolean;
const shape=(value:unknown,fields:Record<string,Check>):boolean=>object(value)&&Object.keys(value).length===Object.keys(fields).length&&Object.entries(fields).every(([k,check])=>Object.hasOwn(value,k)&&check(value[k]));
const integer=(minimum:number,maximum:number):Check=>value=>Number.isInteger(value)&&(value as number)>=minimum&&(value as number)<=maximum;
const one=(expected:unknown):Check=>value=>value===expected;
const unknown:Check=value=>shape(value,{status:one('unknown')});
const profile:Check=value=>shape(value,{profileId:one('lifx-light'),profileVersion:one('1.0.0')});
const command:Check=value=>shape(value,{kind:one('lifx.color.set'),hue:integer(0,360),saturation:integer(0,100)})||shape(value,{kind:one('lifx.temperature.set'),kelvin:integer(1500,9000)});
const wire=integer(0,65535);
const temperature:Check=value=>value===null||shape(value,{minimum:integer(1500,9000),maximum:integer(1500,9000)})&&(value as {minimum:number;maximum:number}).minimum<=(value as {maximum:number}).maximum;
const observation:Check=value=>unknown(value)||shape(value,{status:one('known'),color:v=>shape(v,{hue:wire,saturation:wire,brightness:wire,kelvin:wire}),
 readAt:v=>validate('clock',v),evidenceAgeMs:v=>typeof v==='number'&&Number.isFinite(v)&&v>=0});
export const LIGHTING_PROFILE=Object.freeze({profileId:'lifx-light',profileVersion:'1.0.0'});

/** A controller v1 envelope carrying one `lifx-light` 1.0.0 color or temperature command. */
export function validateLightingRequest(value:unknown):value is Record<string,unknown>&{controllerId:string;deviceId:string;requestId:{epoch:string;sequence:number}}{
 if(!object(value)||!Object.hasOwn(value,'profile')||!Object.hasOwn(value,'command'))return false;
 const {profile:declared,command:requested,...envelope}=value;
 // Every other field is the controller v1 request envelope; a placeholder command reuses the contract's validator for it.
 return validate('request',{...envelope,command:{kind:'power.set',on:true}})&&profile(declared)&&command(requested);
}

/** The owner's lighting snapshot: profile, a controller v1 snapshot and the lighting section, with no other fields. */
export function validateLightingSnapshot(value:unknown):boolean{
 return shape(value,{profile,controller:v=>validate('snapshot',v),lighting:v=>shape(v,{
  capabilities:c=>shape(c,{color:x=>typeof x==='boolean',temperature,effects:one(false)}),
  pending:p=>Array.isArray(p)&&p.length<=32&&p.every(entry=>shape(entry,{requestId:t=>validate('ticket',t),command})),
  observation,visible:unknown})});
}
