# Nanoleaf module

Private workspace package `@jimmie-potts/nanoleaf`. It holds the TypeScript port of
[codex-nanoleaf](https://github.com/jimmie-potts/codex-nanoleaf)
([#26](https://github.com/jimmie-potts/agent-device-hub/issues/26); [PORTING.md](PORTING.md)
maps it) and the runtime module that runs it,
`nanoleaf` ([#844](https://github.com/jimmie-potts/agent-device-hub/issues/844)), one of
the runtime's shipped modules under
[ADR 0012](../../docs/decisions/0012-bunny-event-platform.md). The module shows agent
sessions on the Nanoleaf Lines and NL22 Light Panels, takes Work, Quiet and Free and the
wall's controls as commands, and publishes each controller's state. Its Wall page
integrates the retained editor into the shared React dashboard (#934). Source
validation and the [accepted #840 cutover](https://github.com/jimmie-potts/agent-device-hub/issues/840)
remain separate evidence; that record states the selected installation and physical scope. Fresh setup does not
use the optional [migration](#migration) tool.

## Factory

`createNanoleafModule({transport, datagram})` takes how the module reaches its
controllers: a `LightRequest` (`lightRequest`, the Nanoleaf HTTP client, in the shipped
runtime) and a `LightDatagram` for live Music frames (`lightDatagram`, #1598), or a
`SimulatedNanoleaf` controller's `request` and `datagram` in tests and with `--simulate`. Addresses and
tokens come from the module's configuration and secrets, never from the factory.

## Configuration

The module's section of the runtime's [configuration file](../../apps/runtime/README.md#configuration):

```json
{
  "devices": [
    {"id": "wall", "kind": "lines", "address": "192.168.1.20", "secret": "wall-token"},
    {"id": "nl22", "kind": "panels", "address": "192.168.1.21", "secret": "nl22-token"}
  ],
  "qualifiedSources": [{"provider": "codex", "client": "desktop", "hostId": "<host>", "sourceId": "<source>"}],
  "codexMetadata": {"path": "/abs/codex/local-projects.json", "titleIndexPath": "/abs/codex/session_index.jsonl"},
  "secrets": {"wall-token": "/abs/secrets/wall-token", "nl22-token": "/abs/secrets/nl22-token"}
}
```

- `devices`: 1 to 8 controllers, each with a routing ID, its kind, a private IPv4 address
  and the name of its token's secret file. Exactly one is the Lines, with the ID `wall`,
  the port's original device.
- `qualifiedSources`: the agent sources whose sessions the wall shows; others are skipped.
- `codexMetadata` (optional): Codex Desktop's project catalog and title index, read only.

Anything else is refused with `invalid-request` and fixed text. At start the module writes
the port's registry, `config.json`, to its private folder with each device's secret name
and no token, reads each token with `secrets.read` and keeps it in memory. Its store is
the runtime's `modules/nanoleaf.sqlite`; its layouts, scene files and worker locks live in
its private folder.

## Migration

The optional offline tool from
[#933](https://github.com/jimmie-potts/agent-device-hub/issues/933) can carry the codex-nanoleaf bridge's state
into the module before its first start. The selected [fresh setup](../../apps/runtime/SETUP.md)
for #935/#840 starts with empty state and does not run it. The runtime README's
[Nanoleaf migration](../../apps/runtime/README.md#nanoleaf-migration) gives its command line, exit codes and refusals;
`src/migration/` holds what it carries and checks. It reads the bridge's private state directory in either of two
shapes and never changes it:

- the installed release's: codex-nanoleaf `c711e18`, model version 4, with each row's device;
- the pre-change Linux database without device keys (the `linux-state-v4` fixture), whose rows all belong to the
  Lines.

What it carries, through SQLite, into the module's store and folder, for each device the registry names:

| Carried | From | Into |
| --- | --- | --- |
| The project map and colors | `projects` | `projects` |
| The palette | `palette` | `palette` |
| Each element's project and halves | `line_prefs` | `line_prefs` |
| Map settings (layout style, coverage, rotation and flips) | `map_settings` | `map_settings` |
| A pending wall edit | `map_pending` | `map_pending`, which the worker applies once no comet runs, as after a restart |
| Favorites | `animation_favorites` | `animation_favorites` |
| Each device's desired state: Work, Quiet or Free, a native power or brightness override, and how far its worker applied the mode | `meta`: `mode`, `mode_revision`, `mode_applied`, `controller_power`, `controller_brightness` (with `@<device>`) | `meta` |
| The layout | `layout.json` | `layout.json`, version 2, each device's elements, zones, positions and geometry |
| Each device's remembered scene | `scene-state*.json` | the same files |
| Addresses and tokens | `config.json`'s registry | the module's [section](#configuration), with each token as a private secret file |
| The qualified agent sources | the shared-input configuration, without `bindings` | the section's `qualifiedSources` |
| Codex Desktop's metadata paths | `config.json`'s `metadata_path` and `title_index_path` | the section's `codexMetadata` |

These start fresh and stay only in the backup (owner decision 10, 2026-10-06, and the #26 decision). The tool counts
each of them in its report:

- tasks and what follows them: `sessions`, `task_info`, `activity`, `waits`, `receipts` and the shared-input task tables;
- reservations (`slots`), comets, Locate and display caches;
- task and effect epochs, holds (`controller_hold_revision`) and failures (`control_error`) in `meta`: a carried hold
  at the carried mode revision would stop every write to its device;
- the controller ledger, each device's included, and the integration API's requests;
- the legacy task backup and the shared-input configuration's `bindings`;
- the rows, layout entries and scene files of a device the registry no longer names.

The destination's `shared_input` row is a fresh one. Its source is `'legacy'`, which the module reads as not selected
until its first sync selects shared input.

The verifier compares each carried row by its key, with its SQLite storage class; each file as parsed JSON; the section
member by member; and each secret through the runtime's own reader. It also counts what should not be there. The
optional conversion succeeds only on zero mismatches; this does not gate fresh setup.

There is no enrollment command yet (owner decision, 2026-10-07): it waits until a device is added, and
`src/enrollment.ts`, the port's enrollment, is ready for it. Until then, a new address is a one-line edit of the
device's `address` in the module's section; the device keeps its ID, and with it its preferences and scenes.

## Bounded moments

[Hub #925](https://github.com/jimmie-potts/agent-device-hub/issues/925) adds `moment-play` on Lines through the existing control journal and single locked writer. The required moods `celebrate`, `setback` and `reminder` reuse the `celebration`, `rain` and `focus` effect recipes. Duration is 1–10 seconds. Panels and Quiet refuse moments.

Work admits an interlude only with `coversStatus`, set by the core for an owner-approved interrupt kind; an alert always preempts the effect. Completion follows restoration computed from the current Work state. In Free, admission reads the currently selected named scene and brightness, and the writer rechecks the selection before effects. Unknown, unnamed or externally controlled Free content refuses before any effect write. A newer mode, configuration, content choice or override takes precedence over restoration.

The start window and persistent moment ID memory prevent a repeated or stale moment. At restart, an unfinished journal entry ends without replay. A lost write response uses the existing uncertain outcome and device hold, without retry. Accepted, transmitted, completed and physically visible remain separate claims.

## Prepared music timelines

The internal `src/music-timeline.ts` helper prepares immutable version-one
semantic cue plans and evaluates them on caller-supplied local monotonic time.
It accepts 1 to 256 ordered, non-overlapping cues, at most 30 minutes, and cue
durations of at least 100 ms. These are software bounds, not a qualified light
cadence or a flash-cap policy. Recipes use the existing explicit values and
preset defaults; callers resolve favorites through their owner first.

`MusicTimelineCursor` starts only on `startAt`. Pause freezes its position;
resume, seek and stop invalidate previous callback generations. Late samples
select only the current cue and report wholly missed cues once. Intentional
seeks select directly without reporting skipped cues as missed. Stop and a
backward local clock permanently retire the cursor. Half-open intervals keep
boundaries deterministic; gaps and end-of-show supply no blackout or restoration
instruction. `renderMusicCue` validates the supplied saved layout and uses the
existing Lines/NL22 encoder with cue intensity. It renders the ordinary effect
from its beginning, so the cursor's elapsed time is not a phase-accurate seek.

`prepareMusicCueFrames(cue, layout)` provides an internal immutable copy of the
same canonical keyframes, with each zone's actual cycle duration. It validates
only the supplied layout values and reads no layout file. The shared internal
frame preparation keeps ordinary animation payload bytes unchanged. The existing
package `effects` namespace additively exposes `prepareAnimationFrames`; it
returns frozen canonical zones and an ordinary mutable display payload, with
existing capacity checks. Existing namespace exports retain their signatures.
`locateMusicCuePhase(prepared, elapsedMs)` accepts cue-relative elapsed time
and returns frozen per-zone transition descriptors: target, previous endpoint
when known, frame index, cycle and elapsed/remaining transition milliseconds.
The initial first transition reports an unknown origin. A later loop cycle
uses the last endpoint as its first origin; a completed one-shot reports its
final endpoint. At cue duration or later, `cue-ended` supplies no presentation
instruction. Invalid positions are refused. Sampling order has no effect, so
callers use the selector's current elapsed time after pause, resume or seek.
These descriptors infer no interpolated RGB color or controller phase-seek
support. They add no remote preparation contract, route or playback caller.

The offline show library calls preparation; its storyboard uses only the
browser-safe semantic selector in `music-timeline-data.ts`. The cursor and
renderer have no production playback caller or device access. Preparation
grants no music admission. [#1273](https://github.com/jimmie-potts/agent-device-hub/issues/1273)
retains worker scheduling and outcome integration under the
[#40 policy](https://github.com/jimmie-potts/agent-device-hub/issues/40).
[Show authoring](https://github.com/jimmie-potts/agent-device-hub/issues/723),
[qualified playback position](https://github.com/jimmie-potts/agent-device-hub/issues/571)
and [installed/physical acceptance](https://github.com/jimmie-potts/agent-device-hub/issues/725)
remain separately owned. Synthetic payloads establish no physical timing.

## Music rendering source helpers

`src/music-effects.ts` and `src/music-input.ts` provide the deterministic source
helpers for [#1272](https://github.com/jimmie-potts/agent-device-hub/issues/1272).
The live Lines session below uses them. On their own they do not grant permission
to show music or change a controller's mode, power, brightness or scene.

`freezeMusicRecipe(unknown)` validates a closed `MusicRecipeV1` and copies its
palette and all defaults into an immutable recipe. The five effects are
`level-glow`, `bass-pulse`, `spectrum`, `traveling-wave` and `ambient`. Version 1
fixes its defaults and bounds, so a serialized recipe keeps its interpretation.
The palette has 1–8 hex colors; intensity is 0–1, sensitivity 0.1–8, smoothing
0–2000 ms, pulse half-life 100–2000 ms and wave period 400–10000 ms. These bounds
are source constraints and do not qualify a device cadence or flash-safety limit.

The browser-safe `@jimmie-potts/nanoleaf/reactive-presets` export supplies
`followReactivePresets`, the Wall page's read-only follower for the private preset
library. The dashboard's Audio Music lighting card reuses it to list saved presets.
Following the library sends no command.

`freezeMusicRecipeV2(unknown)` requires an explicit `rendererVersion: 2` and a
closed `response` setting in place of V1's top-level sensitivity/smoothing.
The browser-safe `@jimmie-potts/nanoleaf/music-response` export supplies the same
`musicResponse` calculation used by V2 and the microphone numerical preview:
gate linear RMS, apply sensitivity and broad-band emphasis, clamp targets to
0–1, then smooth once using source-time deltas. Gate closure lets existing
smoothing decay; it does not add another envelope. V2 ambient color uses the
processed band centroid without a second color filter. Its decorative pulse
envelope remains effect behavior. V1's defaults and interpretation are unchanged.
The caller supplies already qualified input and owns the settings revision,
freshness and retirement. This pure helper grants no microphone or light
authority; `MusicInput` still accepts only its existing Music feature contract.

`MusicInput(binding, anchor)` holds one immutable latest feature from #721's
existing profile-2 capture family. `binding` names the endpoint and capture
generation; the caller must establish that authority. `accept(message, clock)`
validates the family, binding, increasing sequence and source timing.
`current(clock)` returns a fresh sample or null. Clock samples carry explicit
`wallMs` and receiver-local `monotonicMs`; the helper reads no clock itself.
Expiry uses the original payload deadline and a receipt-monotonic deadline.
Duplicate messages cannot renew it. The first native discontinuity initializes
the binding. A later discontinuity after a missed window is accepted as the latest
feature, and timing continues across the gap (#1588). Source time that runs
backwards, clock invalidity and expiry retire it.
`retire()` also permanently clears it. A later binding needs a new instance.

`MusicRenderer(recipe, layout, binding).render(sample)` returns the existing
`Display` payload or null for repeated or invalidated input. A discontinuity after
a missed window renders as an ordinary gap would; source time that runs backwards
retires the renderer. It copies saved
geometry, uses source-time differences for smoothing and decorative wave motion,
and encodes one static RGB keyframe per zone. Lines use paired logical zones;
NL22 uses one physical zone. Spatial effects require saved positions. Output
retains the existing frame and byte bounds. Broad bands are bass, mid and treble
measurements, not FFT bins; onset confidence is not a beat or BPM estimate.
Silence follows the effect's decay. No frame on expiry does not turn a light off;
a physical controller would keep its last presentation until another write.

`music-effects.test.ts` and `music-input.test.ts` use synthetic inputs and explicit
times to check these source contracts.

## Live Music session on Lines

`src/music-session.ts` runs the core's `music-lighting-work` for
[#1272](https://github.com/jimmie-potts/agent-device-hub/issues/1272), under the
first-trial policy in #40 and OpenSpec change `gh-1272-live-lines-session` (design D4).
Frames stream through the light's external-control mode
([#1598](https://github.com/jimmie-potts/agent-device-hub/issues/1598), OpenSpec change
`gh-1598-lines-streaming-takeover`). A Start goes ahead over whatever the light shows
([#1614](https://github.com/jimmie-potts/agent-device-hub/issues/1614), OpenSpec change
`gh-1614-start-from-any-scene`).
The core owns the session. The module owns admission and execution through the light's
existing locked worker, as for a bounded moment.

- **Admission.** Only `bunny/core` may send the work; anyone else gets `forbidden`. A
  Start is refused, with nothing written and no mode changed, unless every check holds:
  - the light is the Lines device (`unsupported-capability`);
  - it is already in Free with no pending mode (`invalid-state`);
  - it is not held (`unavailable`);
  - the hub's own power choice is not off (`invalid-state`);
  - no session is starting or playing (`invalid-state`) and no other content waits (`capacity`);
  - the saved reactive preset exists (`not-found`);
  - the renderer accepts it with the saved layout (`unsupported-capability`);
  - the light is on and reports a selection and a brightness (`invalid-state`, naming
    what the light showed; a failed read is `unavailable`).

  What the light shows and its brightness become the Free base (`src/music-base.ts`):
  - a **saved scene**, listed in the light's `effectsList`;
  - a **plain colour**, `*Solid*` whose `/state` reports `colorMode` `hs` with a hue and
    saturation, or `ct` with a colour temperature;
  - anything else, an **unnamed** base: an unsaved scene, an effect, `*ExtControl*` frames
    an earlier session left, or `*Solid*` whose colour is unreadable. Nothing can select
    it again, and no scene is guessed.

  A refusal names the selection without a scene name: `saved scene scene-…` (the
  opaque ID the device record lists), the light's own placeholder (`*Solid*`,
  `*Static*`, `*Dynamic*` or `*ExtControl*`), or `a selection not saved on the light`.
  Bounded moments keep the named-scene rule. The read is the work command's first
  device call in its trace. If a mode or configuration change, or any journaled command
  (even one that already ran), lands during the read, the Start is refused
  `revision-conflict`, so a Start sent again reads afresh. The check uses the journal's
  shared counter, so a command for another light during the read also refuses. Accepted, the Start journals `music.play` with the command's
  expiry. It freezes the preset's recipe, the layout and the Free base, saves the session
  as `starting` and opens an in-memory `MusicInput` for the capture binding.
- **Features** arrive only through the module's subscription to
  `bunny.event.music-capture-features.*`, and each input takes only its own endpoint and
  generation. A subscription overflow retires every input. A single missed capture window
  is not source loss: the session keeps playing until no fresh feature remains (#1588).
  Features are never stored.
- **Streaming entry.** Once the first fresh sample renders, the light must still report the
  base's selection (`GET /effects/select`); any other selection since the read ends the
  session `manual`. A colour base also reads `GET /state` there, the one extra request
  before streaming: a different colour or colour mode, picked in the app while the light
  stays on `*Solid*`, ends the session `manual` with no write. Scene and unnamed bases
  read only the selection. The Start's journaled write then puts the light in external-control mode,
  version 2 (`PUT /effects` with `animType: extControl`), and the light reports
  `*ExtControl*`. The write completes the work command `succeeded`/`transmitted`, the
  session becomes `playing`, and the first frame follows as a datagram. Without a fresh feature
  within 2 s, the session ends `source-lost` and the Start fails `unavailable`; an alert
  before the first frame fails it `invalid-state`.
- **Frames** are UDP datagrams to the light's streaming port, 60222 (`src/stream.ts`).
  Each carries the zones' colors: a 2-byte count, then per zone its 2-byte ID from the
  saved layout, red, green, blue, white 0 and a 2-byte transition of 1 (100 ms), all
  big-endian. Each renders the newest fresh sample only, with one request or datagram in
  flight, at least 100 ms between frames and no catch-up. Silent valid frames keep
  playing. Nothing answers a datagram, so it holds nothing and opens no span.
- **App takeover.** A scene chosen in the Nanoleaf app leaves streaming mode, and the
  light ignores later datagrams, so no frame can paint over it. The once-per-second read
  finds the scene and ends the session `manual` with no restoration; a later Stop has no
  session to restore. While playing, the session's only HTTP requests are that read
  (`/effects`, then `/state`), not a read and write per frame. After every read, every
  ending check runs again before the next frame: the Stop, a newer choice, an alert, the
  input's freshness and, before streaming starts, the Start's expiry. A Stop or alert
  during the base read ends the session with no write and restoration `none`, since
  nothing was shown.
- **Endings**, checked on every wake in this order: a queued `music.stop` (`stopped`,
  then restore); a newer mode, configuration, override, hold, scene, animation, power,
  brightness or moment (`manual`, no restoration); an alert (`alert`, then restore); a
  retired or stale input (`source-lost`, then restore); a once-per-second read that finds
  another selection, a changed brightness or the power off (`manual`, no restoration);
  a failed datagram send or read (`device`, code `unavailable`, no restoration, no retry).
  A lost answer to the streaming entry ends the Start `uncertain` and holds the light.
- **Restoration** re-reads the light and writes brightness, then the base: a scene by
  name (`PUT /effects {select}`), or a colour in one `PUT /state` with its hue and
  saturation or its colour temperature. It writes only while the light still reports
  `*ExtControl*`, a scene base is listed, the light is not off, the brightness is
  unchanged and nothing newer exists before and after each write. Moments use the
  same guard for their named scene. The result is `restored`; `skipped` with no further
  write; or `uncertain` when a restoration write's answer was lost, since it may have
  landed. A lost write is never retried. An unnamed base gets no restoration read or
  write: the light keeps the last frame and the ending reports `none`.
- **Stop** is accepted only for a session of that generation that is starting or
  playing, including when an earlier Stop for it still waits; otherwise it gets
  `invalid-state`. The expiry sweep never expires a Stop while its session is live,
  because the session's loop ends it. Its restoration writes are its own journaled
  writes, so its outcome follows the restoration: `succeeded`/`transmitted` if restored,
  `succeeded`/`observed` if skipped or over an unnamed base, `uncertain` with a device hold if a write's answer
  was lost. A second Stop completes `succeeded`/`observed`.
- **Restarts.** At module start, a session left starting or playing ends `restart` with
  restoration `none`, with no device write and no replay. A worker that starts again
  ends a session its previous loop was running the same way.

Each light's record is served as `music-lighting-device` (subject: the light) and
republished on every change. An ended record keeps `{generation, reason, restoration,
atMs}`. A `refused`, `expired` or `device` ending also keeps the `code` behind it, such as
`expired`, `unsupported-capability`, the device's answer, `unavailable` for a read without
an answer or `uncertain-result` for a lost write answer. A Lines session never writes the Panels.

Each light's `nanoleaf-wall` record also carries, from these same reads and with no
request of its own:

- `selection`: the last read selection, or `null` before the first read. It holds
  `saved` (a scene saved on the light), `sceneId` (that scene's opaque ID, or `null`),
  `placeholder` (one of the four placeholder names above, or `null`), `restores`
  (`scene`, `color` or `nothing`: what an ending over it would put back) and `readAtMs`.
  The Start's read and the playing check's `/effects` read keep it in the private
  `nanoleaf_selections` table. An unchanged selection keeps its read time for up to a
  minute, so the once-per-second check does not republish the record every second.
- `musicBase`: the latest session's `generation` and what its ending puts back (`restores`).

No record holds a scene name.

Known limits:

- A scene chosen in the Nanoleaf app in the short gap between the entry's read and the streaming entry is replaced by the entry, once per session. So is a different colour picked in the gap between a colour base's `/state` read and the entry write; one picked before that read ends the session `manual`.
- Colour restoration follows the Nanoleaf API documentation; #1614's installed check qualifies it on the Lines.
- An app takeover, and brightness and power changes made outside the hub, are seen within about a second. The entry checks only the selection (and a colour base's colour), so a brightness or power change made before it is seen by the first playing check, after a frame may have replaced the base.
- After a `device` or `restart` ending, or a module stop mid-session, nothing is written: the light stays in streaming mode, showing the last frame, until it times out or a scene is chosen. The scene restorer treats `*ExtControl*` in Free as someone else's choice.
- The streaming behavior (zone addressing, app takeover, brightness) comes from third-party protocol notes; #725 qualifies it on the installed Lines.
- The input reads the runtime's one clock for both its wall and monotonic readings.
- #725 owns physical cadence and appearance.

## Synthetic Music effect preview

The existing Wall page includes an expandable **Music effect preview**, linked
from Audio. Choose one of the five built-in effects, edit its palette and
intensity, select an example Lines or NL22 arrangement, then choose **Preview**.
The sample slider inspects generated RGB colors locally. Drafts last for the
page lifetime, and reconnect or changed settings require another explicit read.
Read-only users can inspect these examples.

The owner uses the unchanged Music renderer with fixed generated input and six
example elements in a 3 × 2 arrangement. The authenticated module-content ref
`music-preview` accepts one `request` query containing JSON fields `version: 1`,
`preset`, `palette`, `intensity` and `model`. Supported models are
`lines-demo-v1` and `nl22-demo-v1`. The decoded request is at most 2 KiB; the
`nanoleaf-music-preview/2.0` response is at most 16 KiB with twenty samples and
at most twelve RGB zones. Invalid, cancelled and unavailable reads use the
registered error bodies. The preview reads no configured layout, capture or
stored state and sends no device work. Existing Wall-editor state reads retain
their behavior independently.

Example offsets are virtual time. The result establishes no live input,
calibration, physical geometry or speaker timing. Custom reactive-preset
save/reload remains part of #722. Static favorites and decorative show versions
retain their existing recipe contracts.

## Saved reactive presets

The Wall page's **Music effect preview** includes a private reactive library.
Choose an effect, edit its palette, intensity or motion, enter a name, then
select **Save new preset**. It stores a fully explicit frozen `MusicRecipeV1`, independently
of static animation favorites and decorative show timelines. **Load into draft**
changes only the local preview. Every effect-local renderer value is retained.
Direction is editable for spectrum and traveling wave, pulse half-life for bass pulse, and wave cycle for traveling
wave. Pulse half-life accepts 100–2000 ms and wave cycle 400–10000 ms; direction
uses the existing eight choices. These edits change only the local full V1 draft
and invalidate any prior or pending preview. Switching effects uses its existing
built-in defaults without carrying fields from another effect. Sensitivity and
renderer smoothing are shown read-only, preserving loaded values exactly.
Capture calibration and live-analysis settings remain core-owned. Only an
explicit **Preview** prepares twenty generated samples spanning 1.9 seconds on
example geometry, so a long wave cycle or decay is only partly shown. Loading
and saving start no capture or device operation.

The metadata-only command `nanoleaf-reactive-preset-save/2.0` uses the fixed
`reactive-presets` target with `presetId`, `expectedRevision`, `name` and `recipe`.
The owner checks the current catalog revision and unique ID, freezes all V1
values, and atomically commits the immutable preset, catalog and observed
outcome through its existing outbox. Stale saves return `revision-conflict`;
unsupported parameters return `invalid-request`. Failed or uncertain saves
retain the draft, and an uncertain shared attempt stays locked through reload.
No command is automatically resent. The additive tables preserve earlier
favorites and shows and never touch device journals, configuration revisions,
last device outcomes or worker scheduling.

The library holds 32 presets, with names of 1–80 Unicode characters without
control characters. Each exact stored UTF-8 JSON document is limited to 2 KiB;
the complete serialized catalog is limited to 128 KiB. Capacity refuses new
saves and preserves earlier presets. There is no replacement, deletion or
history interface. `nanoleaf-reactive-presets/2.0` serves complete bounded
recipes through owner-qualified sync. Authenticated read-only users can inspect
and load them. Refresh and reconnect update the library without replacing the
local draft. Invalid stored data refuses the library read without repairing or
discarding the private bytes; other device families remain available.

The full-recipe synthetic preview request `{version:1, recipe, model}` shares
the existing content route and renderer. The old built-in request is unchanged.
Maximal requests fit the gateway's existing 512-character query-value bound.
The module tests exercise old-schema initialization, SQLite and outbox failures,
CAS, restart and unchanged device state. The existing Nanoleaf page browser
entry includes save/load, full-recipe preview, stale and unauthorized refusals,
read-only access, reconnect, uncertainty and phone/desktop layout.
These are source checks, with no raw audio, installed or physical evidence.

## Offline decorative shows

The declared **Decorative shows** page at `#/module/nanoleaf/shows`, also linked
from Audio, prepares private cue plans under
[#723](https://github.com/jimmie-potts/agent-device-hub/issues/723). Choose Ocean
drift or Warm rise, edit the cue timing, effect, palette and intensity, then
select **Save new version**. Opening a starter and moving the storyboard's
position control change only the browser draft. The storyboard shows semantic
intervals, gaps and palettes, with no exact-frame or audible synchronization
claim. Replay is unavailable.

Each save supplies a show ID, `expectedVersion` with zero for creation, show
name, version name and timeline. The fixed `shows` target takes
`nanoleaf-show-save/2.0` through the core's existing tracked action route. The
owner freezes explicit recipes and atomically commits the new version, head,
catalog revision and observed metadata outcome. It changes no device
configuration, journal, last outcome or worker scheduling. Acceptance is
separate from completion. A stale save returns `revision-conflict`; reconnect,
refresh and reload never resend a command. Failed and uncertain saves retain
the open draft, and uncertainty keeps the shared attempt locked.

The library permits 32 shows and 256 total immutable versions. The 128 KiB
limit counts the UTF-8 bytes of the exact stored JSON document, including its
identity and names. Thus plan bodies occupy at most 32 MiB before SQLite
overhead. Capacity refuses new saves and preserves earlier versions. Names
permit 1–80 Unicode characters without control characters. The existing
timeline limits still apply. There is no automatic starter save, deletion,
audio collection or analysis metadata.

`nanoleaf-shows/2.0` exposes bounded version summaries through owner-qualified
sync. The authenticated module read
`show-version?showId=<id>&version=<positive integer>` returns exactly that
immutable version. Bad identities, unknown versions and invalid stored data
produce fixed registry refusals; corrupt bytes remain untouched. The additive
tables start empty and survive restart in the existing private module store.
Existing favorites retain their separate browser-exclusion rule.

After the root build, the `music-shows`, `module-shows` and `show-model` tests
run through `npm run test:nanoleaf:built`. The existing
`node apps/runtime/dashboard/tests/nanoleaf-pages.browser.ts` entry includes a
real disposable gateway/core/module authoring journey, immutable versions,
stale and unauthorized saves, no device changes, no resend and light/dark
desktop/phone layout. Optional `DASHBOARD_RECEIPTS` keeps synthetic
screenshots outside the checkout. Source checks do not establish installed
or physical acceptance.

## Families

The module answers each device's own keys, `bunny.cmd.<family>.<device id>`, and serves
`device`, `nanoleaf-wall`, `nanoleaf-animations`, `nanoleaf-shows`, `nanoleaf-reactive-presets` and `music-lighting-device` through sync, as its health entry's
`serves` lists. Every device module serves `device` for its own devices (#967), so a
consumer syncs it from `bunny/modules/nanoleaf` by name. Its own schemas are
`nanoleafSchemas`; `nanoleafMessageSchemas` adds the general device families.

Favorites are private to the owner, so the device record and the wall view never hold a
favorite or preset name. `nanoleaf-animations` is the one exception, by design: it is the
selected device's animation options, the view a play request is chosen from, so it lists the saved
favorites with their names and recipes and the module's presets, and any principal allowed
to read the module's families reads them there. Favorites stay out of browser projections;
the wall pages (#934) apply that rule.

| Family | Kind | What it does |
| --- | --- | --- |
| `device` | state | Each controller's `device/2.1` record, with `held` while a hold stops its writes |
| `nanoleaf-wall` | state | Each controller's wall map: settings, palette, projects, elements and tasks with their eviction tokens, whether its last pass failed or no worker runs (`failing`), whether a hold stops its writes (`held`), and the light's last read selection and latest Music base (`selection`, `musicBase`; #1614) |
| `nanoleaf-animations` | state | Each device's animation options: presets, favorites, patterns, bounds, the queued animation, saved positions and the remembered scene |
| `nanoleaf-reactive-presets` | state | The bounded private library of frozen reactive recipes at `reactive-presets` |
| `nanoleaf-reactive-preset-save` | command | Save one immutable named reactive recipe against the current library revision, with a metadata-only outcome |
| `nanoleaf-shows` | state | The private decorative library's immutable version summaries, with subject `shows` |
| `nanoleaf-show-save` | command | Append a guarded named decorative version at target `shows`, with a metadata-only outcome |
| `device-mode-set`, `power-set`, `brightness-set`, `scene-activate` | command | Work, Quiet and Free; power, brightness and scenes |
| `moment-play` | command | Bounded Lines moments in Work or over a named Free base; terminal outcome follows restoration |
| `music-lighting-work` | command | From the core only: start a live Music session on Lines over a named Free base, or stop it; Start completes with its streaming entry, Stop after its restoration |
| `music-lighting-device` | state | Each light's live Music session record: none, `starting`, `playing`, or `ended` with its reason, restoration and time |
| `zone-power-set`, `media-start`, `media-control` | command | Refused with `unsupported-capability` |
| `nanoleaf-wall-edit` | command | One edit from the wall editor: settings and palette, element projects and halves, a task's project, a project's color, Locate, an eviction |
| `nanoleaf-machine-edit` | command | One map edit from a machine, guarded by `expectedConfigurationRevision` |
| `nanoleaf-animation-play` | command | A preset, a favorite or a recipe, on Lines or NL22 Light Panels in Free |
| `nanoleaf-favorite-edit` | command | Save, rename or forget a shared favorite through the Lines command key |
| `nanoleaf-notice-acknowledge` | command | Acknowledge a finished turn the wall shows, for consumer `nanoleaf` |

Requested animations use the selected device's saved geometry: paired logical zones for
Lines and one physical zone per NL22 triangle. Each device keeps its own queue, mode,
scene and worker. Spatial patterns require saved positions, and every effect keeps the
existing frame and byte bounds. Favorites remain one shared catalog of frozen recipes,
edited through the Lines command key; an edit updates both devices' animation options.
A requested animation whose answer is lost ends uncertain without retry or a device
hold, preserving the existing Lines behavior. Native controls retain their holds.
Combined Lines-and-Panels placement and physical appearance qualification are separate.

## Wall editor

The API 1.3 manifest declares a React `wall` page. The module's `./frontend` export
contains a thin React host around the retained wall controller and Prism; it shares the
dashboard's authenticated API, connection and tracked Command component. Browser source,
reference artwork and exact upstream hashes are in [src/frontend/README.md](src/frontend/README.md).
No backend implementation is imported into the browser.

The page syncs only `device` and `nanoleaf-wall` from this owner. It keeps Lines and Panels
selection, the task/project inspector, map controls, keyboard selection, local assembly
and number preferences. A stale sync disables editing and offers an explicit read retry.
A refused read whose code may clear is also read again on its own after 1 s, doubling to
30 s, through the SDK's shared `followCopy` (#1540); only the read repeats.
Read-only users can inspect the wall and change local display preferences; mutations
still require the runtime's control authority and browser Origin checks.

| Editor action | Existing owner command |
| --- | --- |
| Classic/Project, coverage, rotation, flips and palette | `nanoleaf-wall-edit`, `settings` |
| Reserved/shared element assignment and signature swap | `nanoleaf-wall-edit`, `assign` |
| Project color | `nanoleaf-wall-edit`, `project-color` |
| Locate and device-only eviction | `nanoleaf-wall-edit`, `locate` or `evict` |
| Work, Quiet and Free | `device-mode-set` |

Each action keeps the selected device and uses the shared request identity and operation
tracker. Acceptance remains separate from completion. Reload and reconnection do not
resend an action, and an uncertain command stays locked. Selection does not acknowledge
an unread task. A qualified Codex Desktop task may expose `codex://threads/<UUID>` from
its source identity; titles, other clients and malformed IDs cannot supply a link.

`/modules/nanoleaf/content/editor-layout?device=<id>` reads cached connector geometry for
one configured Lines device. The JSON document is `nanoleaf-editor-layout/2.0`, with a
device ID and sanitized graph, limited to 256 KiB, 300 Lines and 600 nodes. Panels use the
wall record's saved triangle outlines. Opening or refreshing this read never discovers
geometry, contacts a controller or changes a scene/file. Missing geometry has an honest
unavailable notice; a standard outline remains usable when saved outlines exist.
The page does not read animation favorites or private stores.

The shared dashboard's existing device card reports observed power independently of
requested mode or power. This page adds no power observation or second device writer.
A full React editor rewrite, enrollment, geometry discovery, legacy-data transfer and
physical-device qualification are outside this port.

## Commands and outcomes

- **Admission** runs in the module's outbox transaction. It applies the port's domain
  checks (content in Free only, one waiting animation per device, 32
  waiting native commands, `validFavoriteEdit`, the effect rules) and `commandSupported`,
  and refuses a stale `expectedConfigurationRevision` or `expectedGeneration` with
  `revision-conflict`. A refusal, or a store failure, rolls back and is the reply. A
  store that is full (`SQLITE_FULL` or `ENOSPC`, told by their codes) is `capacity`,
  which the bus records at WARN; any other store failure is `internal`, which the bus
  records at ERROR and the module logs once more, at ERROR with the error's type. No record
  carries the error's text (#1001).
- **Outcomes.** An accepted command commits its journal row before the `accepted` reply
  and ends with one outcome through the outbox, in the command's trace, with the
  registry's error detail. The worker's writes end native commands and animations; edits
  and favorites end in their admission's transaction.
- **A device that answers with an error.** A device that answers a write with an HTTP
  error status heard it and refused it: the command fails with evidence `transmitted` and
  the code for the status (401 `unauthenticated`, 403 `forbidden`, 404 `not-found`, 409
  `invalid-state`, 429 `capacity`, 5xx `unavailable`, any other `invalid-request`). Nothing
  holds the device, and the pass starts again without the command.
- **Modes.** A mode is the module's own state, so, as the epic's coordinator decided on
  #844 and PR #968, a `device-mode-set` commits its mode, ending the device's queued work,
  its hold and its overrides, and completes `succeeded` with evidence `observed` in its
  admission's transaction, whether or not the device answers. Nothing is sent to the
  device as part of it, so it has no expiry: the worker paints the mode as the module's
  state once the device answers, and the device's availability shows whether it has.
- **Expiry.** A device write (power, brightness, a scene, an animation) still queued at its
  expiry fails `expired`, whether or not a worker runs. It never reached the device, so it
  proves no effect and holds nothing.
- **Desired state.** A power or brightness command that fails, whether it expired, was
  refused by the device or was cancelled at a restart, takes its desired power or
  brightness with it, unless another command of its kind still waits.
- **Holds.** Only a write that may have reached the device holds it: one whose answer did
  not come, or an attempt a restart found without a result. The hold lasts until an
  explicit mode command or a fresh control (power, brightness, a scene or an animation),
  and the write is never retried. While it lasts, the device record is `degraded` and its
  `held` names the held write's request ID and the time the hold began (`device/2.1`,
  #975), the wall view shows `held`, and the module logs the hold once as it begins and
  once as it is released. The record after the release has no `held`. The journal keeps
  the held operation with the hold (`control_holds`), so a restart shows the same `held`.
- **Live Music.** A `music-lighting-work` Start ends `succeeded`/`transmitted` with its
  streaming entry, or fails before it (`unavailable` for no fresh feature, `invalid-state` for
  an alert, `cancelled` for a newer choice or Stop, `expired`). A Stop ends after its
  restoration: `transmitted` if restored, `observed` if skipped, `uncertain` if a
  restoration write's answer was lost, and `invalid-state` if its session ended another
  way first.
- **Restarts.** Each command accepted before a restart with no outcome ends at the start
  and never runs. An attempt without a result is uncertain, and so is an acknowledgment
  whose request may have reached the core. A queued command fails `cancelled`, and so does
  a waiting machine edit. Saved comets are dropped.

## Wall-editor ownership

The wall map is the editor (ADR 0007). Each device carries a configuration revision in its
`device` and `nanoleaf-wall` records. Wall edits of settings, elements, a task's project
or a project's color, mode commands, applied machine edits, favorite edits and a selection
of shared input move it; the palette, Locate and evictions do not. Machine edits apply to
the Lines, one waiting at a time:

1. A machine edit is refused with `revision-conflict`, saying why, while a wall edit is
   pending on the device (`refusePendingWallEdit`).
2. A queued machine edit fails with `revision-conflict`, without overwriting the newer
   choice, when a later wall, mode or association edit lands first (`processMachineEdits`).
3. A machine edit waits while the device's comet runs, then applies, or fails `expired`.

A machine edit's check at admission (`checkEdit`) and a queued machine edit's application
(`processMachineEdits`) each run under a savepoint inside the caller's transaction. A
failure that leaves the transaction open rolls back to the savepoint, keeping the caller's
work. On a full disk SQLite undoes the failing statement and, depending on where the error
comes, may end the whole transaction and the savepoint with it. Either way the edit throws
the full disk's error, never a failed savepoint rollback's (#1001): while the transaction is
open, the savepoint rolls back the edit's other writes; once SQLite has ended it, there is
nothing left to roll back. A command whose admission meets a full disk is refused
`capacity`, with nothing changed, and a queued edit waits until the store takes it.

## Sessions

The module follows the core's `session/2.0` records through the SDK's sync and keeps its
copy in memory only (`SessionFeed`, `SharedCopy`).

- A completed sync, the first or one after an overflow, is projected as a fresh start, so
  no comet or wave replays. Each live change is projected as one change.
- A new shared-input configuration at start pauses shared input, and the first sync
  selects it again. A step that carries the shared-input generation from before the new
  configuration changes nothing. Inside one runtime the feed's generation moves with each
  projection, so this guard is defensive there; a second runtime on the same state is kept
  out by the workers' lock files.
- A copy that stops following the core freezes the tasks until a later sync, which the
  module tries again with capped backoff.

## Concurrency

- Every transaction is synchronous, on the module's one connection; none spans an await or
  a device request, so transactions take turns by construction and nothing waits inside
  SQLite on the event loop.
- One supervised worker per device (`superviseWorker`), with its lock file in the private
  folder, which also excludes a second runtime on the same state. An accepted command
  starts its device's worker when none runs. A worker that ends on a failure, because the
  store was busy or full or another instance held its lock, starts again after a wait that
  doubles from 1 s to 30 s. One start waits at a time per device: a worker that a command
  or a selection starts meanwhile replaces it, and its end schedules the next. Meanwhile
  the device shows `degraded` and its wall view `failing`.
- Each device request goes through the device's link (`DeviceLink`), which settles within
  1.2 s on the module's scheduler and abandons a request at the module's stop.
- Each worker wait is rounded up to the runtime scheduler's whole milliseconds.
- The views are built on the event loop whenever a request settles, so the saved layout,
  its geometry and the remembered scene are read again only when their file changes.
- The lock files, `notification-lock*.sqlite` and `layout-lock.sqlite`, are created with
  mode 600, so their journals are private too.

## State and availability

The `device/2.1` record is published only when it changed (ADR 0012: a poll that changed
nothing publishes nothing). Its observation is the power and brightness the device
reported to `GET /state`, with `observedAtMs` the time of the reading that first showed
them; consumers judge freshness by `availability`, as for the playback and LIFX records.
The module reads `GET /state` every 5 s while the device answers and backs off to 30 s
while it does not; once the device answers any request again, the next read comes within
5 s. `lastTransmission` is the last write that reached the device, the module's own paints
included, with the command's request ID when the write served one; a write the device
answered with an HTTP error reached it, so it counts. The module keeps it apart from the
last outcome and saves it (`nanoleaf_transmissions`), so an outcome that sent nothing, a
poll and a restart leave it as it was. A change that includes a command's write is
published at once. A change from paints alone is published at most once every 5 s
(`TRANSMISSION_MS`): the record is built again as each device request settles, so a later
paint shows with the first request after the interval. That is within one 5 s poll while
the device answers; once it stops answering, the poll shows it as it times out, up to
1.2 s later. Availability is:

- `unavailable` while the device does not answer;
- `degraded` while it answers and the module does not present it: it refuses the module's
  token (401 or 403), its last pass failed, a hold stops its writes, which `held` names,
  or no worker runs;
- `available` otherwise, once it has answered; `unknown` before.

## Failures and logs

A device's errors and timeouts are outcomes and the device's availability, never module
failures (policy A); no scheduler callback throws. The module logs registered module
events only: `device.unavailable` once as an outage begins and `device.available` once as
it ends, with DEBUG summaries between; `operation.failed` once per run of other failed
passes, a device refusing the module's token (one record, the link's, not one per failed
pass as well), a hold, a worker that ended on a failure (each later end of the run at
DEBUG), a failed publication (`bunny.operation` `snapshot`, tried again each second so the
records reach readers within a second of the store reading again, where the next poll
could be 5 to 30 s away) or a failed session sync, and `operation.completed` at each
recovery, a failed pass's only once a worker presents the device again; `feed.changed`
when shared input is selected; and its outbox's `outcome.published` and `outbox.deferred`.
Each device write made for a command records a `bunny.device.call` span in that command's
trace. Records hold codes, error types and IDs, never an exception's message, an address
or a token. The port's own error messages may quote input, so none reaches a record or a
body.

## Simulated controllers

`SimulatedNanoleaf` answers the local API's requests as a Lines (six Lines) or NL22
(four triangles) controller would, accepts only the synthetic token `tok_SYNTHETIC919`,
keeps its state across a runtime restart, and can go offline, hold its requests, lose a
write's answer, answer a write with an HTTP error, lose a saved scene, take another token
or be switched off as the Nanoleaf app would. With `anyAddress` it answers
every address a configuration names; the shipped runtime's `--simulate` build uses that.

## Checks

From the repository root, with Node 24: `npm run test:nanoleaf`, which builds and runs
every suite in `dist/tests/`, the port's translated and recorded tests, the module's
(`module.test.ts`, and `module-faults.test.ts` for its faults and recoveries), its module
test kit run (`module-kit.test.ts`), the journal's outcome errors and the migration (`migration.test.ts`). The runtime's `nanoleaf.test.ts`, the catalog's `nanoleaf-wall` scenario
and its disposable run cover the module under the runtime. See
[Nanoleaf port](../../docs/development.md#nanoleaf-port).

The public `./frontend` entry also exports `NanoleafLightVisual` and its
`WallRecord` input for shared lighting cards (#1135). The read-only visual takes
the shell's authenticated read function, reuses the retained Prism renderer for
saved Lines geometry and draws saved panel polygons. It creates no connection
and sends no command. Missing geometry has a labelled placeholder; advanced wall
editing remains on the module page.
