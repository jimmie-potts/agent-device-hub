## Why

The owner needs to compare two local animations on the configured Tidbyt. Show now currently accepts only art from the private catalog. [Issue #1988](https://github.com/jimmie-potts/agent-device-hub/issues/1988)

## What Changes

- Accept a bounded, authenticated GIF upload at the Art module. Forward its exact bytes through Art's existing staging command to the configured Tidbyt.
- Allow an explicit Show now request for the temporary reference after the writer confirms staging. A local upload creates no library item or scheduled candidate.

## Capabilities

### Modified Capabilities

- `bunny-art` supports a temporary local GIF as an input to an owner-requested Tidbyt appearance.

## Impact

The Art module, its command contract and the core's Show now lookup share the temporary reference. Tidbyt keeps its existing validation, rendering, queue and release behavior.
