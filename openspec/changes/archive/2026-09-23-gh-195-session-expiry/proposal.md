## Why

[Hub #195](https://github.com/jimmie-potts/agent-device-hub/issues/195) replaces indefinite session retention with the owner's accepted personal-use policy. The installed owner filled its 128-session limit, then rejected every new identity and kept counting loss. That blocks [Tidbyt #21](https://github.com/jimmie-potts/agent-device-hub/issues/21), and it leaves old tasks holding the Nanoleaf wall's Lines.

## What Changes

- Forget a session after 24 hours without lifecycle evidence, freeing its capacity. Expiry is not acknowledgment, readership, success or cancellation.
- Expire from the maintenance timer, at startup and before each ingest, so a full owner frees slots before rejecting a new identity.
- A `runtime.ended` for an unknown identity, or any observation 24 hours or more before the owner clock, cannot create or renew a record.
- Publish new private agent-state and Hub package versions.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-state-core`: session expiry, and journal and capacity wording that separates expiry from retention and rejection.

## Impact

Shared agent-state source, tests and guide, plus Hub fixtures and package manifests. Expiry reuses the storage contract's existing `replace` commit, so storage adapters and the version 1.0 state and snapshot formats are unchanged. Consumers already treat a missing session as removed: Nanoleaf deletes its rows, Tidbyt hides children, and the dashboard renders each session independently. Installation remains separate. Archive removal is [Hub #218](https://github.com/jimmie-potts/agent-device-hub/issues/218).
