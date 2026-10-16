import {MessageValidator,SCHEMA_BASE} from '@jimmie-potts/event-contracts/v2';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import {registerDeviceFamilies} from '@jimmie-potts/event-contracts/v2/devices';
export const RELEASE='wemo-hold-release',RELEASE_SCHEMA=`${SCHEMA_BASE}${RELEASE}/2.0`,RELEASE_TYPE='org.bunny.wemo-hold.release.requested';
const ref=(name:string)=>({$ref:`${SCHEMA_BASE}blocks/2.0#/$defs/${name}`});
export const wemoSchemas:Readonly<Record<string,object>>={ [RELEASE_SCHEMA]:{$schema:'https://json-schema.org/draft/2020-12/schema',$id:RELEASE_SCHEMA,type:'object',additionalProperties:false,
  required:['requestId','expectedConfigurationRevision','expectedGeneration','heldRequestId'],properties:{requestId:ref('requestId'),expectedConfigurationRevision:ref('revision'),expectedGeneration:ref('ticket'),heldRequestId:ref('requestId')}}};
export function registerWemoFamilies(validator:MessageValidator):void {
  validator.register(RELEASE_SCHEMA,wemoSchemas[RELEASE_SCHEMA] as object,message=>message.kind!=='command'||message.type!==RELEASE_TYPE?'Wemo hold-release kind/type mismatch':undefined);
}
export function wemoValidator():MessageValidator {const v=new MessageValidator();registerCoreFamilies(v);registerDeviceFamilies(v);registerWemoFamilies(v);return v;}
