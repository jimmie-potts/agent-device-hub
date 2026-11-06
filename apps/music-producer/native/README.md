# Native audio input

This directory contains Music.app audio capture, selected microphone capture
and a read-only Music state/position reader, plus a distinct playback adapter.
These are source components of the Music producer, not installed services.
For capture, the owning Node process admits the session, consumes its records
and uses the authenticated SDK edge. The runtime owns the capture session and
Nanoleaf owns rendering and device writes. The position reader has no SDK
integration. The playback adapter observes the selected Music process and
accepts only four explicit transport actions through its parent. None of the
helpers opens a network connection, selects an output or analyzes a prepared
track.

## Build and source checks

From the repository root:

```sh
sh apps/music-producer/native/test.sh
sh apps/music-producer/native/build.sh
sh apps/music-producer/native/adapter-test.sh
apps/music-producer/native/build/music-capture --self-test
apps/music-producer/native/build/music-capture --clock
apps/music-producer/native/build/music-position --self-test
apps/music-producer/native/build/music-position --clock
```

`test.sh` builds portable C11 signal, concurrent transfer and playback-operation
tests with `cc`, `libm` and pthreads. It runs on Linux and macOS. Generated samples cover silence,
opposite-phase stereo, RMS, peak, clipping, bass/mid/treble separation, invalid
samples and formats, partial windows, timestamp gaps, discontinuity resets and
newest-value transfer under a concurrent writer. The playback cases substitute
the selected process, clock, permission, reads and control calls. They cover
partial item identity, output limits, deadlines and transmission evidence.
Temporary binaries are removed.

`build.sh` requires macOS SDK 26 or later, selected through Xcode or Command Line
Tools. The source references `processRestoreEnabled`, introduced in that SDK,
and guards its runtime use with `@available(macOS 26.0, *)`. CI selects Xcode 26.3
on its macOS 15 runner; the build SDK and runner OS are separate requirements.
The script compiles `build/music-capture`, `build/music-position` and
`build/music-playback`.
Their deployment target is macOS
14.2, Apple's minimum for process taps; this is not tested-OS evidence. Source
compilation and synthetic checks do not qualify capture on every OS version,
output route or protected music source.

The scripts select no persistent signing identity; a linker may apply an ad-hoc
signature. Embedded plist identifiers can differ from code-signing identifiers.
Actual permission attribution and grant persistence need installed qualification.

`adapter-test.sh` builds a different executable whose Core Audio access functions
and AVFoundation authorization class are all replaced with test implementations. It checks exact Music inclusion,
unmuted private-tap configuration, no output subdevice, zero audio access from
startup, self-test and clock modes, source/format failures, invalid buffers,
stop, EOF, signals and every cleanup attempt after acquisition failures.
It also covers exact microphone UID selection, input-only IOProc stream usage,
permission refusal/revocation, removal, setup discovery and permission-only
operations. Its capture invocations use generated samples and cannot capture audio.
It also builds a separate position executable with fake process lookup,
permission preflight and AppleEvent sends. Its scenarios check exact getter
descriptors and flags, process replacement, partial reads, five state enums,
numeric descriptor validation and harmless modes. No event reaches an application.
The playback executable similarly substitutes every process, permission and
AppleEvent call. It checks the exact property/action allowlist, before/after
identity, selected-output bounds, malformed descriptors, partial fields,
known-unsent failures, uncertain sends and late definitive replies.
The script needs macOS SDK 26 or later and Python 3.

`--self-test` passes generated PCM through the production callback and emits one
synthetic frame. It calls no Core Audio API. `--clock` emits only
`{"schema":"music-native-clock/1.0","monotonicMs":...}` and calls no audio API.
The parent uses the latter to qualify the native clock against its own local
monotonic clock before accepting source age calculations.

## Explicit playback observations and controls

