import {isAbsolute,join} from 'node:path';

const runtime=(repository,name)=>Object.freeze({repository,runtime:name,proof:'install-receipt/1.0',portfolio:true,workflowLabels:true,instructions:Object.freeze(['AGENTS.md','README.md','docs/sdlc.md'])});
const tool=repository=>Object.freeze({repository,runtime:null,proof:'installed-files/1.0',portfolio:false,workflowLabels:false,instructions:Object.freeze(['AGENTS.md','README.md'])});
const policies=Object.freeze({
 'jimmie-potts/agent-device-hub':runtime('jimmie-potts/agent-device-hub','hub'),
 'jimmie-potts/codex-nanoleaf':runtime('jimmie-potts/codex-nanoleaf','nanoleaf'),
 'jimmie-potts/divoom-app-upgrade':runtime('jimmie-potts/divoom-app-upgrade','pixoo'),
 'jimmie-potts/agent-skills':tool('jimmie-potts/agent-skills'),
 'jimmie-potts/dotfiles':tool('jimmie-potts/dotfiles'),
});
export function closeoutPolicy(repository){
 if(!Object.hasOwn(policies,repository))throw new Error('unsupported-closeout-repository');
 return policies[repository];
}
export function completionLabels(policy,labels){
 return policy.workflowLabels?labels.filter(x=>!x.startsWith('status:')&&x!=='blocked'):[...labels];
}
export function acceptanceInstructions(config){
 const policy=closeoutPolicy(config.repository),p=config.planning;
 const owning=p?.owningCheckout??(policy.runtime==='hub'?p?.checkout:null);
 if(typeof owning!=='string'||!isAbsolute(owning)||typeof p.checkout!=='string'||!isAbsolute(p.checkout))throw new Error('owning-acceptance-checkout-missing');
 return [...new Set([...['docs/tracker-reconciliation.md','docs/project-maintenance.md','docs/sdlc.md'].map(path=>join(p.checkout,path)),...policy.instructions.map(path=>join(owning,path))])];
}
