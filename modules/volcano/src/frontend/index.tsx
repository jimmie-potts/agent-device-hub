// The Volcano's browser entry (Hub #616): one reusable card with no page of its own, as the owner decided on 2026-11-03.
// The shell places it on Home and in the Devices directory.
import type {FrontendContribution} from '@jimmie-potts/sdk/frontend';

export {VolcanoWidget} from './volcano-card.js';
export type {VolcanoWidgetProps} from './volcano-card.js';
export const frontend: FrontendContribution = {module: 'volcano', pages: []};
