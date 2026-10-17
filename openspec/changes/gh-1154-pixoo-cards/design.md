## Context

See proposal.md and [#1154](https://github.com/jimmie-potts/agent-device-hub/issues/1154). The shell already exposes ModuleFrontend for module-owned widgets and pages. Pixoo already owns catalog, previews, revision-guarded playlist commands and frozen player sessions.

## Goals / Non-Goals

Goals: reuse the approved controls without another participant or device writer; preserve durable owner state, bounded media reads and tracked outcomes. Non-goals: new device services, room composition, general widget arrangement, physical tests or replacement of advanced media editors.

## Decisions

- Export PixooDisplay, MediaPicker and PlaylistEditor through the existing browser-only entry. The shell mounts PixooDisplay through ModuleFrontend on Home/device pages; Player uses the same component. UI state stays local; all durable data stays with Pixoo.
- Retain the authenticated catalog and frame references. A bounded visible page owns cancellable previews; complete frame sets animate locally and close on hide/unmount. Reduced motion starts still. No browser preview claims optical device state.
- Extend the existing create operation with optional playlistId and items. The library validates supplied identity and renditions before one transaction creates both name and initial contents. Legacy create remains valid. No new message family or state owner is introduced. A failed create leaves no partial empty row; unknown outcomes never resend.
- Keep draft, saved playlist and active session separate. Save carries the captured playlist revision; explicit restart uses existing player control. New playlists repeat. An older non-repeating playlist requires an explicit options save before Play becomes available, avoiding automatic multi-command continuation after acceptance.
- The Pixoo catalog closes its stale copy on disconnect and creates a fresh copy on reconnect. Player reads follow that freshness; recovery repeats observations only, never mutations.
- All writes use the context's retained Command component, fresh owner records and configuration/generation guards. Stale, held, read-only, unsupported and uncertain states block the affected action. Errors, outcomes, traces and recovery retain ADR 0012 and the diagnostic contract; only allowlisted identifiers enter diagnostics.

## Risks / Trade-offs

- Several animated previews increase memory → load only a small visible page with existing frame caps and release decoded frames when hidden.
- An intervening edit invalidates a draft → refuse stale save and require explicit reload; never overwrite the owner or replay.
- Saved changes could alter playback unexpectedly → owner checkpoints remain frozen until an explicit restart.
- A create might partially persist → validate and commit initial items with the playlist in one transaction; test rollback and duplicate identity.

## Migration Plan

No database schema migration or new dependency. Existing requests remain valid. Deliver through the ordinary reviewed PR and qualified runtime procedure. Rollback uses that procedure's private backup and release admission; no physical content change is selected for acceptance.
