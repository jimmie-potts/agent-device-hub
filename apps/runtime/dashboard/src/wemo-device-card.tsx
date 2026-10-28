import React,{useRef} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import {useAttempt} from './command-control.tsx';
import {deviceAction,operationView} from './devices.ts';
import {PowerLimitPanel,type PowerLimitProps} from './power-limit.tsx';
import {Facts} from './ui.tsx';
import {WemoCard} from './wemo-card.tsx';
import {wemoCardState} from './wemo.ts';

export function WemoDeviceCard({record,owner,live,control,operations,operationsLive,refresh,limit,now}: {
  record:DeviceRecord;owner:string;live:boolean;control:boolean;operations:readonly OperationRecord[];operationsLive:boolean;refresh:()=>Promise<void>;limit:PowerLimitProps;now:number;
}):React.JSX.Element{
  const action=useAttempt(record.id,operations,operationsLive);
  const props={record,live,control,operationsLive,now};
  const latest=useRef(props);latest.current=props;
  const view=wemoCardState(record,live,control,operationsLive,action.locked,now);
  const held=record.held,limitRecord=limit.record;
  const powerText=(value:{status:'unknown'}|{status:'known';value:boolean}):string=>value.status==='known'?value.value?'On':'Off':'Unknown';
  const routine=action.text==='No command sent from this page.'||action.text.startsWith('Completed: succeeded.');
  return <WemoCard id={record.id} label={record.label??record.id} power={view.power} status={view.status} disabled={view.disabled}
    onPower={on=>{const current=latest.current;const gate=wemoCardState(current.record,current.live,current.control,current.operationsLive,action.locked,current.now);if(gate.disabled)return;
      void action.run(deviceAction(current.record,{family:'power-set',data:{on}},crypto.randomUUID()));}}
    powerControls={<>
      {view.reason!==undefined&&!action.locked&&held===undefined&&<p className="wemo-note">{view.reason}</p>}
      {held!==undefined&&<><p className="wemo-note warning">The last power change has no confirmed result.</p>
        <button type="button" className="secondary" disabled={!control||!live||!operationsLive||record.pending>0||action.locked&&action.requestId!==held.requestId} onClick={()=>{
          const current=latest.current;if(!current.control||!current.live||!current.operationsLive||current.record.held===undefined)return;
          void action.run({family:'wemo-hold-release',target:current.record.id,requestId:crypto.randomUUID(),data:{heldRequestId:current.record.held.requestId,expectedConfigurationRevision:current.record.configurationRevision,expectedGeneration:current.record.generation}});
        }}>Release Wemo hold</button></>}
      <p role="status" className={routine?'vh':'wemo-note'}>{action.text}</p>
      {action.locked&&<button type="button" className="secondary" onClick={()=>{void refresh();}}>Refresh current state</button>}
    </>}
    limit={<PowerLimitPanel {...limit} concise/>}
    evidence={<>
      <Facts items={[
        ['Owner',owner],['Device ID',record.id],['Desired power',powerText(record.desired.power)],['Observed power',record.observed.status==='known'?powerText(record.observed.power):'Unknown'],
        ['Observation age',record.observed.status==='known'?`${Math.max(0,Math.floor((now-record.observed.observedAtMs)/1000))} seconds`:'Unknown'],
        ['Pending changes',record.pending],['Last successful transmission',record.lastTransmission.status==='known'?new Date(record.lastTransmission.transmittedAtMs).toISOString():'Unknown'],
        ['Configuration revision',record.configurationRevision],['Generation',`${record.generation.epoch}:${record.generation.sequence}`],['Operation',action.requestId??'None'],
        ['Held operation',held?.requestId??'None'],['Command outcome',action.text],
        ['Maximum-on enabled',limitRecord?.enabled===true?'Yes':'No'],['Maximum-on duration',limitRecord===undefined?'Not configured':`${limitRecord.durationMs/60000} minutes`],
        ['Limit evidence',!limit.live?'Stale':limitRecord?.status??'Not configured'],['Observed run start',limitRecord?.startedAtMs==null?'Unknown':new Date(limitRecord.startedAtMs).toLocaleString()],
        ['Run deadline',limitRecord?.deadlineMs==null?'Unknown':new Date(limitRecord.deadlineMs).toLocaleString()],
        ['Shutoff attempt',limitRecord?.lastAttempt==null?'None':!operationsLive?'Operation evidence is stale':(()=>{const attempt=limitRecord.lastAttempt,operation=operations.find(value=>value.requestId===attempt.requestId&&value.target===record.id&&value.family==='power-set'&&value.requestedBy==='bunny/core');return operation===undefined?`${attempt.outcome}${attempt.reason===undefined?'':` (${attempt.reason})`}; no current operation record`:operationView(operation).text;})()],
      ]}/>
      <p>Auto-off requires the Hub running and a reachable plug. Unknown elapsed time with an enabled limit requests off. Disabling sends no power command. Command transmission does not establish visible lamp output.</p>
    </>}/>;
}
