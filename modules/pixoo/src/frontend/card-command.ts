import {useRef, useState} from 'react';
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {FrontendCommand, FrontendContext} from '@jimmie-potts/sdk/frontend';

export function commandBlock(context: FrontendContext, device: DeviceRecord, live: boolean, command: FrontendCommand): string | undefined {
  const latest = context.operations.filter(operation => operation.target === device.id).sort((a, b) => b.sentAtMs === a.sentAtMs ? b.revision - a.revision : b.sentAtMs - a.sentAtMs)[0];
  const unsettled = latest !== undefined && (['sent', 'accepted', 'uncertain', 'conflict'].includes(latest.status) || latest.result === 'uncertain' || latest.result === 'conflict');
  return !context.control ? 'Read-only access.' : !context.connected || !live ? 'Pixoo records are stale.'
    : !context.operationsLive ? 'Command records are stale.' : command.locked || unsettled ? 'Wait for the current command result.'
      : device.held !== undefined ? 'Pixoo is held. Use advanced controls to resolve it.'
        : device.pending > 0 ? 'Wait for queued changes.' : undefined;
}
/** One explicit, guarded action. Accepted replies never trigger a follow-up action. */
export function useCardCommand(context: FrontendContext, device: DeviceRecord, live: boolean, command: FrontendCommand): {
  blocked: string | undefined; failure: string | undefined; send: (family: string, data: object) => void;
} {
  const submitting = useRef(false);
  const [failure, setFailure] = useState<string>();
  const blocked = commandBlock(context, device, live, command);
  return {blocked, failure, send: (family, data) => {
    if (blocked !== undefined || submitting.current) return;
    const action = {family, target: device.id, requestId: crypto.randomUUID(), data: {
      ...data, expectedConfigurationRevision: device.configurationRevision, expectedGeneration: device.generation,
    }};
    if (new TextEncoder().encode(JSON.stringify(action)).byteLength > 15 * 1024) {
      setFailure('This edit exceeds the command size limit. Nothing was sent.'); return;
    }
    submitting.current = true; setFailure(undefined);
    void command.run(action).catch(() => { setFailure('The request has no confirmed reply. It was not sent again.'); })
      .finally(() => { submitting.current = false; });
  }};
}
