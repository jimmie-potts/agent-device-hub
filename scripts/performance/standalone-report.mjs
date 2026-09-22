// Targets are fixed before qualification, not learned from favorable samples.
export const targets=Object.freeze({samples:200,hookP95Ms:{1:250,10:500},consumerP95Ms:1500,hardHookMs:3000,readinessMs:5000,hubRssMiB:256});
const scenarios=['confinement','startup','burst','dashboard','control','stalledConsumer','offlineConsumer','hostOutage','restart','exclusiveOwner','noReplay'];
const valid=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const percentile=(xs,p)=>[...xs].sort((a,b)=>a-b)[Math.ceil(xs.length*p)-1];
export function evaluate(report){
 const problems=[...(report.failures??[])],profiles=[];
 for(const tasks of [1,10]){
  const matches=(report.profiles??[]).filter(p=>p.tasks===tasks),p=matches[0];
  if(matches.length!==1||p.samples?.length!==targets.samples){problems.push(`incomplete-profile-${tasks}`);continue;}
  const summary={tasks,samples:p.samples.length};
  for(const key of ['hookMs','pixooMs','nanoleafMs']){
   const values=p.samples.map(s=>s[key]);
   if(!values.every(valid)){problems.push(`invalid-${tasks}-${key}`);continue;}
   summary[key]={p95:percentile(values,.95),max:Math.max(...values),p99:null};
   if(summary[key].p95>(key==='hookMs'?targets.hookP95Ms[tasks]:targets.consumerP95Ms))problems.push(`target-${tasks}-${key}`);
   if(key==='hookMs'&&summary[key].max>targets.hardHookMs)problems.push(`hard-deadline-${tasks}`);
  }
  profiles.push(summary);
 }
 for(const key of scenarios)if(report.scenarios?.[key]!==true)problems.push(`scenario-${key}`);
 if(!Array.isArray(report.allHookMs)||report.allHookMs.length<targets.samples*2||!report.allHookMs.every(n=>valid(n)&&n<=targets.hardHookMs))problems.push('hard-deadline');
 if(!valid(report.peakHubRssMiB)||report.peakHubRssMiB>targets.hubRssMiB)problems.push('hub-rss');
 return {qualified:problems.length===0,problems,profiles,targets};
}

// A full receipt is larger than a pipe buffer. Await the write before exit.
export function writeReport(result){
 return new Promise((resolve,reject)=>process.stdout.write(JSON.stringify({result})+'\n',error=>error?reject(error):resolve()));
}
