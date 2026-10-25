## Why

[#1097](https://github.com/jimmie-potts/agent-device-hub/issues/1097) adds an explicitly enabled spoken coding alert to the existing companion pipeline. Bounded qualification established a suitable local browser route; callbacks can still be uncertain, so the product must preserve that distinction.

## What Changes

- Add default-off speech controls and manual availability for one connected dashboard browser endpoint. Use an explicitly qualified local English voice without changing browser or system defaults.
- Reuse companion admission, policy and fixed text. Add one active and at most one pending spoken announcement, final live checks, coding priority, Stop and mute.
- Carry live speech commands and receipts through profile 2.0 over the existing authenticated SDK connection. Bind the browser grant to its current connection; never restore it through reconnect or sync.
- Track effects through the existing core dispatcher and module outcome owner. Distinguish callback completion, cancellation, failure and uncertainty from human perception.
- Preserve ordinary visual attention, synthetic scenario isolation, social allowance, existing module data and independent installed acceptance. Add no microphone, cloud TTS, call detector, robot writer or new transport.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bunny-companions`: Optional single-browser speech, manual session availability, bounded arbitration and truthful receipts.
- `bunny-sdk`: Connection-bound remote endpoint handlers and receipts that are never restored automatically.
- `bunny-runtime`: Narrow browser endpoint authority, live connection invalidation and tracked companion output through the existing core.

## Impact

The companions module and frontend, event payload registry, SDK remote edge/client and frontend API, runtime gateway/core and dashboard connection are affected. Existing profile 2.0 envelopes, errors, traces, private stores and HTTP/SSE transport remain authoritative under ADR 0012. Cross-repository contracts and retained 1.x consumers are unchanged. Source tests use fake synthesis and disposable runtime instances; the selected installed Mac desk check remains separate under #643.
