// Fixed operational stderr only. Runtime wire errors keep their existing SDK contract.
const codes=['invalid-request','unavailable','forbidden','internal'];
const stages=['arguments','selection','volumes','configuration','credentials','archive','ownership','qualification','worker'];
const known=new WeakMap();
const line=(code,stage)=>`BUNNY_OPERATOR_REFUSAL code=${code} stage=${stage}. Preserve partial output and inspect the selected instance.\n`;
export function operatorRefusal(stage,code='invalid-request') {
  if(!stages.includes(stage)||!codes.includes(code))throw new Error('operator-refused');
  const error=new Error('operator-refused');known.set(error,{code,stage});return error;
}
export function refusalFields(error,fallback='worker') {
  const local=error!==null&&typeof error==='object'?known.get(error):undefined;if(local)return local;
  // A worker's fixed complete line is the only subprocess stderr accepted as a refusal. Nothing is echoed.
  if(typeof error?.stderr==='string')for(const code of codes)for(const stage of stages)if(error.stderr===line(code,stage))return {code,stage};
  return {code:'unavailable',stage:stages.includes(fallback)?fallback:'worker'};
}
export function refusalMessage(error,fallback) {const {code,stage}=refusalFields(error,fallback);return line(code,stage);}
