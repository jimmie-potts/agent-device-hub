## Context

See proposal.md for motivation and issue links. The core already owns one SQLite capture record, retained operator responsibilities and serialized feature handling. The dashboard follows its SDK copy and validates feature freshness with a bounded core clock estimate. Nanoleaf has five pure version-1 renderers; none is a device worker. This change crosses those owners and adds persisted behavior, so design.md is required by the configured schema.

## Goals / Non-Goals

Give the operator one complete quiet-measurement, Apply and numerical-preview path. Keep all permission, native collection, device admission, physical acoustics and automatic fallback decisions outside this increment. A successful quiet measurement means only a relative digital baseline for its observed windows.

## Decisions

### Versioned contracts and ownership

Add closed `music-capture-control/2.2` branches named `calibrate`, `cancel-calibration` and `apply-tuning`. Keep existing start/stop shapes valid. Add `music-capture-state/2.2`; core publishes this single version. Old 2.0/2.1 schemas and requests remain unchanged. Gateway chooses 2.2 only for the new actions, and bundled state readers accept all three versions. Work/features remain Music 2.0 and selected-microphone 2.1. The producer and native helper are untouched.

Apply also carries the settings revision from its draft, so another tab cannot silently replace newer saved preferences. New calibration and Apply requests carry current state revision and an exact binding containing endpoint, generation, public microphone alias, sample rate and channel count. Cancellation additionally identifies the attempt. No native UID or device-identity service is introduced. An active fresh selected microphone is required. Settings are microphone preferences; no request starts, switches or authorizes capture.

### Bounded evidence and clocks

At admission, retain a core-local monotonic deadline ten seconds later and the core wall time. Count exactly 50 consecutive valid 100 ms windows whose conservative start (`observedAtMs - 100 ms window - 100 ms declared clock skew`) is at or after admission. Earlier queued windows are ignored, never counted. Compare source monotonic differences only; never compare a source origin to a core origin. Existing endpoint/core clock qualification and frame freshness must still hold at every decision, including delayed timer callbacks.

Keep at most 50 RMS values, one prior source sequence/end and a current binding. Reject an interrupted collected sequence, clipped sample, format change, discontinuity, expiry, clock loss or deadline. A completed candidate records 50-window coverage, relative source duration, observed wall endpoints, nearest-rank 95th-percentile RMS, maximum RMS and a bounded suggested threshold `min(16, 2 * p95)`. The percentile and multiplier are explicit software heuristics, not proof of physical quiet, calibrated loudness or microphone frequency response. Applying an edited threshold remains explicit.

### Private persistence and qualification

Extend the existing capture record with a response object: settings revision, settings, an applied binding or null, current calibration attempt and the latest numeric calibration evidence or null. Existing private state/history retains prior committed settings and evidence. No raw samples are persisted. Old records receive gate-off defaults without changing old wire schemas. There is no new database service or external store.

Settings contain sensitivity 0.1–8, smoothing 0–2000 ms, independent band emphasis 0–4, and a discriminated gate: off, manual threshold, or calibrated threshold plus evidence ID. Gate thresholds are 0–16. Defaults are sensitivity one, smoothing 100 ms, emphasis one and gate off. The bounds cap response work and output; they make no acoustic suitability claim.

Qualification belongs to endpoint, generation, alias and format. Source/generation retirement, stale coverage, discontinuity, format change, endpoint loss and restart clear the applied binding and candidate eligibility while retaining settings and evidence. Reusing an alias after changing the private UID cannot revive a qualified threshold. An enabled gate without a current applied binding produces no preview until the operator measures again or explicitly applies a manual threshold. Gate-off defaults can show an uncalibrated preview. Per-endpoint qualification was rejected because capture can stop while hardware identity, gain or placement changes.

### Commands, cancellation and failure

Reuse tracked operator admission, shared errors and the existing core transaction/history boundary under ADR 0012. Admission saves responsibility before measurement starts. A completed calibration saves evidence and its observed outcome atomically. Apply and Cancel save their state and completed outcome in one transaction. Revision or binding conflicts have no partial effect. Apply during measurement is refused. Cancellation stops only measurement; it leaves capture and committed settings unchanged. Stop stays independent of unresolved calibration/Apply attempts and fences input and qualification immediately.

Persist a pending calibration responsibility, but keep samples in memory. Restart settles that responsibility without collecting again. A timeout, stale evidence, discontinuity or clipping fails measurement without changing settings. A lost reply never causes automatic replay. Storage refusal retains the existing disconnect/fault recovery behavior; recovered state has no active qualification. Late producer progress cannot settle a core-only calibration responsibility. No new diagnostic shape or log content is added.

### One response calculation

A browser-safe Nanoleaf response implementation owns target calculation and source-time smoothing. Gate closed supplies zero targets; otherwise sensitivity and band emphasis apply, then clamp to 0–1, then the existing exponential smoother once. The first sample initializes immediately. Valid samples can show smoothing decay after gate closure; expiry clears preview immediately. Bass-pulse decay remains an effect envelope. Ambient color interpretation for V1 stays frozen.

Renderer V1 keeps its exact recipe, defaults and output. An explicit V2 recipe carries the shared response settings and rejects duplicate legacy sensitivity/smoothing fields. The browser consumes the same response implementation through a dedicated browser-safe `music-response` package export. Core persists settings but computes no response levels. The raw meter retains its meaning, beside a separately labelled Response preview. The preview resets on settings revision, binding change, discontinuity and freshness loss and never publishes frames or device commands. If the browser observes an interrupted source before the core state update arrives, it keeps an enabled preview inactive for that application revision; only a new authoritative Apply can requalify it. The shared calculation is pure, so a renderer commits its next response only after its output passes bounds. A rejected output cannot change V1 smoothing state. The existing renderer intake stays Music-only. V2 tests use already qualified synthetic samples; no new microphone admission is introduced.

## Risks / Trade-offs

- Alias and format cannot establish unchanged physical hardware. Qualification is invalidated on every retired generation; even one uninterrupted generation cannot prove external gain or placement stayed fixed.
- Fifty uninterrupted windows can fail under backpressure. Report failure and require another deliberate measurement; never silently combine separate intervals.
- New state fields require bundled readers to accept 2.2. Contract, gateway, core and browser checks cover their exact migration; earlier schemas remain byte-identical.
- A numerical response preview cannot prove the light's physical appearance or timing. Rendering tests use only synthetic Lines and NL22 geometry.

## Migration Plan

Develop on the explicitly selected reviewed microphone/renderer integration. Reconcile onto actual merged main before publication and renew affected evidence. Existing capture rows receive defaults and restart retirement before state is served. Preserve prior history. This is source delivery only; installation and any recovery selection belong to the deployment owner and their separately qualified release procedure.
