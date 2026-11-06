## Context

The core already owns the Music capture session (`apps/runtime/src/core/music-capture.ts`). It holds the endpoint, the capture generation and the session status, and it publishes `music-capture-state/2.2`. The native producer publishes `music-capture-features` at about 10 Hz on `bunny.event.music-capture-features.<endpointId>`. The Nanoleaf module already has:

- the frozen renderer (`MusicRenderer`) and latest-value intake (`MusicInput`);
- the private immutable reactive preset library;
- one locked worker per device with a journal, holds and `Execution`;
- bounded moments (`moments.ts`), which admit over a named Free base, stop on alerts and newer changes, and restore that base only while nothing newer has taken over.

The owner's first-trial policy in #40 is:

| Situation | Behavior |
|---|---|
| Start | Explicit, only on lights already in Free; never changes mode |
| Alert | Stops music effects; no automatic resume |
| Manual takeover | Stops music effects; the manual change wins over any older restoration |
| Source loss | Stops music effects; no microphone fallback |
| Restart after any stop | Explicit only |
| Stop | Returns to the current base presentation, evaluated at stop time |

The implementation reads two further points: silence or a paused track is not source loss by itself, and lights outside Free are refused rather than switched.

## Goals / Non-Goals

**Goals:** one authoritative session owner in the core; execution only through the light's existing writer; truthful per-light state for later controls; no replay, resend or automatic resume.

**Non-Goals:** dashboard controls, which are a later #722 increment. Also excluded: NL22 live rendering, microphone sessions, applied response tuning (renderer V2) for live sessions, timed shows, participation persistence beyond one session, and installation or physical acceptance.

## Decisions

### D1. The core owns the session; the device module owns admission and execution

Two candidates were compared. In the first, a core part owns the session and the module executes it. In the second, the whole session lives inside the Nanoleaf animation path with no core change. #40 states that policy belongs to the core, #1272 requires one authoritative music-session owner, and #39, #71 and a later Panels path need one policy rather than one per module. The core-owned design was chosen. The module keeps mode, geometry, frames, queues, holds and alert detection, as moments already do.

### D2. Families (all 2.0, additive)

| Family | Kind | Sender to owner | Subject |
|---|---|---|---|
| `music-lighting-control` | command | operator to core | target light |
| `music-lighting-state` | state | core | target light |
| `music-lighting-work` | command | core to the light's module | target light |
| `music-lighting-device` | state | light's module | target light |

- **Control:** `start {capture: {endpointId, generation}, presetId}` or `stop`, both carrying `expectedRevision`.
- **Work:** carries the core's session `generation`.
- **State and device records:** the ending has the form `{generation, reason, restoration, atMs}`.
  - Reasons: `stopped`, `alert`, `manual`, `source-lost`, `device`, `restart`, `expired` or `refused`.
  - Restorations: `restored`, `skipped` or `none`.

A Start names a saved preset, never an inline recipe, so a later renderer change cannot reinterpret it.

### D3. Core part (`MusicLightingPart`)

The part keeps one record per qualified Nanoleaf target and saves it in the core store's transaction.

**Start** is refused unless all of these hold:
- operator admission passes and the command has not expired;
- `expectedRevision` matches;
- the target is a qualified Nanoleaf participant;
- the record is idle;
- the core's capture state is available, its session is `active` with `input: "music"`, and both the endpoint and generation match the requested capture. A microphone session gives `unsupported-capability`; anything else gives `revision-conflict` or `unavailable`.

On acceptance the part saves `starting` with a new UUID generation, and saving completes the operator command as observed (the mode-part pattern). It then dispatches `music-lighting-work` start through `core.dispatch`, with a stable derived request ID, the operator command as parent and the device deadline class.

**Settling the start:**
- A refused work reply ends the session as `refused`, or as `expired` when the reply says expired, with restoration `none`.
- A lost reply makes the record `uncertain`.

