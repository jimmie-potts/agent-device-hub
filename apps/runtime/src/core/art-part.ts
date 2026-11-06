// The core forwards the art module's staged compositions and ambient choices to their displays (Hub #679): only the
// families below, only from that module, each as one tracked operation the module requested. This part never forwards a
// moment. The in-process bus checks no sender, so a module could address a display's key directly: the rule binds here,
// at the tracker and gateway, and at each responder, which refuses any source but `bunny/core` (`artCommandRefusal`).
import {MessageValidator, errorBody, type ErrorBody} from '@jimmie-potts/event-contracts/v2';
import {ART_FORWARDED, ART_MODULE_SOURCE, ART_SUBJECT, EXTENDED_ART_DISPATCH_SCHEMA, EXTENDED_ART_STAGE_SCHEMA, type ArtDispatch21} from '@jimmie-potts/event-contracts/v2/art';
import {registerCoreFamilies} from '@jimmie-potts/event-contracts/v2/families';
import type {CoreHandle, CorePart} from './core.js';

export class ArtPart implements CorePart {
  #closed = false;
  constructor(readonly authorize?:(authorization:string,target:string,compositionId:string)=>ErrorBody|undefined){}
  async start(core: CoreHandle): Promise<void> {
    const validator = new MessageValidator(); registerCoreFamilies(validator);
    await core.sdk.respond<ArtDispatch21>(`bunny.cmd.art-dispatch.${ART_SUBJECT}`, async command => {
      if (this.#closed) return errorBody('unavailable');
      if (command.source !== ART_MODULE_SOURCE) return errorBody('forbidden');
      const checked = validator.validate(command, {nowMs: core.clock.now()});
      if (!checked.ok) return {error: checked.error};
      const {requestId, family, target, data} = command.data;
      // The schema closes the family; this lookup keeps the allowlist explicit where the dispatch happens.
      if (!Object.hasOwn(ART_FORWARDED, family)) return errorBody('invalid-request', {detail: 'the art module may dispatch only a stage or an ambient set'});
      if('authorization' in command.data) {
        const denied=this.authorize===undefined?errorBody('forbidden'):this.authorize(command.data.authorization,target,command.data.data.compositionId);
        if(denied!==undefined)return denied;
      }
      const {type} = ART_FORWARDED[family];
      const dataschema = command.dataschema === EXTENDED_ART_DISPATCH_SCHEMA ? EXTENDED_ART_STAGE_SCHEMA : ART_FORWARDED[family].dataschema;
      const answer = await core.dispatch({key: `bunny.cmd.${family}.${target}`, requestedBy: command.source, requestId, parent: command,
        draft: {type, subject: target, dataschema, data}});
      return 'error' in answer ? answer : {status: 'accepted'};
    });
  }
  close(): void {this.#closed = true;}
}
