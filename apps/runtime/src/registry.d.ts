// Every module folder's registration (Hub #999). The build writes `dist/src/registry.js` from `modules/*/package.json`
// (build/registry.ts): one static import of each module package's `registration`, in folder order, so the runtime ships
// a set fixed when it is built and loads nothing at run time (ADR 0012). This declaration types that file.
import type {ModuleRegistration} from '@jimmie-potts/sdk';

export declare const REGISTRATIONS: readonly ModuleRegistration[];
