# Music producer

This host-local application measures explicitly selected Music.app audio or one configured microphone for
[#721](https://github.com/jimmie-potts/agent-device-hub/issues/721). The Linux
runtime owns the capture session. The native macOS helper owns local PCM access
and analysis; the Node wrapper uses the existing authenticated SDK edge.

Connection advertises endpoint availability and any configured microphone alias. Only an explicit capture command starts the
helper. Stop, disconnect or shutdown retires its generation and pending frames.
The producer keeps sending raw digital measurements. The core owns microphone
calibration evidence and response settings, including noise gating, sensitivity,
smoothing and band emphasis. Audio previews their response through the shared
calculation. See the [runtime capture guide](../runtime/README.md#music-capture).
Prepared analysis and physical synchronization retain their own acceptance in
the issue.

The separate [local position reader](#local-state-and-position-reader) is a source
increment for [#571](https://github.com/jimmie-potts/agent-device-hub/issues/571).
The capture CLI does not invoke it or publish its observations.

## Foreground producer

After building, the entry point is:

```sh
node apps/music-producer/dist/src/cli.js --config /absolute/private/music.json
```

This command connects to the selected runtime and advertises one Music endpoint.
It launches no native helper until core sends an explicit start. Importing the
application also performs no work. The CLI runs on macOS; its portable parser,
lifecycle and disposable child tests run on Linux too. This is a source entry
point, not an installation or permission setup procedure.

The configuration and separate token file must be owner-only regular files,
owned by the process user. The reader refuses symlinks, group or other access,
and files larger than 8 KiB for configuration or 512 bytes for the token.
The token may have one trailing newline. Do not put it in command arguments.

```json
{
  "schema": "music-producer/1.0",
  "edgeOrigin": "http://127.0.0.1:8790",
  "tokenFile": "/absolute/private/music.token",
  "helper": "/absolute/build/music-capture"
}
```

For a microphone, use `music-producer/1.1` with one additional member:

```json
"microphone": {"id": "studio-mic", "uid": "owner-selected-device-uid"}
```

The public `id` is 1–64 ASCII letters, digits, dots, underscores or hyphens. Only
that alias crosses the SDK edge. The exact Core Audio `uid` is private, bounded
to 1–1024 UTF-8 bytes and passed to the native helper over its startup pipe, never
in command arguments. No display name is accepted. Existing `music-producer/1.0`
configuration still selects only Music. Version 1.1 without this member also
selects only Music. Connecting performs no device enumeration or permission check.
Configured capability does not prove that the device is present or permission
is granted. There is no default microphone or automatic fallback.

The helper has two separate, explicit setup operations:

```sh
/absolute/build/music-capture --list-microphones
/absolute/build/music-capture --authorize-microphone
```

Listing prints a bounded local JSON inventory containing private device UIDs and
names. Keep that output private. It neither requests permission nor captures.
Authorization checks or requests microphone permission only; granting it starts
no capture. Capture checks existing authorization and refuses if it is absent.
Select the UID and alias in the private configuration, restart the foreground
producer, then explicitly select and start it in Audio. Device removal, alias
mismatch or permission refusal produces no fallback to another input.

The origin must be HTTP or HTTPS without a path, query, fragment or credentials.
The helper and token paths must be absolute. Provision the credential separately
for the fixed source `bunny/parts/music-producer`, with no ordinary SDK scopes.
Its endpoint grant responds only to `music-capture-work`, publishes only
`music-capture-progress` and `music-capture-features`, and requests only
`music-capture-endpoint`. The wrapper accepts work only from `bunny/core` for its
current endpoint. A source or grant cannot be supplied in the configuration.

An explicit start first runs the helper's harmless `--clock` mode. Its reading
must fall between Node's before and after `process.hrtime` readings. Only then
does the wrapper invoke `--capture` for Music or `--capture-microphone` for the
configured microphone. Registration also checks core's reply time:
every possible clock offset must fit within 50 ms. Local wall/monotonic drift
above 25 ms invalidates that qualification, including while idle. Capture must
produce its first valid, fresh frame within five seconds. Silence is valid.
`started` is published only after that first frame, before any features.
The core also retains its registration-time wall/monotonic anchor through idle
and ordinary stop. Duplicate registration cannot reset it. An invalid anchor
refuses a new start and retires the connection before work is sent.

Every frame describes a 100 ms source window. The wrapper checks the closed
native schema, numeric ranges, fixed terminal errors, frame count, duration,
increasing sequence/time and stable format. It bounds each line at 2 KiB, each
read chunk at 64 KiB and each chunk at 128 records. It discards stderr and ends
the helper if stderr exceeds 8 KiB. Unknown fields and malformed output stop
capture without publishing their content.

Feature delivery permits one publication in flight and one latest pending frame.
Actual sends stay at least 100 ms apart. The wrapper recomputes source age at
publication, including child-pipe and queue delay, and discards frames older than
250 ms. Observation time comes from the source window end, with a 400 ms validity
period. Sequence gaps remain visible as discontinuities. Lifecycle progress is
sent separately and cannot be replaced by a newer feature frame.

Stop, SIGINT, SIGTERM and endpoint loss immediately fence local features. Native
stop closes its control input with `stop`, then sends SIGTERM after 500 ms and
SIGKILL after 2.5 seconds if needed. After 3.5 seconds without confirmed exit,
cleanup is uncertain. A signaled exit or native cleanup failure is also uncertain;
a native SIGTERM handler that completes cleanup and exits zero is confirmed.
Unknown teardown prevents another capture in that producer. The wrapper retains
ownership of a helper whose exit has not been observed; that child may keep the
foreground process alive after it reports uncertainty. It never retries a start,
restarts a helper or redeclares an endpoint after connection loss. A late stop
for the latest terminated generation reports its existing cleanup result without
opening capture. The native helper also has an explicit 24-hour resource bound.

The CLI writes only fixed startup or uncertain-cleanup notices to stderr. It does
not write features, credentials, configuration paths or OS exception text to
standard streams. Reconnection and another capture require a new explicit
producer invocation and a new core start.

## Source checks

Use Node 24 and run `npm ci` from the repository root, then:

```sh
npm run build
npm run typecheck
npm run lint:js
npm run test:music-producer:built
npm run test:music-producer:native
```

On macOS also run `npm run build:music-producer:native` and
`npm run test:music-producer:adapter`. The native tests generate synthetic PCM
and AppleEvent descriptors in memory, and substitute audio, permission and
AppleEvent APIs. The build only compiles. These checks do not open Music,
capture audio, change speaker routes, send application AppleEvents or request
permission. The portable
analyzer and Mac adapter have separate checks. See the [native guide](native/README.md)
for formats and numeric limits.

The shared Checks job runs the producer and portable native suites. A separate
Music native source workflow compiles the macOS adapter and runs synthetic tests.
Authenticated boundary changes also run event, SDK and runtime consumers, plus
the shared workflow checks listed in [development](../../docs/development.md).
The producer suite includes a disposable loopback SDK edge and a real child
process that generates numeric frames. That fixture imports no audio API and
opens no media. It exercises both selections, private UID transfer, start, confirmed stop, stream
loss and bounded pipe
parsing without starting the production native capture helper.

## Local state and position reader

`src/position.ts` exports `MusicPositionReader`. Construct it with an absolute
`helper` path to `native/build/music-position`, then call `read({signal})` for one
observation. Construction and import perform no work. Each explicit call starts
one child; the component has no polling schedule, SDK grant or playback controls.
`modules/playback` retains source selection and presentation ownership. This
partial increment does not add Music to that owner's source configuration.

A successful result has `status: "sample"`, a per-reader `sequence`, a
`sourceEpoch` and the native `sample`. A Music process restart produces a new
epoch on the next successful read. An epoch identifies a process lifetime, not
a recording. Cancelled reads and late replies cannot change it. Unavailability
returns `status: "unavailable"` with the sequence and a fixed registered error.
No prior observation is returned as a substitute. The reader retains only its
current process identity, epoch and sequence, with no logs or observation history.

State and position have separate monotonic request/reply intervals. Position may
be unavailable while the earlier state remains valid. Zero seconds is a real
position, never an unavailable sentinel. The supervisor checks every native
interval against its local request and receive times, without wall-clock
conversion. These intervals do not establish an atomic snapshot, track identity,
seek detection, speaker latency or beat timing. A consumer must use the original
intervals when deciding whether an observation remains fresh.

The reader accepts one closed NDJSON record within 4 KiB total stdout, discards
at most 4 KiB stderr and requires a confirmed child exit. The five-second
whole-read deadline includes startup and permission preflight.
Elapsed monotonic time is checked at receipt and exit even if timer dispatch is delayed.
Cancellation, invalid output or that deadline fences the result and sends SIGTERM immediately,
then SIGKILL after 500 ms if needed. After 1.5 seconds without observed exit it
reports `uncertain-result` and continues to own the child. Another read is refused
until that exit arrives. No path retries automatically. A caller that aborts
must still await the read result to observe teardown.

The portable suite includes real synthetic children for complete and partial
reads, fragmented output, cancellation and deadline teardown. These fixtures
send no AppleEvents. The [native guide](native/README.md#explicit-state-and-position-reads)
describes permission identity and descriptor checks. Continuous polling, track
metadata, output observations, SDK integration, controls, packaged permission
access and physical timing remain within the full #571 work.

## Data and qualification

Only bounded derived measurements cross the SDK edge. PCM stays in process
memory and is absent from files, logs, messages and model requests. Existing
private core history retains the published derived observations. Latest-value
queue replacement loses intermediate windows under pressure; sequence gaps
identify that loss. History continues growing during capture.

The disposable probe established Music-only audio access on one selected Mac
output. It did not qualify every protected recording, AirPlay route, microphone,
packaged helper identity or physical light delay. Microphone support requires
one mono/stereo floating-point input stream. Real device formats, signed-helper
permission identity, acoustic quality and hardware route behavior remain unqualified. The installed pilot owns those
checks, credential provisioning and permission prompts. Source delivery starts
no installed producer and sends no light command.
