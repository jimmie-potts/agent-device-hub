import type {PlaybackCheckpoint} from '@pixoo/library';
export function cycle(record:PlaybackCheckpoint,random:()=>number,previous?:string):string[] {
  const order=record.snapshot.items.map(item=>item.id);
  if(record.snapshot.shuffle){
    for(let i=order.length-1;i>0;i--){const value=random();if(!Number.isFinite(value)||value<0||value>=1)throw new RangeError('Random must be in [0,1)');const j=Math.floor(value*(i+1));[order[i],order[j]]=[order[j]!,order[i]!];}
    if(order.length>1 && order[0]===previous)[order[0],order[1]]=[order[1]!,order[0]!];
  }
  return order;
}
export function next(record:PlaybackCheckpoint,random:()=>number):boolean {
  if(record.historyCursor!==null){
    if(record.historyCursor<record.history.length-1){record.currentItemId=record.history[++record.historyCursor]!;return true;}
    if(!record.frontierPlayed){record.currentItemId=record.order[record.cursor]!;record.historyCursor=null;return true;}
  }
  if(record.cursor+1===record.order.length){
    if(!record.snapshot.repeat)return false;
    record.order=cycle(record,random,record.currentItemId);record.cursor=0;
  }else record.cursor++;
  record.currentItemId=record.order[record.cursor]!;record.historyCursor=null;record.frontierPlayed=false;return true;
}
export function previous(record:PlaybackCheckpoint):void {
  if(!record.history.length)return;
  record.historyCursor=record.historyCursor===null?record.history.length-1:Math.max(0,record.historyCursor-1);
  record.currentItemId=record.history[record.historyCursor]!;
}
export function started(record:PlaybackCheckpoint):void {
  if(record.historyCursor!==null)return;
  record.history.push(record.currentItemId);
  if(record.history.length>10000)record.history.shift();
  record.historyCursor=record.history.length-1;record.frontierPlayed=true;
}
export function upcoming(record:PlaybackCheckpoint):string|undefined {
  if(record.historyCursor!==null && record.historyCursor<record.history.length-1)return record.history[record.historyCursor+1];
  return record.order[record.cursor+1];
}
