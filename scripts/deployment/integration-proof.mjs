import {operatorRefusal} from '../operator-refusal.mjs';
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const refuse=()=>{throw operatorRefusal('qualification');};
export function validateMainAncestry(candidate,mainPages,comparisons) {
  if(!sha(candidate)||!Array.isArray(mainPages)||mainPages.length!==1||mainPages[0]?.ref!=='refs/heads/main'
    ||mainPages[0].object?.type!=='commit'||!sha(mainPages[0].object.sha)||!Array.isArray(comparisons)||comparisons.length<1)refuse();
  const main=mainPages[0].object.sha,first=comparisons[0],same=candidate===main;
  const count=first?.total_commits;
  if(!Number.isSafeInteger(count)||count<0||same&&count!==0||!same&&count<1)refuse();
  const commits=[];
  for(const page of comparisons) {
    if(page?.base_commit?.sha!==candidate||page.merge_base_commit?.sha!==candidate||page.status!==(same?'identical':'ahead')
      ||page.behind_by!==0||page.ahead_by!==count||page.total_commits!==count||!Array.isArray(page.commits))refuse();
    for(const commit of page.commits){if(!sha(commit?.sha))refuse();commits.push(commit.sha);}
  }
  if(commits.length!==count||new Set(commits).size!==count||!same&&commits.at(-1)!==main)refuse();
  return main;
}
