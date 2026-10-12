## Why

Installed acceptance for [#1044](https://github.com/jimmie-potts/agent-device-hub/issues/1044) exposed a mismatch between the reader's required result pipe and Android's raw ADB socket output. The configured module can reach the device but receives no metadata, preventing the selected title-history release.

## What Changes

- Supply a pipe to the fixed reader while forwarding its result to the existing raw ADB channel.
- Preserve the reader's exit status, suppressed startup output, deadline and refusal of unsafe descriptors.
- Reproduce the mismatch with the actual Java reader on synthetic Android surfaces and socket-backed shell output.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `onn-title-history`: require the selected fixed invocation to deliver bounded reader results through raw ADB while preserving failures.

## Impact

Only the fixed ONN invocation, its regression checks and owning documentation/specification change. The shipped Dex, Java source, metadata schema, selected fields, queues, stores, APIs, credentials and dashboard retain their contracts. Source verification cannot establish the next installed-client or physical acceptance. No device effects are authorized by this change.
