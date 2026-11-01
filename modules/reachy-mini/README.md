# Reachy Mini simulator

The statically shipped TypeScript module owns one explicitly configured Reachy
MuJoCo daemon. It uses the existing SDK, private SQLite responsibility/outbox,
core tracking and module-owned React controls. Companion personas and speech
remain with their current owner. The accepted definition is
[qualification #619](https://github.com/jimmie-potts/agent-device-hub/issues/619).

This source increment admits a simulated backend only. Configuration names
`id`, `endpoint`, `configurationRevision` and `ownership: "exclusive"`.
The endpoint is a numeric loopback HTTP origin with an explicit port and no
credentials, path or query. There is no discovery or hardware fallback.
Status inspection and opening controls never move the robot.

Notice and attention use 600 ms antenna stages within ±0.2 radians, followed
by a 600 ms neutral stage. Neutral is an explicit pose request. Vendor code
can also send holding targets to head/body. These bounds are software
candidates and establish no physical safety or settling tolerance.

Manual gestures require Take over. Automatic expression defaults off, honors
Quiet and current source evidence, and never catches up after reconnect.
Stop cancels only a known owned vendor task and latches automatic expression
off until Resume automatic expression. Task cancellation leaves the last
target active and is never labelled physical stopping.

Uncertain writes retain a hold. An unknown UUID cannot be cancelled by
guessing or cancelling every vendor task. Restore vendor/manual ownership,
then submit a guarded new command from the owner with explicit recovery acknowledgment.
Refused recovery preserves the original hold; uncertain recovery replaces it
and requires a new acknowledgment. Definitive guarded recovery records the new
command and prior hold, permitting fresh controls while retaining the original
uncertain outcome in history. Takeover alone sends no stored held UUID.
Restart reports unfinished responsibility without resending movement.

From the worktree root with Node 24, build, then run
`npm run test:reachy:built`, affected event/SDK/runtime tests,
`npm run test:reachy:browser`, build/type/lint and workflow checks.
Tests use fake transport or dedicated loopback simulation, never a household
device. Actual vendor-simulator evidence is distinct from fake transport,
installed-client, USB and physical acceptance.

For actual-vendor acceptance, first start the exact qualified #619 source and
hydrated MuJoCo assets on a dedicated `127.0.0.1:18861` daemon with headless,
media disabled, telemetry disabled, dataset preloading/update disabled and no
startup/shutdown wake or sleep. Confirm simulation identity before proceeding.
The runtime/browser harness needs Linux; its private-file checks use `/proc`.
In that disposable Linux checkout, explicitly run:

```sh
REACHY_VENDOR_EXERCISE=1 node apps/runtime/dashboard/tests/reachy-vendor.browser.ts
```

The exercise uses browser controls and writes private phase/result files under
`/tmp`. At `await-daemon-loss`, stop only that owned daemon process; at
`await-daemon-restart`, restart the same pinned simulator. The exercise checks
unavailability and recovery without replay. This is a manual qualification
check, separate from ordinary fake tests and hosted CI. A temporary loopback
relay needed by a disposable Linux container is test infrastructure and does
not qualify any production host route. Do not expose the vendor API broadly.

The remaining host/physical gate must select and qualify the Lite daemon and USB
route from the installed Linux ARM64 runtime, establish exclusive ownership,
and exercise permitted amplitudes, task cancellation, disconnect/restart and
sleep/wake on the named hardware. Simulator pose, API acceptance and a source
merge establish none of those physical or installed facts. Camera, microphone,
robot audio and walking remain outside this module increment.
