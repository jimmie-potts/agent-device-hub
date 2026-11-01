import {REPOSITORY,validateHostedQualification} from '../release/qualification.mjs';
import {validateMainAncestry} from './integration-proof.mjs';
import {operatorRefusal} from '../operator-refusal.mjs';
const admitted=new WeakMap(),byReceipt=new WeakMap();
const refuse=()=>{throw operatorRefusal('qualification');};
// Called only by the reviewed hosted API/artifact intake, after its genuine API readbacks and image load.
export function attestMaintenanceHelper(receipt,hosted,request) {
  try{validateHostedQualification(receipt,hosted,{repository:REPOSITORY,candidate:request.candidate});}catch{refuse();}
  if(receipt.runId!==request.runId||receipt.runAttempt!==request.runAttempt||!/^[a-f0-9]{64}$/.test(request.containerId??'')
    ||!/^sha256:[a-f0-9]{64}$/.test(request.previousImage??'')||!/^[a-f0-9]{40}$/.test(request.previousRevision??'')
    ||!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(request.project??''))refuse();
  const integratedMain=validateMainAncestry(receipt.candidate,hosted.main,hosted.comparisons);
  const capability=Object.freeze({});
  admitted.set(capability,Object.freeze({image:receipt.image.id,revision:receipt.candidate,integratedMain,
    baseline:Object.freeze({project:request.project,container:request.containerId,image:request.previousImage,revision:request.previousRevision})}));
  byReceipt.set(receipt,capability);return capability;
}
export const maintenanceHelperFor=receipt=>byReceipt.get(receipt);
export function maintenanceHelperDetails(capability) {const details=admitted.get(capability);if(details===undefined)refuse();return details;}
