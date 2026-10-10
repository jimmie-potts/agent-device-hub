# BB-8 module

This source-only module owns one configured robot's `device/2.1`, `bb8-robot/2.0`, public guarded commands, private responsibility/outbox and browser-only `./frontend`. The pure `./link` entry defines internal version-2.0 transport contracts; the Windows component owns radio access. See [qualification](../../docs/bb8-controller-qualification.md) and [runtime development](../../apps/runtime/DEVELOPMENT.md).

Configure `modules.bb8` with `{ "id": "bb8", "configurationRevision": 0 }`. The module keeps no Bluetooth address. Start, page entry, reads and software reconnect are passive. Explicit connect records ping/version initialization; wake and LED changes are separate deliberate effects. General capabilities and motion remain unavailable. Power category/voltage retain their original evidence time; LED transmission never claims visible success. No MCP or automation controls.

From the repository root, using Node 24 (`fnm exec --using=.nvmrc --`):

- `npm run test:bb8` builds and tests module admission, durable completion, restart and packet-free recovery.
- `npm run test:bb8:built` uses current build output and includes module-kit conformance.
- `npm run test:bb8:package` builds and checks isolated package exports/consumer compatibility; CI uses `test:bb8:package:built` after its single build.
- `npm run test:bb8:browser` exercises explicit controls/read-only/stale/failure/reconnect through the real authenticated shell and axe.

Also run build, typecheck, lint:js, check:workflow, test:workflow, events/Python, SDK, runtime/both-transport catalog and dashboard/full browser checks. Disposable Acceptance runs `verify:runtime` independently on the frozen source candidate. Tests use synthetic configuration and injected transport, never installed state or radio. Source CI is not installation or physical qualification.
