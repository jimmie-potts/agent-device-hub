import type {LegacyWall} from './model.js';
import type {PrismLayout} from './prism.js';
export const PrismAdapters: {fromState(state: LegacyWall, colors: (element: LegacyWall['lines'][number]) => [string, string]): PrismLayout};
