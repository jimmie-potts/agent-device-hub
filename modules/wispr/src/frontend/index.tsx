import type {FrontendContribution} from '@jimmie-potts/sdk/frontend';
import {WisprPage} from './wispr.js';
export {WisprWidget} from './wispr.js';
export const frontend:FrontendContribution={module:'wispr',pages:[{id:'analytics',Component:WisprPage}]};

export {WisprCard, type WisprCardProps} from './wispr-card.js';
export {wisprSummary, type WisprSummary, type WisprDay} from './wispr-card-data.js';
