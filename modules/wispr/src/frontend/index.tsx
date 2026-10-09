import type {FrontendContribution} from '@jimmie-potts/sdk/frontend';
import {WisprPage} from './wispr.js';
export {WisprWidget} from './wispr.js';
export const frontend:FrontendContribution={module:'wispr',pages:[{id:'analytics',Component:WisprPage}]};
