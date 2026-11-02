import './microduck.css';
import React, {useEffect, useState} from 'react';
import type {FrontendContext, FrontendContribution, FrontendCommand} from '@jimmie-potts/sdk/frontend';
import type {SyncedCopy} from '@jimmie-potts/sdk/remote';
import type {MicroDuckState} from '../contracts.js';
function LocalCommands({context,target,kind,children}:{context:FrontendContext;target:string;kind:'controls'|'stop';children:(command:FrontendCommand)=>React.ReactNode}):React.JSX.Element {
  const [attempts,setAttempts]=useState(()=>[crypto.randomUUID()]);
  const Command=context.ui.Command;
  return <>{attempts.map((attempt,index)=><Command key={attempt} context={context} target={target} attemptKey={`module:microduck:${kind}:${target}:${attempt}`}>
    {command=><>
      {index===attempts.length-1&&children({...command,run:async action=>{
        const result=command.run(action);
        setAttempts(previous=>[...previous.slice(-15),crypto.randomUUID()]);
        await result;
      }})}
      {command.requestId!==undefined&&<p className="microduck-feedback" role="status">{command.text}</p>}
    </>}
  </Command>)}</>;
}
function Page({context}:{context:FrontendContext}):React.JSX.Element {
  const [view,setView]=useState<{api:FrontendContext['api'];state?:MicroDuckState;live:boolean}>();
  const [recoveryFor,setRecoveryFor]=useState<string>();
  useEffect(()=>{
    let closed=false,current:MicroDuckState|undefined,copy:SyncedCopy<MicroDuckState>|undefined,live=false;
    const show=():void=>{if(!closed)setView({api:context.api,...(current===undefined?{}:{state:current}),live});};show();
    if(context.connected)void context.api.sync<MicroDuckState>(['microduck-state'],change=>{
      if(closed)return;
      if(change.type==='updated'){if(current===undefined||change.message.data.revision>current.revision)current=change.message.data;}
      else if(change.type==='synced')live=true;
      else if(change.type==='failed'||change.type==='removed'){live=false;current=undefined;}
      show();
    },{onRestarted:()=>{live=false;current=undefined;show();}}).then(result=>{
      if(result.status!=='synced')return;if(closed){void result.copy.close();return;}
      copy=result.copy;current=copy.states()[0]?.data;live=true;show();
    }).catch(()=>{live=false;show();});
    return ()=>{closed=true;void copy?.close();};
  },[context.api,context.connected]);
  const state=view?.api===context.api&&context.connected&&view.live?view.state:undefined;
  const recoveryKey=state?.held===null?undefined:JSON.stringify([state?.id,state?.held?.requestId,state?.configurationRevision,state?.generation]);
  const recovered=recoveryFor!==undefined&&recoveryFor===recoveryKey;
  const Command=context.ui.Command;
  const authority=state!==undefined&&context.control&&context.operationsLive&&context.connected;
  const fresh=authority&&state.connection==='available';
  const motionReady=fresh&&state.ownership==='fixture-exclusive'&&state.observation?.policy==='walk'&&state.observation.healthy&&state.observation.zeroVelocity;
  const send=(command:FrontendCommand,family:string,data:object):void=>{
    if(!authority)return;setRecoveryFor(undefined);
    void command.run({family,target:state.id,requestId:crypto.randomUUID(),data:family==='microduck-stop'?{}:{...data,expectedConfigurationRevision:state.configurationRevision,expectedGeneration:state.generation,
      ...(family==='microduck-gesture'&&state.held!==null&&recovered?{recovered:true,heldRequestId:state.held.requestId}:{})}});
  };
  return <section className="microduck-panel" aria-label="MicroDuck robot controls">
    <h2>MicroDuck robot</h2>
    <p>Simulation · finite head expression</p>
    <p>{state?.observation===null||state?.observation===undefined?'Backend unverified':state.observation.backend.kind==='fake-io'?'Fake I/O fixture':`Vendor MuJoCo · daemon ${state.observation.backend.daemonVersion} · API ${state.observation.backend.apiVersion}`}</p>
    <p>Manual cues have a two-second minimum interval. Neutral input is available separately.</p>
    <p role="status">{state===undefined?'State unavailable':state.connection==='available'?'Simulator available':'Simulator '+state.connection}</p>
    <p>Stop expression cancels future B.U.N.N.Y. writes. It does not clear the last head input or stop balance.</p>
    {state!==undefined&&<>
      <p>{state.takeover?'Manual takeover':'Automatic expression '+(state.enabled?'enabled':'disabled')}{state.latched?' · expression latched off':''}</p>
      <p>Simulated head input: {state.observation?.head[2].toFixed(3)??'Unknown'} rad</p>
      <p>Policy yaw target / simulated joint: {state.observation===null?'Unknown':`${state.observation.targets[7]?.toFixed(3)} / ${state.observation.joints[7]?.toFixed(3)} rad`}</p>
      <p>Vendor policy: {state.observation?.policy??'Unknown'} · ownership: {state.ownership}</p>
      <p>{motionReady?'Head input ready':'Waiting for fresh healthy balancing policy and zero velocity'}</p>
      <p>Last operation: {state.lastOutcome?.result??'Unknown'}</p>
      <p>{state.active===null?'No active program':`Active ${state.active.gesture} ${state.active.phase} phase`}</p>
      {state.held!==null&&<>
        <p>Head input may persist. Automatic expression is held.</p>
        <label><input type="checkbox" checked={recovered} onChange={event=>{setRecoveryFor(event.target.checked?recoveryKey:undefined);}}/>I acknowledge this held operation and restored simulator ownership for a new neutral input</label>
      </>}
      <p>Each local control click creates a new tracked request. Earlier requests are retained and never replayed.</p>
      <LocalCommands context={context} target={state.id} kind="controls">
        {command=><div className="microduck-actions">
          <button disabled={!authority||command.locked} onClick={()=>{send(command,'microduck-control',{action:'takeover'});}}>Take over</button>
          <button disabled={!motionReady||command.locked||state.held!==null||state.active!==null} onClick={()=>{send(command,'microduck-control',{action:'enable-auto'});}}>Enable automatic expression</button>
          <button disabled={!motionReady||command.locked||state.held!==null||state.active!==null} onClick={()=>{send(command,'microduck-control',{action:'resume-auto'});}}>Resume automatic expression</button>
          <button disabled={!authority||command.locked} onClick={()=>{send(command,'microduck-control',{action:'disable-auto'});}}>Disable automatic expression</button>
        </div>}
      </LocalCommands>
      <Command context={context} target={state.id} attemptKey={`module:microduck:gesture:${state.id}:${state.held?.requestId??state.lastRecovery?.requestId??'initial'}`}>
        {command=><div className="microduck-actions">
          {(['notice','attention','neutral'] as const).map(gesture=><button key={gesture} disabled={!motionReady||!state.takeover||state.pending>0||command.locked||state.held!==null&&(gesture!=='neutral'||!recovered)}
            onClick={()=>{send(command,'microduck-gesture',{gesture});}}>{gesture==='neutral'?'Neutral head input':gesture==='notice'?'Notice gesture':'Attention gesture'}</button>)}
          <p className="microduck-feedback" role="status">{command.text}</p>
        </div>}
      </Command>
      <LocalCommands context={context} target={state.id} kind="stop">
        {command=><div className="microduck-actions"><button disabled={!authority||command.locked} onClick={()=>{send(command,'microduck-stop',{});}}>Stop expression</button></div>}
      </LocalCommands>
    </>}
  </section>;
}
export const frontend:FrontendContribution={module:'microduck',pages:[{id:'controls',Component:Page}]};
