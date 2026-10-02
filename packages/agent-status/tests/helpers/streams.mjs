export const flush = () => new Promise(resolve => setImmediate(resolve));
export function clockTimers() {
  const clock={now:0},pending=new Set();
  const timers={setTimeout(callback,ms){const task={at:clock.now+ms,callback};pending.add(task);return task;},clearTimeout(task){pending.delete(task);}};
  const advance=async ms=>{const end=clock.now+ms;for(;;){const task=[...pending].filter(t=>t.at<=end).sort((a,b)=>a.at-b.at)[0];if(!task)break;pending.delete(task);clock.now=task.at;task.callback();await flush();}clock.now=end;await flush();};
  return {clock,timers,pending,advance};
}
export const projection=(revision=1,extra={})=>({apiVersion:'1.0',ownerId:'owner',revision,connection:'current',collector:'running',lossCount:0,admissionRejected:0,uncertain:0,...extra});
export const frame=(revision=1,kind='state',extra={})=>`id: 11111111-1111-4111-8111-111111111111:${revision}\nevent: ${kind}\ndata: ${JSON.stringify(projection(revision,extra))}\n\n`;
export function streamFetch() {
  const connections=[];
  const fetch=async(url,options)=>{
    let controller;const connection={url,options,cancelled:0};
    const body=new ReadableStream({start(c){controller=c;},cancel(){connection.cancelled++;}});
    connection.send=value=>controller.enqueue(typeof value==='string'?new TextEncoder().encode(value):value);
    connection.end=()=>controller.close();
    options.signal.addEventListener('abort',()=>{try{controller.error(new Error('aborted'));}catch{}},{once:true});
    connections.push(connection);return new Response(body,{headers:{'content-type':'text/event-stream'}});
  };
  return {fetch,connections};
}
