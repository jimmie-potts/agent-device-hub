// When a control may show a request beside a device's observed state (#1931). A LIFX bulb reports on its next read and
// a Wemo plug on its next poll, so for a while after a power or brightness request completes the device's record still
// holds the reading from before it. The device's desired value belongs to its latest request of that kind (a module
// sets it on acceptance and keeps it if the request then fails), so only that latest request decides: it counts when it
// completed successfully after the last reading. A later request that failed, was refused, expired, has an uncertain
// result or is still in flight leaves the observation in charge (an in-flight one also locks the controls). A write of
// another kind, or a reading taken since, does the same, so a request from long ago never overrides what the device
// reports now.
import type {DeviceRecord} from '@jimmie-potts/event-contracts/v2/devices';
import type {OperationRecord} from '@jimmie-potts/event-contracts/v2/families';

/** Whether the device's latest `family` request succeeded after its last reading. */
export function newerRequest(record: DeviceRecord, operations: readonly OperationRecord[], family: 'power-set' | 'brightness-set'): boolean {
  let latest: OperationRecord | undefined;
  for (const operation of operations) {
    if (operation.target !== record.id || operation.family !== family) continue;
    if (latest === undefined || operation.sentAtMs > latest.sentAtMs || operation.sentAtMs === latest.sentAtMs && operation.revision > latest.revision) latest = operation;
  }
  return latest !== undefined && latest.status === 'completed' && latest.result === 'succeeded'
    && (record.observed.status !== 'known' || latest.updatedAtMs > record.observed.observedAtMs);
}
