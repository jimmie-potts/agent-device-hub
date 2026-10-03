const text=value=>value?.stringValue;
const field=(span,key)=>span.attributes[key]?.stringValue??span.attributes[key]?.intValue;
const patterns=[
  ['hub','bunny.http','operation.completed','queued','source','http'],
  ['hub','bunny.controller','operation.completed','queued','observation','client'],
  ['nanoleaf-controller','bunny.controller','command.admitted','queued','source','controller'],
  ['nanoleaf-controller','bunny.queue','command.queued','queued','source','queue'],
  ['nanoleaf-controller','bunny.queue','operation.completed','accepted','source','queue'],
  ['nanoleaf-worker','bunny.controller','command.executing','accepted','source','worker'],
  ['nanoleaf-worker','bunny.controller','command.completed','transport-acknowledged','source','worker'],
];

/** Independent shape for this successful synthetic brightness workload. Delivery
 * accounting cannot detect a producer that silently omits a whole stage. Fault
 * and rejection scenarios need their own expected shapes, not this success one. */
export function assessCommandDiagnostics({commands,logs,spans}) {
  if(!Array.isArray(commands) || !commands.length || commands.length>1800 || !Array.isArray(logs) || !Array.isArray(spans) ||
    logs.length>20000 || spans.length>20000)throw new Error('Command diagnostic input invalid');
  let shapeFailures=0,correlationFailures=0;
  const traces=new Set(commands.map(command=>command.traceId));
  if(traces.size!==commands.length)shapeFailures++;
  if(logs.length!==commands.length*7 || spans.length!==commands.length*6)shapeFailures++;
  const byTrace=(rows,get)=>{
    const groups=new Map();
    for(const row of rows){const id=get(row);if(!traces.has(id))shapeFailures++;const group=groups.get(id)??[];group.push(row);groups.set(id,group);}
    return groups;
  };
  const logGroups=byTrace(logs,row=>row.fields.trace_id),spanGroups=byTrace(spans,row=>row.traceId);
  for(const command of commands) {
    const currentLogs=logGroups.get(command.traceId)??[],currentSpans=spanGroups.get(command.traceId)??[];
    const select=(service,scope,name,kind,outcome)=>{
      const found=currentSpans.filter(span=>text(span.resource['service.name'])===service && span.scope.name===scope &&
        span.name===name && span.kind===kind && field(span,'bunny.outcome')===outcome);
      if(found.length!==1)shapeFailures++;
      return found.length===1?found[0]:null;
    };
    const roles={
      http:select('hub','bunny.http','bunny.command.request',2,'queued'),
      client:select('hub','bunny.controller','bunny.command.request',3,'queued'),
      automatic:select('hub','bunny.controller','bunny.command.request',3,undefined),
      controller:select('nanoleaf-controller','bunny.controller','bunny.command.request',2,'queued'),
      queue:select('nanoleaf-controller','bunny.queue','bunny.command.queue',1,'accepted'),
      worker:select('nanoleaf-worker','bunny.controller','bunny.command.execute',1,'transport-acknowledged'),
    };
    const ids=new Set(currentSpans.map(span=>span.spanId));
    if(ids.size!==6 || currentSpans.length!==6)shapeFailures++;
    const parents={http:command.parentId,client:roles.http?.spanId,automatic:roles.client?.spanId,
      controller:roles.automatic?.spanId,queue:roles.controller?.spanId,worker:roles.queue?.spanId};
    const instance=text(roles.http?.resource['service.instance.id']);
    for(const [role,span] of Object.entries(roles)) {
      if(!span)continue;
      if(!parents[role] || span.parentSpanId!==parents[role] || span.flags!==1 ||
        text(span.resource['service.instance.id'])!==instance || field(span,'bunny.ticket.epoch')!==command.requestId.epoch ||
        field(span,'bunny.ticket.sequence')!==String(command.requestId.sequence) || field(span,'bunny.operation')!=='brightness' ||
        field(span,'bunny.controller.id')!==command.controllerId || field(span,'bunny.device.id')!==command.deviceId)correlationFailures++;
      const links=role==='worker'?[{traceId:command.traceId,spanId:roles.controller?.spanId,flags:1}]:[];
      if(JSON.stringify(span.links)!==JSON.stringify(links))correlationFailures++;
    }
    for(const [service,scope,event,outcome,provenance,role] of patterns) {
      const found=currentLogs.filter(log=>log.fields.service_name===service && log.fields.scope_name===scope &&
        log.fields.event_name===event && log.fields.bunny_outcome===outcome && log.fields.bunny_provenance===provenance);
      if(found.length!==1){shapeFailures++;continue;}
      const fields=found[0].fields;
      if(fields.span_id!==roles[role]?.spanId || fields.service_instance_id!==instance || fields.bunny_operation!=='brightness' ||
        fields.bunny_ticket_epoch!==command.requestId.epoch || fields.bunny_ticket_sequence!==String(command.requestId.sequence) ||
        fields.bunny_controller_id!==command.controllerId || fields.bunny_device_id!==command.deviceId)correlationFailures++;
    }
  }
  return {complete:shapeFailures+correlationFailures===0,operations:commands.length,shapeFailures,correlationFailures};
}

