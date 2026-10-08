## Context

[Hub #922](https://github.com/jimmie-potts/agent-device-hub/issues/922) finishes the existing runtime dashboard. The accepted scope is general device controls, declared module navigation and small running-build identification, with disposable source acceptance. The core action tracker, generic browser action helper, module manifests and device/operation families already own the required mechanisms. This change preserves #1006 labels and the existing Hub mode/inbox slots.

## Goals / Non-Goals

Restore the existing general cards and routes using current runtime records. Keep desired values, observation, transmission, admission and completion distinct. Do not implement later feature pages, automation, moment module support, a preview framework, migration, installation or physical acceptance.

## Decisions

The dashboard retains one SDK participant. It discovers modules through the authenticated catalog, then syncs each device owner by name, core operations and available playback families. Copies retain their last records while stale; transport recovery alone does not restore freshness. SDK snapshots replace membership. Catalog and failed sync reads use bounded backoff; they never resend actions.

General controls use the existing card patterns, CSS tokens and explicit gestures. Power and brightness work independently of native mode; Nanoleaf scenes require Free and Pixoo content requires Media, with mode changes always explicit. Every general device command includes the current configuration revision and generation. Playback uses its current revision. Unsupported controls are absent or explained, and read-only callers see no write controls. The copied manual Moments card remains capability-gated and uses the existing moment-play payload; it adds no invented guards. Current shipped modules advertise no moments, so no working moment device is claimed.

One gesture creates one request ID and calls `sendAction` through `POST /api/v2/commands/<family>`. The gateway authenticates the cookie, Origin and request header, then the core routes and tracks the command. The browser never addresses a device directly. Local admission failures say **Not sent**; core refusals say **Refused without changing state**. The existing action helper supplies the W3C trace, preserves registry refusal codes and request identity, and treats a lost or malformed reply as `uncertain-result`. No payload is added to logs or diagnostics.

The action route's accepted reply does not complete a control. The core's operation record supplies sent, accepted, rejected, expired, uncertain, conflict and completed states. `succeeded` with transmitted evidence says the physical effect was not observed; failed/uncertain results preserve their effect uncertainty. `revision-conflict`, `unsupported-capability`, `forbidden`, `unavailable`, `expired` and `uncertain-result` remain distinct. A new retry requires a new deliberate gesture. No write automatically retries or replays after reload, reconnect or timeout.

An unresolved action locks ordinary controls. Browser session storage keeps only attempt identifiers across reload; it holds no command values or credentials. Operation records are authoritative and a definitive outcome releases the lock. Explicit refresh reads current copies only. A held device remains visibly held; its advertised explicit mode command provides the existing guarded release path. Refresh alone never releases a hold.

Module navigation accepts only catalog-declared `/modules/<name>/<page>` paths. The shell uses a same-origin sandboxed iframe without scripts or forms. Only module page HTML changes to `SAMEORIGIN` and `frame-ancestors 'self'`; content responses keep their previous policy and the shell remains unframeable. Auth and Origin checks remain in force. No private file or installed service link is introduced.

The existing build step emits a frozen module with the runtime package version, Git revision when available, dirty flag and build timestamp. The authenticated read-only `/api/v2/build` route exposes those fields. The process retains its imported identity, with no Git subprocess per request. Existing disposable artifact copying already includes it. Preview remains the documented `verify:runtime start --scenario dashboard-controls` path; opening that run's origin shows the dashboard.

## Risks / Trade-offs

A disappeared operation is not proof that an uncertain request did nothing, so the browser keeps its local lock. Device recovery continues to follow the module's existing policy. No new general uncertainty-resolution command is introduced. The four current modules' unsupported moment declarations remain a source gap for #925's tracked-moment scenario.

## Validation

Focused red/green tests cover guards and outcome projection. Named-owner/stale-copy tests, route allowlisting and gateway refusal checks cover the changed boundaries. The dashboard-controls catalog scenario runs over both transports and in one disposable run. The focused browser journey checks bookmark sign-in, accepted then completed, uncertain lock across reload/refresh without replay, declared-page navigation, running build identity, keyboard activation and desktop/phone axe. Existing dashboard units, shared build/type/lint/contracts/workflow checks, hosted CI and independent reviews remain required. Source evidence does not establish installation or physical accuracy.
