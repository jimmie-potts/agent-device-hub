## Context

See proposal.md. The current Tidbyt module has no browser entry and declares all device controls unsupported. Its public device/2.0 record contains cloud availability and lastTransmission, while exact frames and per-installation details remain private. The existing Pixoo public frontend and ModuleFrontend scope establish the composition pattern. Design is included because this change crosses the module/browser-shell boundary and must preserve asynchronous copy ownership.

## Goals / Non-Goals

**Goals:** A reusable module-owned presentation with a context adapter; one existing participant; honest source and freshness labels; accessible stable artwork and animated information faces.

**Non-Goals:** Backend API/state changes, new commands, inferred tile configuration, exact frame reconstruction, separate transport, durable browser state, general widget arrangement or changes to the cloud writer.

## Decisions

- Export the pure card and its shell-context adapter from an explicit browser-only frontend subpath. Declare existing module API 1.3, required by the SDK for React contributions, add one manifest page and compose the adapter on Home/device. This keeps the shell responsible for mounting/authentication and Tidbyt responsible for presentation. A shell-only special case would duplicate presentation and prevent module reuse.
- Follow device records through the scoped API with explicit cleanup of active and late copies. Preserve the previous record only as stale until replacement membership is committed. A shell-connected boolean alone cannot establish owner freshness. No timers read state, and retries are explicit read-only sync attempts.
- Reuse glass tokens, tab/flip styles and reduced-motion handling. Keep the illustrative device outside the changing information panels. A faithful last-pushed image would require the separately unselected contract in #363, so the visual is labelled Illustration and contains no actual content.
- Render cloud evidence and its absolute timestamp without additional polling. Show automatic status and optional now-playing information as supported integration behavior, not a configured installation list. Offer no control or disabled control placeholder.

## Risks / Trade-offs

- [Cloud availability mistaken for visible output] → Use cloud labels and explicitly state that the physical display is unobserved.
- [Reconnect briefly promotes stale membership] → Gate on owner sync and replace the full snapshot; hold that sync in a browser regression.
- [Late copy after route unmount leaks a subscription] → Close it and ignore callbacks; cover the lifetime with focused deterministic checks.
- [The illustration is less informative than an exact preview] → Label it and keep #363 separate; no private tile contents or installation identifiers enter a new contract.

## Migration Plan

No stored schema or format changes. Deliver the reviewed source through normal CI and the qualified established-runtime procedure, preserving configuration, credentials, hooks and existing tile startup/resume behavior. Retain the stopped-writer backup and compare protected inputs. Check the installed card passively with command routes guarded; physical evidence is not selected. A failed installed effect requires the procedure's inspected disposition, not an automatic state restore or device retry.
