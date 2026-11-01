// Canonical boundary errors with fixed operational details. Never forward raw subprocess errors.
import {errorBody} from '@jimmie-potts/event-contracts/v2';
const codes=['invalid-request','unavailable','forbidden','internal'];
const stages=['arguments','selection','volumes','configuration','credentials','archive','ownership','qualification','worker'];
const known=new WeakMap();
const line=(code,stage)=>JSON.stringify(errorBody(code,{detail:`Maintenance stage ${stage} refused. Preserve partial output and inspect the selected instance.`}))+'\n';
export function operatorRefusal(stage,code='invalid-request') {
  if(!stages.includes(stage)||!codes.includes(code))throw new Error('operator-refused');
  const error=new Error('operator-refused');known.set(error,{code,stage});return error;
}
export function refusalFields(error,fallback='worker') {
  const local=error!==null&&typeof error==='object'?known.get(error):undefined;if(local)return local;
  // Only exact known canonical worker bodies are accepted, including registry retryability. Nothing is echoed.
  if(typeof error?.stderr==='string')for(const code of codes)for(const stage of stages)if(error.stderr===line(code,stage))return {code,stage};
  return {code:'unavailable',stage:stages.includes(fallback)?fallback:'worker'};
}
export function refusalMessage(error,fallback) {const {code,stage}=refusalFields(error,fallback);return line(code,stage);}
