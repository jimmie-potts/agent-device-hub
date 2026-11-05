# Native Music input

This helper measures Music.app output for an explicitly selected lighting session.
It is the native part of the Music producer, not an installed service. The owning
Node process admits the session, consumes these records and uses the authenticated
SDK edge. The runtime owns the session and Nanoleaf owns rendering and device writes.
This directory adds no network connection, device command, microphone input,
playback control, Music metadata or prepared track analysis.

## Build and source checks

From the repository root:

```sh
sh apps/music-producer/native/test.sh
sh apps/music-producer/native/build.sh
sh apps/music-producer/native/adapter-test.sh
apps/music-producer/native/build/music-capture --self-test
apps/music-producer/native/build/music-capture --clock
```

`test.sh` builds portable C11 signal and concurrent transfer tests with `cc`, `libm`
and pthreads. It runs on Linux and macOS. Generated samples cover silence,
opposite-phase stereo, RMS, peak, clipping, bass/mid/treble separation, invalid
samples and formats, partial windows, timestamp gaps, discontinuity resets and
newest-value transfer under a concurrent writer. Temporary binaries are removed.

`build.sh` requires macOS and a Command Line Tools SDK containing Core Audio taps.
It only compiles `build/music-capture`. The deployment target is macOS 14.2, Apple's
minimum for process taps. Source compilation and synthetic checks do not qualify
capture on every OS version, output route or protected music source.

`adapter-test.sh` builds a different executable whose Core Audio access functions
are all replaced with test implementations. It checks exact Music inclusion,
unmuted private-tap configuration, no output subdevice, zero audio access from
startup, self-test and clock modes, source/format failures, invalid buffers,
stop, EOF, signals and every cleanup attempt after acquisition failures.
Its explicit-capture invocations use generated samples and cannot capture audio.
The script needs macOS Command Line Tools and Python 3.

`--self-test` passes generated PCM through the production callback and emits one
synthetic frame. It calls no Core Audio API. `--clock` emits only
`{"schema":"music-native-clock/1.0","monotonicMs":...}` and calls no audio API.
The parent uses the latter to qualify the native clock against its own local
monotonic clock before accepting source age calculations.

## Explicit capture and lifetime

Only the exact `--capture` argument enters the capture path. No argument or an
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

The parent ends capture by writing `stop\n`, closing stdin or sending SIGTERM or
SIGINT. Any other control bytes end it with `invalid-request`. The loop also ends
after 24 hours. After deciding to stop, it stops and destroys the IOProc, removes
the format listener, and destroys its private aggregate and process tap. It
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
in the shared event contract. No raw PCM, audio file, track identifier, process
list, route name, credential, arbitrary exception or OS error text is emitted.
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

Terminal failures use `schema: "music-native-terminal/1.0"` and the shared
`error: {code, retryable, detail}` body. `detail` comes from fixed strings in the
helper. The existing registry supplies `invalid-request`, `invalid-message` and
`unsupported-capability` with `retryable: false`, and `unavailable` and `capacity`
with `retryable: true`. The flag never authorizes an automatic capture retry.
Normal stop exits 0 without a terminal record. Failures exit 1, except usage
errors, which exit 2. A closed or stalled output may prevent a terminal record.

The helper observes selected process loss once per second and ends on tap-format
change. It does not classify absence of callbacks as permission revocation,
pause or silence. The parent reports freshness separately. Core Audio acquisition
failures map to `unavailable`; they do not prove permission was denied. There is
no automatic fallback, output-route switch or permissions reset.

The embedded identity is `local.bunny.music-producer`, with
`NSAudioCaptureUsageDescription`. This source build is unsigned. Packaging,
signing, responsible-process identity, the system audio recording permission
flow and installed parent/child termination need qualification in the selected
Mac installation. Do not infer a stable permission grant from compilation.

Apple's [Core Audio tap example](https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps)
describes per-process taps and their permission requirement. It does not qualify
this installation's protected Apple Music material or every AirPlay route.
There is no DRM bypass or blanket AirPlay support claim. Source tests establish
numeric and lifecycle behavior with generated input; installation and physical
timing acceptance remain separate work under the owning issue.
