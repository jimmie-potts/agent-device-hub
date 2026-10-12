## Why

The authorized artwork trial for [Hub #1054](https://github.com/jimmie-potts/agent-device-hub/issues/1054) exposed a Pixoo failure on installed revision 52ee8f28: artwork arriving for the same observation cancels a text-card upload already sent to the device and suspends Monitor. A deterministic native-adapter test reproduces this while the unchanged-input control succeeds.

## What Changes

- Allow an in-flight card for the unchanged playback observation and view to finish when only its artwork changes, then send the latest eligible card through the existing writer.
- Preserve cancellation for a different observation or view, attention, expiry, mode changes, player changes and close, and preserve truthful possible-effect outcomes.
- Add focused native-adapter regression checks and retain the original popup deadline.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-pixoo-module`: distinguish artwork replacement within the current observation from superseding its association or presentation eligibility during a card upload.

## Impact

Only Pixoo presentation and its owning tests/specification change. The existing Player and native transport remain the sole writer; schemas, state formats, playback acquisition, Tidbyt background rotation and runtime upgrade-profile ownership stay unchanged. Source delivery needs independent review and applicable CI. The established runtime needs a newly qualified exact upgrade before the physical trial can resume; source tests establish no physical acceptance.
