// Type-only browser entry for fixed, shipped React contributions (Hub #932). Import no Node module implementation.
import type {ComponentType, ReactNode} from 'react';
import type {ErrorBody} from '@jimmie-potts/event-contracts/v2/errors';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';
import type {SyncHandler, SyncResult} from './remote.js';

/** An explicit command; acceptance is separate from the operation's completed or uncertain outcome. */
export type FrontendAction = {family: string; target: string; data: object; requestId: string};
export type FrontendActionReply = {status: 'accepted'; requestId: string} | ErrorBody;
export type FrontendCommand = {
  readonly text: string;
  readonly locked: boolean;
  readonly requestId: string | undefined;
  run(action: FrontendAction | string): Promise<void>;
};

/** Authenticated facilities owned by one mounted module page. No token, storage or device transport is exposed. */
export type FrontendApi = {
  /** Reads a runtime JSON route. The feature checks the document's schema before using it. */
  read(path: string): Promise<unknown>;
  /** Reads an image from this module's content references with the same authentication and page lifetime. */
  image(path: string): Promise<Blob>;
  /** Sends once through the core's tracked command boundary, without automatic retry. */
  command(action: FrontendAction): Promise<FrontendActionReply>;
  /** Syncs this module's families on the shell's existing participant; the page closes the copy when done. */
  sync<T extends object>(families: readonly string[], changed: SyncHandler<T>): Promise<SyncResult<T>>;
};

/** Shared shell components, with the same props as the dashboard's existing UI. */
export type FrontendUi = {
  Badge: ComponentType<{children: ReactNode; warning?: boolean}>;
  Facts: ComponentType<{items: readonly (readonly [string, ReactNode])[]; className?: string}>;
  InfoTip: ComponentType<{label: ReactNode; children: ReactNode; warning?: boolean}>;
  Select: ComponentType<{label: string; value: string; onChange: (value: string) => void; options: readonly {value: string; label: string}[]}>;
  /** The existing command attempt UI behavior, including retained identities, outcomes and no resend after reload. */
  Command: ComponentType<{context: FrontendContext; target: string; children: (command: FrontendCommand) => ReactNode}>;
};

export type FrontendContext = {
  readonly module: string;
  readonly api: FrontendApi;
  readonly ui: FrontendUi;
  readonly connected: boolean;
  readonly control: boolean;
  readonly operations: readonly OperationRecord[];
  readonly operationsLive: boolean;
};

/** Export as `frontend` from a module package's explicit `./frontend` browser entry. */
export type FrontendContribution = {
  readonly module: string;
  readonly pages: readonly {readonly id: string; readonly Component: ComponentType<{context: FrontendContext}>}[];
};
