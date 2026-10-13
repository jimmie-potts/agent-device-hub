# BB-8 module

This module owns one configured robot's `device/2.1`, `bb8-robot/2.0`, public guarded commands, private responsibility/outbox and browser-only `./frontend`. The pure `./link` entry defines internal version-2.0 transport contracts; the Windows component owns radio access. See [qualification](../../docs/bb8-controller-qualification.md) and [runtime development](../../apps/runtime/DEVELOPMENT.md).

Configure `modules.bb8` with `{ "id": "bb8", "configurationRevision": 0 }`. The module keeps no Bluetooth address. Start, page entry, reads and software reconnect are passive. Explicit **Connect and wake** unlocks and wakes the robot once before recording valid ping/version replies. Wake and LED controls remain deliberate effects. General capabilities remain unsupported. The operator page also supports bounded supervised steps and Stop. Power category/voltage retain their original evidence time; LED transmission never claims visible success. No MCP or automation controls.

From the repository root, using Node 24 (`fnm exec --using=.nvmrc --`):

- `npm run test:bb8` builds and tests module admission, durable completion, restart and packet-free recovery.
- `npm run test:bb8:built` uses current build output and includes module-kit conformance.
- `npm run test:bb8:package` builds and checks isolated package exports/consumer compatibility; CI uses `test:bb8:package:built` after its single build.
- `npm run test:bb8:browser` exercises explicit controls/read-only/stale/failure/reconnect through the real authenticated shell and axe.

Also run build, typecheck, lint:js, check:workflow, test:workflow, events/Python, SDK, runtime/both-transport catalog and dashboard/full browser checks. Disposable Acceptance runs `verify:runtime` independently on the frozen source candidate. Tests use synthetic configuration and injected transport, never installed state or radio. Source CI is not installation or physical qualification.

For ordinary use, start the configured Windows helper, open BB-8, select **Connect and wake**, then use the LED controls or **Refresh power**. Select **Disconnect** before closing the helper. Startup and reopening the page do not connect or replay a saved command. Wake can change lights or posture. Movement needs a separate deliberate step. Charging status and voltage are reported by the robot, not a battery percentage.


## Short steps and Stop

Use movement only off the charging dock, in a clear contained area, with an operator nearby. After Connect, point the robot forward manually, then select **Set forward**. This resets heading through bounded stabilization-off, heading-zero and stabilization-on commands. The reference is an operator assertion, not a measured heading. Select **Clear forward** before repositioning, then set it again. Reconnect, helper restart, wake and uncertain movement invalidate it.

**Forward**, **Right**, **Back** and **Left step** each request speed20/255 for300ms. The contract accepts integer speed1–32 and duration100–500ms; these values do not guarantee physical speed or distance. Only one step may be pending or active. Windows requests Stop at step end without another browser command. **Stop** stays independently tracked during a pending or uncertain move, requires no reference and runs before queued work. Stop invalidates the reference; set it again before another step. An uncertain movement hold requires explicit reconnect/disconnect before further movement.

A completed step or Stop confirms protocol transmission, not physical rest. A lost Bluetooth link or stalled host can prevent Stop reaching the robot. Remain nearby and use the containment; this release does not support unattended rolling. Finish with **Stop**, both chosen LED values, **Disconnect**, then close the helper. A normal start/restart sends no stored movement.
