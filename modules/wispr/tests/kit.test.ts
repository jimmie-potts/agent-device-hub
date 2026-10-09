import {moduleConformance} from '@jimmie-potts/sdk/testing';
import {createWisprModule} from '../src/module.js';

// No families, commands, subscriptions or device transport: the kit checks the read-only module's manifest and lifecycle.
moduleConformance({create: createWisprModule, config: {sourceId: 'dictation', aggregatePath: '/nonexistent/synthetic-aggregate.json', diagnosticsPath: '/nonexistent/synthetic-status.json'}});
