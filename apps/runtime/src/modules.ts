// The fixed, shipped module list (ADR 0012). Adding or removing a module is a code change here; nothing loads modules
// at run time.
import type {BunnyModule} from '@jimmie-potts/sdk';

export const shippedModules: readonly BunnyModule[] = [];
