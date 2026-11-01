# MicroDuck simulator

This TypeScript module implements [the accepted simulator definition](https://github.com/jimmie-potts/agent-device-hub/issues/620).
It owns one explicitly configured simulated robot, private responsibility/outbox
and the SDK writer. Core owns sessions, mode and coding opportunities; companions
retains personas, memory and speech. Installation and physical admission remain
[the physical pilot](https://github.com/jimmie-potts/agent-device-hub/issues/624).

Only notice, attention and explicit neutral head inputs are available. Notice
uses yaw +0.10 rad and attention -0.10 rad, followed by zero input. Each phase
lasts 800 ms; a return later than 900 ms is refused. These are policy inputs,
not guaranteed joint angles or a vendor effect TTL. Beak, body pose, skills,
enable, torque, walking, capture and audio remain unavailable.

Stop expression cancels future B.U.N.N.Y. writes and latches automatic expression
off. It makes no vendor call and promises no physical rest. Vendor robot.stop
only zeros velocity and leaves head intent active. Explicit neutral recovery
is a new guarded command acknowledging the exact hold. It requires two advancing
post-send zero-input samples within 0.005 rad and 800 ms. Original uncertainty
remains in history. Resume never replays suppressed work.

Automatic expression defaults off. It needs exactly one fresh eligible coding
session, core-owned first-live opportunities, current non-Quiet mode, the witnessed
vendor pair and fresh sensor evidence. Automatic/manual cue spacing is 30/two
seconds; neutral and local controls are exempt. One active program and one latest
automatic candidate are allowed. No manual queue or automatic motion retry exists.

## Validation

Use Node 24 and npm ci from the worktree root. Run build before
`npm run test:microduck:built`, `npm run test:microduck:browser`, typecheck, lint:js,
event/SDK/runtime and workflow checks. CI discovers module tests under the modules
group and browser checks under runtime. Tests use deterministic transports and
synthetic private state. Actual pinned vendor acceptance is separate and must
run in a disposable Linux ARM64 container with the runtime and vendor pair in
the same time namespace. No physical target is selected or contacted.

Cached observations identify fake I/O separately from the pinned vendor MuJoCo daemon/API/revision. The emitted observation marks `syntheticJointIndices: [9]`. The protocol's mouth
slot is padded; it is not a measured actuator. Health refers to the simulated
vendor policy/bus only. No physical battery, current or temperature is exposed.

## Dedicated development setup

Prepare the pinned MicroDuck checkout, RL checkout and official policy files in
separate private directories outside this repository. The policy directory needs
only velstand.onnx, its manifest and provenance. Preserve the source locks and
licenses. The fixture validates the exact daemon binary, all 125 selected RL
source/model file hashes in fixture/rl-inputs.json, the policy and params. A
different build hash needs fresh qualification and review; do not bypass it.

Build the vendor image locally with fixture/Dockerfile.vendor and named build
contexts microduck-source, rl-source and policy-source. For example:

```sh
docker build -f modules/microduck/fixture/Dockerfile.vendor \
  --build-context microduck-source=/absolute/private/microduck \
  --build-context rl-source=/absolute/private/microduck_rl \
  --build-context policy-source=/absolute/private/policies \
  -t bunny-microduck-vendor:local .
```

Prepare the exact clean candidate's core and Chromium test image using the
[finite offline preparation](../../apps/runtime/verify/PORTABLE.md#prepare-the-exact-test-image).
Then build fixture/Dockerfile.development with TEST_IMAGE and VENDOR_IMAGE set to
those immutable local image IDs. Keep both images private; no model/policy assets
are checked into B.U.N.N.Y. or selected for redistribution.

Run the source acceptance driver inside that test-only image, with no host
mounts, published ports, devices or external network:

```sh
docker create --init --name bunny-microduck-owned-run --network none \
  --cap-drop ALL --security-opt no-new-privileges --pids-limit 256 \
  --env MICRODUCK_VENDOR_EXERCISE=1 <immutable-development-image-ID> \
  180 node apps/runtime/dashboard/tests/microduck-vendor.browser.ts
docker start -a bunny-microduck-owned-run
```

The driver explicitly enables only the simulated policy during fixture setup,
then uses the shipping module transport and tracked dashboard/core controls.
It waits for healthy balancing evidence, exercises both process-loss directions,
preserves uncertainty across runtime restart and explicitly adopts new passive
pairs. It writes private observations/results and cleanup under /proof. Verify
the exact container stopped with PID zero before copying its proof; retain failed
receipts too, then remove only that owned stopped container and verify absence.
This development run is separate from independent exact-head Acceptance.

For a manual development session inside the same isolated container, run
`node modules/microduck/dist/src/fixture.js --enable-policy`. Its ready line gives
the private fixtureRoot. Configure `{id, fixtureRoot, configurationRevision}` for
the microduck section of a disposable runtime in that container. Leave out
--enable-policy to inspect a passive pair. The explicit fixture lease is two
hours; SIGTERM/SIGINT stops and reaps its pair. Use an enclosing GNU timeout too.
Opening the dashboard neither starts this fixture nor enables its policy.

The real adapter requires a private fixture witness, not an arbitrary socket
or simulated flag. Fixture setup explicitly starts one pinned robotd and one
headless MuJoCo body and may explicitly enable the vendor policy. Module startup,
reconnect and dashboard reads do not. Loss of either member invalidates the
session and terminates/reaps the survivor; replacement requires explicit setup.
This process cleanup is not a hardware stop method.

Pinned vendor inputs are MicroDuck b2b0d213a402caeac492dd662ea891faa17f67c0,
API 47/daemon 0.18.3, RL develop bae39f5900b318f7e87fc485c30a31213cfa14eb,
Python 3.12.13, MuJoCo 3.10.0, NumPy 2.4.1 and ONNX Runtime 1.24.4. Only the
official v8 velstand policy at repository revision
665ae4eb20bfe13bca1ef4ea6d4bb6b4a096e448 is selected. Retain exact asset/config
hashes privately; bundle no model/policy assets. Upstream code/XML is Apache-2.0;
covered RL meshes have CC BY-NC-SA-4.0 terms and Pollen Robotics attribution.
