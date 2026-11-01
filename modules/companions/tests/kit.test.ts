import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {createCompanionsModule} from '../src/module.js';
moduleConformance({create: () => createCompanionsModule(), config: {}, serves: ['companion-state', 'assistant-state'],
  copies: {families: ['session', 'mode'], snapshot: {revision: 0, states: []}}});
