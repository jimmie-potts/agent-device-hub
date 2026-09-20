import {createAgentState,validateSnapshot,type Storage,type Envelope} from '@jimmie-potts/agent-state';
import {createEmitter,type SourceConfiguration} from '@jimmie-potts/agent-state/providers';

// The host supplies its private atomic store. This example starts no service.
export async function embed(storage:Storage,source:SourceConfiguration){
  const owner=await createAgentState({storage,ownerId:'agent-state-owner',consumers:[
    {id:'pixoo',clearOnNewTurn:true},{id:'nanoleaf',clearOnNewTurn:false}
  ]});
  const feed=owner.subscribe('pixoo');
  const emitter=createEmitter({source,enabled:false,qualified:false,send:async(event:Readonly<Envelope>)=>{
    const result=await owner.ingest(event);if(!result.ok)throw new Error('admission-failed');
  }});
  const snapshot=validateSnapshot(owner.snapshot());
  if(!snapshot.ok)throw new Error('invalid-snapshot');
  return {owner,feed,emitter,snapshot:snapshot.value};
}
