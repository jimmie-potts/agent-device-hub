## Why

[Issue #684](https://github.com/jimmie-potts/agent-device-hub/issues/684) gives the existing art experience a waking-day rhythm without requiring an open browser or spending money on every appearance. The current core automation owner must arbitrate that rhythm so saved art, fresh source evidence, manual control and actual command outcomes remain distinct.

## What Changes

- Add one owner-controlled art policy to the current Automation workspace: waking hours on the runtime host's local clock, an adjustable six, seven or eight appearances, at least 45 minutes between appearances, ambient updates, selected configured surfaces and optional generation. Morning, daytime and evening opportunities vary within eligible windows.
- Keep durable opportunity claims and conservative appearance accounting under the core's existing private-store lease. Spacing uses the preceding claim's latest permitted start, including its tolerance. Final checks honor each attempt's own committed reservation while preventing unrelated work from borrowing it. Drop expired work and missed windows; restart plans only future opportunities. Reuse the existing quiet hours, budgets, interrupt policy, scheduler and tracked operations.
- Consume the narrow shared-art presentation API to prepare exact saved compositions and dispatch independent per-surface attempts, defaulting to 30 seconds on Tidbyt and 10 seconds on Pixoo within their declared capabilities. Add free saved ambient selection to the Art owner's existing staging and ambient lifecycle. Its one-use permission governs a new selection; an already-issued intent keeps its existing maintenance across schedule disable/restart, while a pending or refused replacement cannot become renewable. Generation remains optional and all paid calls remain inside the Art owner's separate provider ceilings, pace and loop guard.
- Add bounded deterministic rain-forecast notices beside decorative artwork on the browser, Tidbyt and Pixoo. A fresh, enabled weather source supplies typed evidence; a provider supplies no fact or label. Unsupported notice targets skip truthfully. Generated art retains `factual: false`.
- Expose enabled-source, next-opportunity, suppression and per-target operation evidence in the existing Automation page. Preserve gallery choices, layout pins, device pins, attention, explicit pause, current-base restoration and owner controls.

The owner selected rain notices for the first release and deferred meeting notices on 2026-11-05. The [calendar source](https://github.com/jimmie-potts/agent-device-hub/issues/298) and a later presentation pickup retain their own acceptance and personal-source permission. This release has no calendar reader, meeting control or invented milestone. These are planning artifacts; implementation waits for the coordinator to release the accepted integration inputs.

## Capabilities

### New Capabilities

None. Scheduling, art, presentation and display ownership already exist.

### Modified Capabilities

- `bunny-runtime`: one art policy and bounded scheduler in the current automation owner, durable claims, arbitration, source gates, tracked dispatch and authenticated controls.
- `bunny-art`: free saved ambient selection, explicit automatic weather-use policy and the separation of decorative image provenance from factual presentation notices.
- `runtime-dashboard`: art schedule controls and truthful evidence in Automation, and a deterministic expiring notice beside the exact decoded artwork.
- `runtime-tidbyt`: capability-gated deterministic notice treatment alongside exact art, retaining its current display writer and takeover protections.
- `bunny-pixoo-module`: capability-gated deterministic notice treatment alongside exact art, retaining Monitor/Media semantics and current-base restoration.

## Impact

Implementation is concentrated in `apps/runtime/src/core/automation-part.ts`, its existing store and a bounded art-schedule helper; `apps/runtime/src/gateway/automation-routes.ts`; the current dashboard Automation page; the Art owner's commands and frontend; and the two display owners' existing art render paths. The shared event package gains only the closed minor schemas needed for the rain notice, explicit automatic weather use and free ambient action. One core-owned `art-schedule` state family carries policy and current scheduling evidence to existing authenticated consumers without polling. Existing 2.0/2.1/2.2 payloads keep their exact shapes; no retained controller 1.x or cross-repository controller API changes.

The design consumes the accepted producer, display, widget and shared presentation interfaces linked by the owning issue. It introduces no generic scheduler, public ingestion route, cloud credential, new device writer, model retry, device-mode change or installation operation. Disposable synthetic acceptance is part of source delivery; the selected installation and waking-day/physical observations remain with [#687](https://github.com/jimmie-potts/agent-device-hub/issues/687).
