# BB-8 module

This module owns one configured robot's `device/2.1`, `bb8-robot/2.0`, public guarded commands, private responsibility/outbox and browser-only `./frontend`. The pure `./link` entry defines internal version-2.0 transport contracts; the Windows component owns radio access. See [qualification](../../docs/bb8-controller-qualification.md) and [runtime development](../../apps/runtime/DEVELOPMENT.md).

Configure `modules.bb8` with `{ "id": "bb8", "configurationRevision": 0 }`. The module keeps no Bluetooth address. Start, page entry, reads and software reconnect are passive. Explicit **Connect and wake** unlocks and wakes the robot once before recording valid ping/version replies. Wake and LED controls remain deliberate effects. General capabilities remain unsupported. The operator page offers three fixed docked head gestures and Stop gesture. Floor driving is hibernated; new public aim/step requests refuse before helper dispatch. Power category/voltage retain their original evidence time; LED transmission never claims visible success. No MCP or automation controls.

From the repository root, using Node 24 (`fnm exec --using=.nvmrc --`):

- `npm run test:bb8` builds and tests module admission, durable completion, restart and packet-free recovery.
- `npm run test:bb8:built` uses current build output and includes module-kit conformance.
- `npm run test:bb8:package` builds and checks isolated package exports/consumer compatibility; CI uses `test:bb8:package:built` after its single build.
- `npm run test:bb8:browser` exercises explicit controls/read-only/stale/failure/reconnect through the real authenticated shell and axe.

Also run build, typecheck, lint:js, check:workflow, test:workflow, events/Python, SDK, runtime/both-transport catalog and dashboard/full browser checks. Disposable Acceptance runs `verify:runtime` independently on the frozen source candidate. Tests use synthetic configuration and injected transport, never installed state or radio. Source CI is not installation or physical qualification.

For ordinary use, start the configured Windows helper, open BB-8, select **Connect and wake**, then use the LED controls or **Refresh power**. Select **Disconnect** before closing the helper. Startup and reopening the page do not connect or replay a saved command. Wake can change lights or posture. Gestures require an explicit powered-dock confirmation. Charging status and voltage are reported by the robot, not a battery percentage.


## Docked head gestures

Keep BB-8 on its powered charging dock and remain nearby. After **Connect and wake**, confirm **BB-8 is on its powered dock** to enable **Look left**, **Look right** and **Head shake**. The helper requests fresh charging status before every heading segment. Missing or non-charging evidence refuses the next segment. Reconnect or helper restart clears the page's dock confirmation.

The presets send zero-speed headings: Look left uses 330° for 300 ms; Look right uses 30° for 300 ms; Head shake uses 30°, 330°, 30°, 330°, then 0°, each for 150 ms. Each segment ends with a locally selected Stop, even without a heading reply. These commands can move the head or disturb the body's position on the dock. The labels describe intended gestures; transmission does not establish observed head position. Stop gesture interrupts the current segment and cancels later or queued gestures. A lost link or stalled host can prevent Stop reaching BB-8.

Only one gesture may be pending or active. **Stop gesture** remains independently tracked while an ordinary request is pending or uncertain. After an uncertain result, reconnect or disconnect before another gesture. Finish with **Stop gesture**, both LEDs **OFF**, **Disconnect**, then close the helper. Page entry and normal start/restart send no saved gesture or movement.

Aiming and floor steps remain unavailable. Their existing schemas and stored outcomes remain readable; re-enabling them requires an owner decision and the retained movement acceptance. No arbitrary scripts, animation IDs, macro uploads, raw motors or firmware settings are exposed.

The zero-speed heading approach follows the original-BB-8 [head-shake example](https://github.com/scross01/bb8-esphome/blob/ddce77d22eeba645c7623aabcb771accd8b8a3d8/README.md), using the existing five-byte [SpheroV1 Roll framing](https://github.com/artificial-intelligence-class/spherov2.py/blob/4252ddb1a12a25db725257d66e3e8ec3057dd48b/spherov2/commands/sphero.py). Source tests verify the selected packets and limits. Visible docked behavior requires separate physical acceptance; these are not claimed to reproduce every preset in the Sphero app.