/** Expected diagnostic cardinalities for the fixed qualification sequence. */
export function assessFaultDiagnostics({qualification,logs,spans}) {
  if(qualification?.complete!==true || qualification.requests?.length!==13 || !Array.isArray(logs) || !Array.isArray(spans)) {
    return {complete:false,shapeFailures:1,correlationFailures:0};
  }
  let shapeFailures=0,correlationFailures=0,duplicate=0;
  if(logs.length!==49 || spans.length!==48)shapeFailures++;
  const requested=new Set(qualification.requests.map(value=>value.traceId));
  const unknown=[...new Set(spans.map(value=>value.traceId))].filter(value=>!requested.has(value));
  if(unknown.length!==1)shapeFailures++;
  for(const request of qualification.requests) {
    let expected;
    switch(request.scenario) {
      case 'duplicate-ticket':expected=duplicate++===0?[7,6]:[3,4];break;
      case 'concurrent-capacity':expected=request.answer.code==='capacity'?[2,2]:[7,6];break;
      case 'rejected-admission':expected=[3,4];break;
      case 'unauthenticated-context':case 'private-query':expected=[0,0];break;
      case 'private-payload':expected=[1,1];break;
      case 'throwing-diagnostic-observer':expected=[2,3];break;
      case 'queued-success':case 'timeout-after-admission':case 'malformed-context':expected=[7,6];break;
      default:shapeFailures++;continue;
    }
    const malformed=request.scenario==='malformed-context',traceId=malformed?unknown[0]:request.traceId;
    if(malformed && (logs.some(log=>log.fields.trace_id===request.traceId) || spans.some(span=>span.traceId===request.traceId)))correlationFailures++;
    const currentLogs=logs.filter(log=>log.fields.trace_id===traceId),currentSpans=spans.filter(span=>span.traceId===traceId);
    if(currentLogs.length!==expected[0] || currentSpans.length!==expected[1])shapeFailures++;
    if(!expected[1])continue;
    const roots=currentSpans.filter(span=>text(span.resource['service.name'])==='hub' && span.scope.name==='bunny.http');
    if(roots.length!==1){shapeFailures++;continue;}
    const root=roots[0],instance=text(root.resource['service.instance.id']),ids=new Map(currentSpans.map(span=>[span.spanId,span]));
    if(ids.size!==expected[1])shapeFailures++;
    if(root.parentSpanId!==(malformed?null:request.parentId))correlationFailures++;
    const privatePayload=request.scenario==='private-payload';
    for(const span of currentSpans) {
      if(span!==root && !ids.has(span.parentSpanId))correlationFailures++;
      if(span.flags!==1 || text(span.resource['service.instance.id'])!==instance)correlationFailures++;
      if(!privatePayload && (field(span,'bunny.ticket.epoch')!==request.requestId.epoch ||
        field(span,'bunny.ticket.sequence')!==String(request.requestId.sequence)))correlationFailures++;
      if(span.name==='bunny.command.execute') {
        const parent=ids.get(span.parentSpanId),admission=parent?ids.get(parent.parentSpanId):null;
        if(parent?.name!=='bunny.command.queue' || text(admission?.resource['service.name'])!=='nanoleaf-controller' ||
          JSON.stringify(span.links)!==JSON.stringify([{traceId,spanId:admission?.spanId,flags:1}]))correlationFailures++;
      } else if(span.links.length)correlationFailures++;
    }
    for(const log of currentLogs) {
      const f=log.fields,span=ids.get(f.span_id);
      if(!span || text(span.resource['service.name'])!==f.service_name || span.scope.name!==f.scope_name ||
        f.service_instance_id!==instance)correlationFailures++;
      if(!privatePayload && (f.bunny_ticket_epoch!==request.requestId.epoch ||
        f.bunny_ticket_sequence!==String(request.requestId.sequence)))correlationFailures++;
      if(['rejected-admission','private-payload'].includes(request.scenario) || request.answer.code==='capacity') {
        if(f.bunny_outcome!=='rejected')shapeFailures++;
      }
      if(request.scenario==='timeout-after-admission' && f.service_name==='hub' && f.bunny_outcome!=='uncertain')shapeFailures++;
    }
  }
  return {complete:shapeFailures+correlationFailures===0,shapeFailures,correlationFailures};
}
