## Why

The Pixoo display record said a moment was showing only for its last instant ([#1724](https://github.com/jimmie-potts/agent-device-hub/issues/1724)). The command that plays a moment runs for the moment's whole life, and while a command runs the module holds a change back for up to 1 s, so the command's completion can carry it. A one-second moment over a playing item was on the device for its full second, but the record read `showing: 'moment'` for about its last 100 ms. The owner decided on 2026-11-11 that this is a defect: the record says a moment is showing for as long as the device shows it.

## What Changes

- **Prompt publish:** when the Pixoo acknowledges a moment's picture, the display record goes out after the current turn, without the coalescing wait. Every other change still waits up to 1 s for a running command's completion.
- **Acknowledged moments only:** the record reports a moment (`showing` `moment` and `moments.playing`) only from the acknowledged write until the moment ends, so a failed or unanswered write is never reported as a moment. Until the write is answered, `showing` reports what the covered base shows: the dashboard over the status base, or `none` over a held item. Once a failed or unanswered write settles over the status base, the status base stops as it does for a failed dashboard, as before.
- **Unchanged:** the end of a moment, which the command's completion already carried at once; the Pixoo's command limits and write pacing; message formats and error shapes.

## Capabilities

### Modified Capabilities
- `bunny-pixoo-module`: when the display record reports a moment, and the one exception to the coalescing wait.

## Impact

Only `modules/pixoo` changes (`module.ts`, `monitor-presentation.ts`), with its tests and README. No contract, schema, storage or migration change. Installation follows a routine upgrade separately.

**No design.md.** The change adds one callback from the presentation to the module and one condition on two reported fields. It adds no concurrency, storage, migration, privacy or new interface beyond that callback, and the write pacing, the coalescing of other changes and the moment's own timing are unchanged. The owner's decision is recorded above.
