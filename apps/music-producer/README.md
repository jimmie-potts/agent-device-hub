# Music producer

This host-local application measures explicitly selected Music.app audio for
[#721](https://github.com/jimmie-potts/agent-device-hub/issues/721). The Linux
runtime owns the capture session. The native macOS helper owns local PCM access
and analysis; the Node wrapper uses the existing authenticated SDK edge.

Connection advertises availability. Only an explicit capture command starts the
helper. Stop, disconnect or shutdown retires its generation and pending frames.
The first source slice supports Music.app only. Microphone support, prepared
analysis and physical synchronization retain their own acceptance in the issue.

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
