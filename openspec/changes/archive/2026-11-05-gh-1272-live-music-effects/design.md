## Context

See proposal.md for motivation. This source increment consumes #721's existing profile-2 capture occurrence. Core owns capture/session authority; Nanoleaf owns layout and effect math. Existing workers retain sole physical-write authority. Timing ambiguity warrants this design under the spec-driven schema.

## Goals / Non-Goals

The implementation makes five effects and expiry deterministic from explicit inputs. It has no production subscription, command admission, persistence, device access, power/brightness action or implicit time read. This increment does not decide #40's participation, source-loss presentation or restoration behavior.

## Decisions

### Reuse the capture family and display encoder

`music-input.ts` validates the existing closed capture schema, expected producer source, endpoint and generation, and holds at most one immutable feature. No new wire format or event family is needed. `music-effects.ts` encodes one static RGB keyframe per physical zone through the existing encoder. Lines use both logical zones and the Lines flag; NL22 uses its single physical zone and omits that flag. Saved element validation and spatial phases are reused; no geometry is discovered.

### Resolve recipes before rendering

Version 1 is a closed discriminated union. Every recipe freezes palette and defaults: intensity 1, sensitivity 1, smoothing 100 ms (ambient 1500 ms), pulse half-life 200 ms, spatial direction right and wave period 2000 ms where applicable. Bounds are palette 1–8 hex colors, intensity 0–1, sensitivity 0.1–8, smoothing 0–2000 ms, half-life 100–2000 ms and period 400–10000 ms. Variant-inapplicable and unknown fields are rejected. These are software bounds, not physical cadence or flash-safety qualification. Persistence remains the controls owner's work; old animation favorites are not reinterpreted.

### Source-relative effects and receiver-local expiry

Each input instance binds one endpoint and capture generation and takes explicit wall/monotonic samples. It rejects duplicate/reverse sequence, wrong binding, malformed features, future observations beyond the shared 100 ms skew bound and expired payload deadlines. A local monotonic deadline is the earlier of the received remaining validity and 400 ms. Duplicate input never renews it. Clock drift above the shared 25 ms tolerance, backward local monotonic time, source-time reversal, discontinuity after initialization, explicit retirement or expiry retires the instance permanently; a later caller must establish new authority and construct a new instance.

The native producer marks its first complete window discontinuous. An empty binding accepts that window as initialization; a later discontinuity retires it.

The renderer uses elapsed source-window timestamps within that binding. It never subtracts remote monotonic time from local time or extrapolates using receipt latency. It renders each accepted sequence at most once. Missing windows skip ahead rather than producing a catch-up burst. The caller must fetch a current sample immediately before rendering and recheck freshness before a later write; this pure source slice performs no writes.

### Deterministic five-effect math

Measurements normalize as clamp(sensitivity × measurement, 0, 1), including legal capture levels above one. Smoothing uses 1 − exp(−sourceDelta / smoothingMs), or immediate response for zero. First samples initialize from current measurements. Level glow scales the first palette color by RMS. Bass pulse uses max(smoothed current bass, previous envelope × 2^(−delta / halfLife)). Spectrum interpolates three broad-band levels over saved spatial phase and a non-cyclic palette. Traveling wave multiplies RMS by (1 + cos(2π × (phase − elapsed / period))) / 2. Ambient uses the broad-band weighted centroid to select a non-cyclic palette color, smooths color and level, and retains its hue during valid silence while level decays. Onset confidence does not invent a beat or BPM. Valid silence remains data; source expiry yields no frame.

### Bounded state and truthful evidence

Each renderer holds only previous source time/sequence and small smoothed levels, color and bass envelope. A new renderer resets all temporal state. Encoded output obeys the existing byte and per-zone frame bounds. No history queue, log, raw PCM or collection is added. Synthetic fixtures and disposable generated payloads are publication-safe under ADR 0011; actual retained feature evidence remains private under #721.

## Risks / Trade-offs

- A static frame remains visible after writes stop → the later #40 integration must define source-loss and stop presentation. A no-frame result makes no physical blackout claim.
- An input object alone does not prove core authority → future integration must bind the selected active capture state and retire on stop, replacement, overflow/resync, restart and newer manual choices, then check those fences around every await.
- Ten capture windows per second is not a qualified light rate → a later exclusive worker will replace pending frames and use separately qualified per-device scheduling. No device cadence is selected here.
- Strict retirement drops a recovered same-generation stream → intentional fail-closed mathematical input; only a new authoritative binding starts another instance.

## Migration Plan

No schema or stored-data migration and no runtime rollout are needed for these unreferenced internal helpers. Existing worker paths remain unchanged. Integrate only after the shared #721 contract; later policy/worker work will add its own runtime acceptance.
