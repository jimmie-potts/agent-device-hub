// Parallel with Node's ordinary spec reporter; publish only bounded count metadata.
import {relative} from 'node:path';
export default async function* (events){
 for await(const event of events){
  if(event.type!=='test:summary')continue;
  const {file,counts,success}=event.data;
  yield JSON.stringify({file:file?relative(process.cwd(),file):null,counts,success})+'\n';
 }
}
