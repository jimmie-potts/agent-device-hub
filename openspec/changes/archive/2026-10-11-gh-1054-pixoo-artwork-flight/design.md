## Context

See proposal.md for the reproduced failure. The existing presentation compares the artwork-dependent render key while an upload is in flight. The native adapter correctly reports possible effects if cancellation occurs after dispatch. Design is required because this changes a concurrency boundary and its timing behavior.

## Goals / Non-Goals

Keep an unchanged observation's current upload valid during artwork replacement. Preserve the existing worker/cache association guards, deadline, one device writer, manual control and uncertain outcomes. No new command, state format, retry loop or Tidbyt foreground mode is selected.

## Decisions

Capture the complete playback source/view and its observation when admitting a card upload. Compare those captured values along with the existing presentation/player/eligibility fences while it runs. Artwork bytes and generations remain part of the render/cache key, so the latest card is scheduled after the admitted upload completes, under the existing cadence. A different observation, source or view still invalidates the upload.

Keeping strict artwork-key equality reproduces the native cancellation failure. Suppressing cancellation outcomes would hide possible device effects. Broadly accepting any same-title card would break same-text source-handoff protection. Only artwork replacement within an otherwise identical observation/view is allowed.

Follow ADR 0012 and the diagnostic contract: admission still passes through Player and its native queue; refusals/codes, logging/trace boundaries and no-replay policy are unchanged. Genuine native failures, expiry, cancellation and partial effects keep their existing failed/uncertain outcomes; no transport acknowledgment claims physical success. Art-only changes neither refresh playback evidence nor reopen or extend a popup.

## Risks / Trade-offs

An admitted fallback or prior-art frame can finish before a new artwork frame for the same observation. This is bounded by the native operation and existing cadence; tests verify the latest frame follows while eligible. A real observation/view change still cancels even after dispatch, retaining possible-effect evidence and existing suspension/recovery.

## Migration Plan

No data migration or dependency change. Deliver the reviewed source through a guarded PR merge and applicable main CI. Prepare new exact actual-release compatibility/admission/plan for the established runtime, then use its qualified routine upgrade. Recovery follows apps/runtime/UPGRADE.md; never patch installed bytes. Repeat authorized physical A/B, fallback and restoration checks. Private originals, addresses, listening data and receipts remain outside Git/GitHub.
