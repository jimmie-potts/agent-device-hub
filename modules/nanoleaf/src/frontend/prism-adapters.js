// Retained renderer source; provenance in README.md.
/* Pure wall-state adapter. Controller orientation and Y inversion belong to the backend. */

 function fromState(state,resolveColors){
  const graph=state?.connector_layout, settings=state?.settings;
  if(graph?.version!==1||!Array.isArray(graph.nodes)||!graph.nodes.length||graph.nodes.length>600||!Array.isArray(graph.lines)||!graph.lines.length||graph.lines.length>300||!Array.isArray(state.lines)||state.lines.length!==graph.lines.length)throw Error('Connector layout unavailable.');
  if(!settings||![0,90,180,270].includes(settings.rotation)||![0,1].includes(settings.flip_x)||![0,1].includes(settings.flip_y))throw Error('Invalid map transform.');
  const angle=settings.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),ids=new Set(),lineIds=new Set(),zones=new Set();
  const nodes=graph.nodes.map(node=>{
   if(typeof node.id!=='string'||!node.id||ids.has(node.id)||!Number.isFinite(node.x)||!Number.isFinite(node.y))throw Error('Invalid connector position.');
   ids.add(node.id);return {id:node.id,x:(node.x*c-node.y*s)*(settings.flip_x?-1:1),y:(node.x*s+node.y*c)*(settings.flip_y?-1:1)};
  });
  const current=new Map(state.lines.map(line=>[line.id,line]));
  if(current.size!==state.lines.length)throw Error('Duplicate physical Line.');
  const numbers=new Set();
  const lines=graph.lines.map(line=>{
   const known=current.get(line.id);
   if(typeof line.id!=='string'||lineIds.has(line.id)||!known||!Number.isInteger(line.number)||line.number<1||known.number!==line.number||numbers.has(line.number)||!ids.has(line.a)||!ids.has(line.b)||line.a===line.b)throw Error('Line identities differ from connector geometry.');
   if(!Array.isArray(line.zoneIds)||line.zoneIds.length!==2||line.zoneIds.some(id=>!Number.isInteger(id)||id<0||id>65535||zones.has(id))||line.zoneIds[0]===line.zoneIds[1])throw Error('Invalid ordered light zones.');
   const colors=resolveColors(known,state);
   if(!Array.isArray(colors)||colors.length!==2||colors.some(color=>typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color)))throw Error('Invalid resolved Line colors.');
   lineIds.add(line.id);numbers.add(line.number);line.zoneIds.forEach(id=>zones.add(id));
   return {id:line.id,number:line.number,a:line.a,b:line.b,zoneIds:[...line.zoneIds],colors:[...colors]};
  });
  return {version:1,nodes,lines};
 }
 export const PrismAdapters={fromState};

