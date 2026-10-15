import type {QualifiedModeModule} from './mode-participants.js';
/** Host admission only. Current capability and availability still come from the named owner's SDK copy. */
export type AutomationDevice={readonly id:string;readonly owner:string};
export function checkAutomationDevices(devices:readonly AutomationDevice[]):readonly AutomationDevice[] {
  const ids=new Set<string>();
  return Object.freeze(devices.map(({id,owner})=>{
    if(id.length>128 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) || !/^bunny\/modules\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(owner) || ids.has(id))
      throw new Error('invalid-automation-devices');
    ids.add(id);return Object.freeze({id,owner});
  }));
}
export function automationDevices(modules:readonly QualifiedModeModule[]):readonly AutomationDevice[] {
  return checkAutomationDevices(modules.flatMap(module=>module.admitted?module.devices.map(id=>({id,owner:`bunny/modules/${module.name}`})):[]));
}