The separate `music-playback` helper implements the native boundary for
[#571](https://github.com/jimmie-potts/agent-device-hub/issues/571). It accepts
`--clock`, `--self-test`, `--read-existing-music`, or exactly:

```text
--control-existing-music <play|pause|next|previous> <sourceInstance> <deadlineMonotonicMs>
```

The parent supplies the 64-character lowercase process digest from an admitted
observation and a deadline in the qualified local continuous clock domain.
Neither value selects another application. The helper requires exactly one
already-running `com.apple.Music` process, pins its PID and launch identity, and
rechecks both around operations. It never launches, activates or reconnects
Music. Unknown or absent arguments perform no process discovery or automation.
Clock and self-test modes also perform no process discovery, permission query
or application event. The older `music-position` and audio helper keep their
separate commands and formats unchanged.

Permission preflight uses `askUserIfNeeded: false`. Reads send only `core/getd`;
controls send only `hook/Play`, `hook/Paus`, `hook/Next` or `hook/Prev`, without
an item argument. Every send uses the same nonprompting, never-interact,
no-recording and no-reconnect flags as the position reader. A control is sent
once. A wrong process digest, expired budget or permission refusal sends nothing.
An explicit Music reply is transmitted evidence, including a reply received
after the deadline. A timeout, malformed reply or process replacement is
uncertain and is never retried.

Read work has a five-second budget. Track reads use at most four seconds;
optional display fields leave one second for the closing identity read.
Selected-output reads have at most one second, including any unused overall
budget. A control has at most three seconds or the supplied remaining budget.
Each AppleEvent waits at most two seconds and never more than its phase's
remaining whole ticks. These budgets bound new calls, not an OS call that fails
to return or a blocked stdout. The parent must retain its termination watchdog
and child ownership until exit is known.

Read allowlists are player state/position, current track, persistent item ID,
title, artist, album and duration. Before/after item IDs must match to associate
position and display fields with that local item. Matching establishes a bounded
observation interval, not an atomic snapshot or a particular recording's audio.
A missing or changed item leaves association unavailable while preserving valid
position evidence. The digest identifies a process lifetime; an item ID is
uppercase hexadecimal and identifies a Music item in its separately declared
local library scope. The helper claims no recording fingerprint or audible time.

Output evidence reads Music's `current AirPlay devices`, `AirPlay enabled`, and
only the returned selected references' name, kind, active, available and selected
properties. It processes at most eight references. An empty list is valid;
an oversized list refuses rather than truncates. The provenance is
`music-declared-selection`, with separate list/property intervals and explicit
partial fields. Indices belong only to that observation. A `computer` entry
does not identify a Core Audio output, and Music's `active` report does not prove
sound reached a speaker. The helper reads no network/MAC address, volume, entire
device catalog, file, artwork, lyrics or broad `properties` object. It sets no
property and changes no output route.

The internal pipe emits exactly one closed NDJSON record. `music-playback-read/1.0`
contains either `status: "unavailable"` with a fixed registry error, or `sample`
with `sourceInstance`, `state`, `position`, `item`, `itemAssociation`, `metadata`
and `outputSelection`. Every scalar field is either
`{status: "observed", value, interval}` or
`{status: "unavailable", error, interval}`. The overall record, each field,
item association and output selection retain continuous-clock request/reply
intervals. A forbidden result or process replacement invalidates the whole read.

`music-playback-control/1.0` contains the action, `expectedSourceInstance`, overall
interval, `sendInterval`, and `sent`, `refused`, `unsent` or `uncertain` status.
Only `sent` omits its fixed error. `sendInterval: null` means no control event was
attempted; otherwise it records the actual send/reply interval. Samples and sent
controls exit zero. Unavailable reads and other control results exit one.
Harmless modes use `music-playback-clock/1.0` and
`music-playback-self-test/1.0`. All fixed errors use the shared registry's
retryable flags; those flags grant no command retry.

The record limit is 16,384 UTF-8 bytes including its newline. Display strings
are at most 256 UTF-8 bytes, output labels 128 bytes and item IDs 128 ASCII hex
characters. Oversized fields become unavailable. If the complete escaped JSON
exceeds the record limit, the helper returns a fixed capacity refusal instead
of partial JSON. Descriptor data above 65,536 bytes is refused before application
copying/decoding; this does not bound allocations inside Apple's event delivery.
Embedded NUL, malformed types, invalid UTF-8 and nonfinite numeric values refuse.
Numbers preserve real zero and the position reader's safe millisecond bound.
The parent separately limits discarded stderr to 4 KiB.

The helper writes no file or diagnostic log and opens no network. Listening
metadata and output names belong only in the owner's private declared records,
never published source evidence. Its embedded bundle identifier is
`local.bunny.music-playback` with an automation usage description. Signing,
automation entitlement, packaged permission behavior, actual field availability
and physical control/timing remain separate installed qualification. Fake descriptor success is not evidence of any of those results.

## Explicit state and position reads

The separate `music-position` helper links AppKit and CoreServices, without the
capture implementation. Only `--read-existing-music` enters its read path.
Unknown arguments, including `--capture`, return a fixed `invalid-request` and
exit 1. Its `--clock` returns `music-position-clock/1.0` with continuous monotonic
milliseconds. Its `--self-test` checks synthetic descriptors and emits a boolean
`passed` in `music-position-self-test/1.0`. Neither harmless mode selects Music
or sends AppleEvents.

The TypeScript `MusicPositionReader` supervises the explicit read. The helper
requires exactly one already-running `com.apple.Music` process with a launch
date. It pins PID, bundle and launch date, rechecks them before and after each
reply, and discards the entire cycle if identity changes. Only a SHA-256 process
instance digest crosses the pipe; the PID and launch date do not. This digest
identifies a process lifetime and contains no track identifier.

Permission preflight calls `AEDeterminePermissionToAutomateTarget` with
`askUserIfNeeded: false`. Each `core/getd` event targets the pinned PID and reads
only `pPlS` or `pPos`. Sends use `kAEWaitReply`, `kAENeverInteract`,
`kAEDoNotPromptForUserConsent`, `kAEDontRecord` and `kAEDontReconnect`, with a
120-tick deadline of two seconds. The helper never opens or activates Music.
Permission refusal ends the cycle. State failure prevents the position request;
position failure preserves the separately observed state. OS error text is
replaced by fixed registry errors. There is no implicit retry.

One `music-position-read/1.0` NDJSON record reports either a `sample` or
`unavailable`. A sample contains `sourceInstance`, a whole-cycle `interval`,
`state: {value, interval}`, and `position`. Every interval contains
`startedMonotonicMs` and `endedMonotonicMs` in the continuous clock domain.
Observed position is `{status: "observed", seconds, interval}`; a failed position
is `{status: "unavailable", error, interval}`. Complete failure contains only
the schema, status, cycle interval and registered error. Samples exit 0,
including partial position samples; complete failures exit 1.

State permits only `stopped`, `playing`, `paused`, `fast-forwarding` and
`rewinding`. Position permits signed 16/32/64-bit integers, unsigned 32-bit
integers and IEEE 32/64-bit floating-point descriptors. Values must be finite,
nonnegative seconds, at most `Number.MAX_SAFE_INTEGER / 1000`. Strings and
booleans are refused before coercion. The bounds preserve safe millisecond
conversion and distinguish zero from missing evidence.

The helper writes no file or diagnostic log and collects no title, artist,
recording identifier, output route or audio. It requires the supervising
five-second deadline because synchronous OS calls and a blocked stdout cannot
be bounded by the event timeout alone. Do not use an unbounded standalone read
as an installed polling service.

The distinct embedded bundle identifier is `local.bunny.music-position`, with
`NSAppleEventsUsageDescription`. A packaged
hardened-runtime build needs its selected signing and automation entitlement
reviewed separately. Apple's [automation permission API](https://developer.apple.com/documentation/coreservices/3025784-aedeterminepermissiontoautomatet)
and [usage-description documentation](https://developer.apple.com/documentation/bundleresources/information-property-list/nsappleeventsusagedescription)
describe those boundaries. Compilation and descriptor fakes do not establish
permission for the installed parent/helper identity, continuous position
accuracy, pause/seek behavior or audible timing.

## Explicit capture and lifetime

The exact `--capture` argument enters the Music path; `--capture-microphone`
enters the selected microphone path. No argument or an
unknown argument emits a fixed `invalid-request` terminal record and exits 2.
Permission grant alone never starts a session. The parent must keep stdin open
and consume stdout through a pipe or local socket. Capture refuses stdout to a
terminal or regular file. This is a parent-owned child process, not an interactive
recording tool.

The source list includes only audio process objects whose bundle identifier is
exactly `com.apple.Music`. An empty list refuses capture. The tap is private,
inclusive and unmuted. The private aggregate contains only that tap, with no
output subdevice. The helper does not select or change an output device or route.
On macOS 26 and later, process restoration is explicitly disabled. The initial
process identities remain fixed for this invocation; it never follows a new
Music process or changes to a microphone or another application.

Before creating the tap, the helper observes each selected Music process's
`kAudioProcessPropertyDevices` in output scope and installs a listener on that
property. It admits at most 32 selected processes with at most 32 output device
IDs each. Empty, unreadable, duplicate or oversized route observations refuse
capture. IDs stay in memory and are never emitted. A route notification ends the
session even when its sample rate and channel count remain unchanged. The main
loop also compares the bounded output device lists once per second. It never
substitutes the system default output or observes unrelated process routes.
The helper stops on any selected-route notification because it invalidates the
session's route qualification. A later session needs an explicit start.

Microphone capture first reads a closed `music-native-input/1.0` JSON line with
only `schema` and `uid`. It permits at most 8192 bytes and two seconds for this
startup record; the UID is 1–1024 UTF-8 bytes. EOF, stop or signals before selection
cause no audio access. Authorization must already be granted. The helper resolves
that exact UID through `kAudioHardwarePropertyTranslateUIDToDevice` and verifies
its UID and alive state. Missing or unsupported devices are refused. It never
reads or switches to the default input.

The selected device must expose exactly one input stream in the existing
mono/stereo Float32/Float64 formats. Per-IOProc stream usage enables that input
and disables every output stream, then reads both settings back before starting.
The helper changes no system default, gain, sample rate or hog ownership. Device
alive/UID, input/output stream and virtual-format listeners retire the session;
control-thread checks also detect permission revocation or device loss. There
is no process tap or aggregate for microphone capture. Cleanup owns only this
helper's listeners and IOProc.

`--list-microphones` is explicit setup only. It reports at most 64 devices, each
with at most 32 input streams, a UID of at most 1024 UTF-8 bytes and a name of at
most 256 UTF-8 bytes. The local JSON output is capped at 512 KiB. It requests no
permission and opens no capture. Its names and UIDs are private owner setup data.
`--authorize-microphone` separately checks AVFoundation audio authorization and
requests it only when undetermined. It reports a fixed result and opens no audio
IO. It ends on parent loss, a signal or its 120-second waiting bound. Starting a
capture never invokes this permission request.

The parent ends capture by writing `stop\n`, closing stdin or sending SIGTERM or
SIGINT. Any other control bytes end it with `invalid-request`. The loop also ends
after 24 hours. After deciding to stop, it stops and destroys the IOProc, removes
the format listener, and destroys its private aggregate and process tap. It also
removes every selected-process route listener it installed. It
attempts all applicable cleanup steps even after a failure. Capture has no
automatic restart or retry. A cleanup failure produces a fixed terminal error.

The parent still needs a bounded termination watchdog. A synchronous Core Audio
call or system permission prompt can delay return to the helper's loop. The
24-hour loop bound and signal handling do not bound an OS call. Process exit
retires this process's private resources; an interrupted final line or missing
terminal record is possible on forced termination or broken stdout. The parent
must use child exit and invalidate the session, never infer success from silence.

## Local numeric records

Stdout carries newline-delimited JSON only. These records are an internal child
process interface, not a second runtime transport. The parent validates them,
adds its session/source identity and generation, and wraps admitted measurements
in the shared event contract. Capture emits no raw PCM, audio file, track identifier, process list, route name,
UID, credential, arbitrary exception or OS error text. The separate explicit
inventory command emits only the owner-local setup data described above.
The helper creates no audio file or local diagnostic log.

Every measurement uses `schema: "music-native-frame/1.0"` and these fields:

| Field | Meaning and bound |
| --- | --- |
| `sequence` | Starts at 1 and increases for every completed window, including windows replaced before publication. |
| `sampleRateHz` | Integer from 8000 through 192000, divisible by 10. |
| `channels` | 1 or 2. Channels contribute separately, so opposite-phase stereo does not cancel. |
| `frameCount` | `sampleRateHz / 10`, exactly 100 ms of samples. |
| `startMonotonicMs`, `endMonotonicMs` | First-sample time and exclusive end of the measurement window in the Mac continuous clock domain. End is start plus 100 ms. |
| `emittedMonotonicMs` | Same clock at record formatting, before its first stdout write. It does not include subsequent pipe delay. |
| `rms`, `peak` | Linear amplitude from 0 through 16. No normalization or saturation is applied. |
| `clippedFraction` | Fraction of channel samples with absolute value at least 1, from 0 through 1. This detects full-scale crossings, not upstream clipping that has already been reduced. |
| `bands.bass`, `bands.mid`, `bands.treble` | Filtered RMS, each from 0 through 32. Residual filters can transiently exceed the input amplitude bound. |
| `onset.strength`, `onset.confidence` | Heuristics from 0 through 1, defined below. Neither is a musical beat or tempo estimate. |
| `discontinuity` | True for the first complete window, after a sample/clock discontinuity, or when this reader skipped complete windows. |

The callback accepts packed native little-endian Float32 or Float64 PCM,
interleaved or planar, with exact buffer sizes and at most 8192 frames per
callback. It validates the entire callback before accepting any of its samples.
Empty callbacks produce no measurement. Nonfinite values, absolute amplitude above 16, unsupported layouts or invalid
timestamps terminate capture. Values above 1 are preserved and counted as
full-scale crossings. Samples are consumed directly from Core Audio buffers;
only scalar analysis state and completed numeric frames survive the callback.

Bass is a first-order 200 Hz low-pass. Mid is a first-order 2000 Hz low-pass minus
the 200 Hz low-pass. Treble is the sample minus the 2000 Hz low-pass. Each filter
uses `alpha = 1 - exp(-2 * pi * cutoff / sampleRate)`. These are simple filtered
RMS bands, not FFT energy, orthogonal bands or a perceptual loudness measure.
Their energies need not sum to the original signal's energy.

Onset strength is the positive RMS rise relative to the current RMS,
`max(0, (rms - previousRms) / rms)`, with a small zero guard. Confidence is
`strength * min(1, rms / 0.05)`. The first window after a reset has zero strength
and confidence. This fixed level weighting suppresses weak rises; it is not a
calibrated probability, microphone noise-floor calibration or musical beat
confidence. At 10 Hz, onset resolution is one 100 ms window.

Core Audio's input host ticks use `mach_absolute_time`, which excludes sleep.
Publication uses `mach_continuous_time`, which includes sleep. The callback maps
input host ticks using the current continuous-minus-absolute offset. An offset
change above 2 ms resets filters and the partial window. A sample-time gap above
half a sample or host-time gap above 2 ms also resets analysis. Missing,
nonfinite or backwards host timestamps are refused. The next complete frame
marks a discontinuity; partial windows are discarded, not padded with invented
silence. The helper never publishes a frame whose end is in its future.
The parent must qualify its clock with `--clock`, count sequence gaps, check
age after receiving each full line, and refuse old generations. Comparing this
Mac clock directly with a Linux runtime clock is invalid.

The callback writes a three-slot single-writer/single-reader transfer using
lock-free atomics. A slow reader gets the latest complete frame and sees its
sequence gap. The publisher runs off the callback and owns at most one 2048-byte
pending record. Writes are nonblocking; a record stalled for one second ends
capture. No PCM queue grows with consumer delay. A partial stdout record may be
lost on stop; the parent treats malformed output or an unexpected exit as
unavailable and does not reuse the last frame.

## Refusals and qualification limits

Music terminal failures use `schema: "music-native-terminal/1.0"`; microphone
terminal failures use `music-native-terminal/1.1`. Both carry the shared
`error: {code, retryable, detail}` body. `detail` comes from fixed strings in the
helper. The existing registry supplies `invalid-request`, `invalid-message` and
`unsupported-capability` with `retryable: false`, and `unavailable` and `capacity`
with `retryable: true`. The flag never authorizes an automatic capture retry.
Normal stop exits 0 without a terminal record. Failures exit 1, except usage
errors, which exit 2. A closed or stalled output may prevent a terminal record.

The helper observes selected process loss once per second and ends on tap-format
or observed output-route change. It does not classify absence of callbacks as permission revocation,
pause or silence. The parent reports freshness separately. Core Audio acquisition
failures map to `unavailable`; they do not prove permission was denied. There is
no automatic fallback, output-route switch or permissions reset.

The embedded bundle identifier is `local.bunny.music-producer`, with
`NSAudioCaptureUsageDescription` and `NSMicrophoneUsageDescription`. Packaging,
signing, responsible-process identity, the system audio recording permission
flow, microphone authorization identity and installed parent/child termination
need qualification in the selected
Mac installation. Do not infer a stable permission grant from compilation.

Apple's [Core Audio tap example](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps)
describes per-process taps and their permission requirement. It does not qualify
this installation's protected Apple Music material or every AirPlay route.
An AirPlay destination change that Core Audio does not expose as a selected
process output-device change is not qualified by this check. There is no DRM
bypass or blanket AirPlay support claim. Source tests establish
numeric and lifecycle behavior with generated input; installation and physical
timing acceptance remain separate work under the owning issue.

Apple's [capture authorization guide](https://developer.apple.com/documentation/AVFoundation/requesting-authorization-to-capture-and-save-media)
owns the microphone permission API. Compilation and substituted adapter tests do
not prove permission behavior for a signed installed helper or a real device.
This native helper emits raw digital measurements with the same analyzer
definitions for both inputs. The [runtime core](../../runtime/README.md#music-capture)
owns calibration evidence and tuning settings; Audio shows a separate response
preview. Those settings do not change this helper's analyzer or microphone gain.
