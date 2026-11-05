# Music producer

This host-local application measures explicitly selected Music.app audio for
[#721](https://github.com/jimmie-potts/agent-device-hub/issues/721). The Linux
runtime owns the capture session. The native macOS helper owns local PCM access
and analysis; the Node wrapper uses the existing authenticated SDK edge.

Connection advertises availability. Only an explicit capture command starts the
helper. Stop, disconnect or shutdown retires its generation and pending frames.
The first source slice supports Music.app only. Microphone support, prepared
analysis and physical synchronization retain their own acceptance in the issue.

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

The origin must be HTTP or HTTPS without a path, query, fragment or credentials.
The helper and token paths must be absolute. Provision the credential separately
for the fixed source `bunny/parts/music-producer`, with no ordinary SDK scopes.
Its endpoint grant responds only to `music-capture-work`, publishes only
`music-capture-progress` and `music-capture-features`, and requests only
`music-capture-endpoint`. The wrapper accepts work only from `bunny/core` for its
current endpoint. A source or grant cannot be supplied in the configuration.

An explicit start first runs the helper's harmless `--clock` mode. Its reading
must fall between Node's before and after `process.hrtime` readings. Only then
does the wrapper invoke `--capture`. Registration also checks core's reply time:
every possible clock offset must fit within 50 ms. Local wall/monotonic drift
above 25 ms invalidates that qualification, including while idle. Capture must
produce its first valid, fresh frame within five seconds. Silence is valid.
`started` is published only after that first frame, before any features.

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

On macOS also run `npm run build:music-producer:native`. The native tests generate
synthetic PCM in memory and the build only compiles. Neither command opens Music,
captures audio, changes a speaker route or requests permission. The portable
analyzer and Mac adapter have separate checks. See the [native guide](native/README.md)
for formats and numeric limits.

The shared Checks job runs the producer and portable native suites. A separate
Music native source workflow compiles the macOS adapter and runs synthetic tests.
Authenticated boundary changes also run event, SDK and runtime consumers, plus
the shared workflow checks listed in [development](../../docs/development.md).
The producer suite includes a disposable loopback SDK edge and a real child
process that generates numeric frames. That fixture imports no audio API and
opens no media. It exercises start, confirmed stop, stream loss and bounded pipe
parsing without starting the production native capture helper.

## Data and qualification

Only bounded derived measurements cross the SDK edge. PCM stays in process
memory and is absent from files, logs, messages and model requests. Existing
private core history retains the published derived observations. Latest-value
queue replacement loses intermediate windows under pressure; sequence gaps
identify that loss. History continues growing during capture.

The disposable probe established Music-only audio access on one selected Mac
output. It did not qualify every protected recording, AirPlay route, microphone,
packaged helper identity or physical light delay. The installed pilot owns those
checks, credential provisioning and permission prompts. Source delivery starts
no installed producer and sends no light command.