**Device records** (synced from the light's owner):
- `playing` for the current generation makes the record `active`.
- `ended` for the current generation makes it idle, with `last` copied from the device.
- A record for another generation is ignored.
- If a fresh device snapshot shows another generation, or no session, while the core holds `active`, `stopping` or `uncertain`, the core records `restart` with restoration `none`.

**Stop** is accepted from `starting`, `active` or `uncertain`. It saves `stopping` and dispatches work stop for the current generation. If the module answers `invalid-state` because the session already ended, the device record decides the outcome. Any other refusal leaves the record `uncertain`.

**Core restart** moves every non-idle record to `uncertain`. Nothing is resent; a device sync resolves it.

### D4. Nanoleaf execution

`music-lighting-work` start is accepted only from the core source. It is refused unless all of these hold, and a refused Start writes nothing:
- the light is the Lines device; otherwise `unsupported-capability`;
- its mode is Free with no pending mode change; otherwise `invalid-state`;
- it is not held; otherwise `unavailable`;
- no music session is starting or playing, and no other content waits; otherwise `invalid-state` or `capacity`;
- the preset exists; otherwise `not-found`;
- the renderer accepts the recipe and saved layout; otherwise `unsupported-capability`;
- the current device effect is a listed named scene with a readable brightness, which becomes the Free base; otherwise `invalid-state`.

Accepted, it journals `music.play`, saves the session as `starting`, opens a `MusicInput` for the capture binding and wakes the worker.

The worker runs the session inside its locked pass, like a moment:
- The first rendered frame is written through the Start row's `Execution`, completing the work command as transmitted, and the session becomes `playing`. With no fresh feature within 2 s, it ends `source-lost` and the command fails `unavailable`.
- After that it renders only the newest fresh feature. It keeps at most one write in flight, at most one write per 100 ms, and no catch-up.

Each iteration checks, in this order:

1. **Stop row:** `stopped`, then restore.
2. **Newer change** (mode, configuration, override, hold, or a newer scene, animation, power, brightness or moment row): `manual`, with no restoration.
3. **Alert indication:** `alert`, then restore.
4. **Input retired or no fresh feature** (expiry, discontinuity, generation change, clock): `source-lost`, then restore.
5. **External change** (a once-per-second read finds the device no longer on the music frame's selection, or its brightness or power changed): `manual`, with no restoration.
6. **Failed frame write:** `device`, with no restoration and no retry.

Restoration re-reads the device and writes brightness and then the named base scene. It does so only if the device still shows the music frame's selection, the base is still listed, the brightness is unchanged and no newer change exists before and after each write. Otherwise it is `skipped`. A Stop's outcome follows its restoration. Valid silent frames keep the session playing.

At module start, a session left `starting` or `playing` becomes `ended` with reason `restart`. No device write is made and nothing replays.

### D4a. Implementation decisions

- **Frame selection.** Music frames are static displays, so the device reports `*Static*`, not `*Dynamic*`. The external-change check and the restoration guard compare against the selection the music frames produce.
- **First frame and later frames.** Only the first frame goes through the Start row's `Execution`. A lost answer there keeps the existing uncertain outcome and hold. Later frames are the module's own paints, using `Execution` without a command, like indicator paints. A failed or lost frame ends the session `device`, with no hold and no retry.
- **Stop restoration.** Stop restores through its own journaled row. Its outcome is transmitted when it restored, observed when restoration was skipped, and uncertain with a hold when an answer is lost. Alert and source-loss restorations are the module's own writes.
- **Start outcomes before the first frame.** A Stop or a newer choice gives `cancelled`, an alert `invalid-state`, no feature within 2 s `unavailable`, and expiry `expired`. A Stop whose session already ended another way finishes `invalid-state`.
- **External change.** The once-per-second read also treats an external power-off as manual.
- **Start deadline.** Core dispatch gives work the device class's 5 s reply deadline as its expiry. Worker pickup, the Free-base read and the 2 s first-feature wait fit inside it.
- **Clock.** The module's `MusicInput` uses the runtime clock for both its wall and monotonic readings. A backward clock step therefore ends the session as `source-lost`.
- **Inbox.** A failed work operation, such as a light outside Free, appears in the inbox like any failed device command. The tracker refuses "Send again" for work, so nothing is resent.
- **Known limit.** A scene picked in the Nanoleaf app between two frames can be repainted by the next frame before the once-per-second read sees it. Brightness and power changes are always caught. Reading the effect before every write, or following the controller's event stream, is left to #725 or a later change.

### D5. No polling, resend or fallback

The core reads device records through the SDK's sync. The module receives features by subscription. Commands expire and are never resent. No path selects the microphone or another light.

## Risks / Trade-offs

- [The 400 ms capture validity is strict] A short stall ends the session as source loss. This is truthful, and physical tolerance belongs to #725.
- [A light left on the last frame] After a manual brightness or power change, the last frame stays and no restoration runs. A later Start needs a named Free scene.
- [Start from an animation] A Free base must be a named scene, so a light showing a Free animation refuses Start.
- [Unqualified cadence] Ten writes per second is unproven on the device. Fake transport proves pacing only.

## Migration Plan

New tables only. Rollback leaves unused rows; older runtimes ignore the new families.
