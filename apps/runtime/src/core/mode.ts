import type {DatabaseSync} from 'node:sqlite';
import type {StateDraft} from '@jimmie-potts/sdk';

/** The mode family's initial scaffold; behavior is defined by mode.test.ts before implementation. */
export class ModePart {
  readonly families = ['mode'] as const;
  readonly open = (_database: DatabaseSync): void => {};
  readonly states = (_families: readonly string[]): StateDraft[] => [];
}
