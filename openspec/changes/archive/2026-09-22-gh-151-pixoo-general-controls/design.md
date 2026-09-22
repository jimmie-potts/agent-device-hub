## Context

See proposal.md. The delivered component view already pins drafts to the observed revision, request ticket and generation, serializes reads and writes per device, locks uncertain results and preserves drafts across refreshes. The hub forwards any valid controller v1 request on `/api/controllers/v1/<alias>/commands` after credential, device-alias and scope checks, so power, brightness and media commands need no hub change.

Inspection of Pixoo `main` (c81bc31) shows the real controller declares `power`, `brightness` 0–100 and `media` with actions pause, resume, stop, next, previous and clear plus discovered playlist IDs, while `modes` is unsupported on controller v1. Pixoo accepts Monitor/Media changes only through its integration extension's `mode` operation, which the hub already validates and routes. The existing browser fixture instead declared controller v1 modes for Pixoo, so the delivered Pixoo mode control could not work on the real device. This is the reassessment trigger named in the issue.

## Goals / Non-Goals

**Goals:**
- One guarded command per control, with the existing draft, conflict and lock behavior.
- Availability computed from declared capability, control scope and Pixoo mode, with every reason visible.
- Fixtures that match the real Pixoo declaration so browser evidence reflects the shipped controller.

**Non-Goals:**
- Nanoleaf power, brightness and scenes (Hub #153 after Nanoleaf #64), playlist names (Pixoo #67), hub MCP media tools (Hub #152), rendition selection, exact previews, desk presets, installation and physical acceptance (Hub #154).

## Decisions

- Render a general-controls section in the common component view for every component and drive each control from the controller v1 capability object. Unsupported capabilities render disabled controls naming the capability, matching ADR 0005's rule that Tidbyt, LIFX and PC lighting appear as unavailable. Alternative: Pixoo-only controls; rejected because Nanoleaf and future controllers would need a second pattern.
- Power and brightness reuse the existing draft form: the draft pins the observed snapshot, a changed revision blocks submission, and uncertain or partial results lock the form. Playlist start, playback actions and the Media switch are one-click commands that use the latest observed snapshot's ticket, revision and generation at activation time and stay busy until the refreshed snapshot arrives, so a following activation carries fresh guards; a stale revision surfaces as the controller's typed `revision-conflict` failure and the action stays available, while an uncertain result locks the group. Only an accepted ticket is watched for its terminal outcome, because a rejected ticket can be consumed by another client. Alternative: drafts for actions and playlist start; rejected because an action has no editable value and a playlist start is an action with a parameter.
- The brightness draft starts from desired evidence, then observed evidence; when both are unknown the slider starts at the range midpoint and the hint says the current brightness is unknown, so missing evidence is never shown as a value.
- Pixoo Monitor gating reads the integration snapshot's `configuration.mode` and `pendingMode`. Content controls are enabled only when the observed mode is `media` and no mode change is pending. The one-click switch submits the integration `mode` command for `media` with the integration snapshot's request ID, revision and generation, the same command the Pixoo mode form submits. Alternative: gate on controller v1 desired mode; rejected because the real Pixoo reports it unknown.
- The Pixoo mode form submits the integration extension `mode` operation, and the fake Pixoo controller declares controller v1 modes unsupported, like the real device. The generic controller v1 mode form still renders for controllers that declare modes (Nanoleaf). Alternative: keep the v1 mode form for Pixoo; rejected because the real controller returns `unsupported-capability` for it.
- Brightness uses a labelled range input with a visible value; power uses a two-value select; playlists use a select of declared IDs. Playback actions use one button per declared action, with a stable order.
- The fake Pixoo controller applies power, brightness and media commands to its snapshot (desired power/brightness, pending list and last outcome) and answers revision conflicts, so browser scenarios observe real receipt paths rather than routed stubs.

## Risks / Trade-offs

- [Transport success mistaken for a physical result] → every status keeps the existing "Physical result is not confirmed" wording, and screen power text explains pause/no-resume.
- [A pending mode change hides the reason for disabled content controls] → the gating reason names the observed and pending modes.
- [Six action buttons submitted rapidly exceed the per-device queue] → the existing bounded queue rejects extra work with `capacity`, shown as a typed failure without locking; buttons are disabled while a command is in flight.
- [Fixture drift from the real Pixoo] → the fixture's declared capabilities are pinned to the Pixoo `main` revision inspected above and recorded in the dashboard README; Hub #154 verifies the physical device.

## Migration Plan

No stored state, wire contract or configuration changes. The rebuilt static assets ship with the hub package as before; rollback is the previous source package.
