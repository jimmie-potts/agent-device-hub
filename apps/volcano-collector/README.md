# Volcano collector binding

The Bluetooth binding of the [Volcano collector](../runtime/README.md#volcano-collector)
([#615](https://github.com/jimmie-potts/agent-device-hub/issues/615)). It maps the
collector's five transport operations onto `@stoprocent/noble`, pinned to exactly
2.8.0 in its own `package-lock.json`. It is not a workspace, so the root lockfile and
the runtime's container image gain no native dependency.

The adapter asks only for the allowlisted services and characteristics and never calls
a write. Noble's subscription setup is the one write the Bluetooth stack makes. The
adapter's types describe only the part of noble it uses, so the root build compiles it
without the binding, and its tests run against a fake noble that fails on any
write-shaped call.

Noble's reads and notifications were qualified on the Mac Mini on 2026-11-03. This
source has not run against a device. Installation and physical acceptance belong to
[#617](https://github.com/jimmie-potts/agent-device-hub/issues/617).

## Launch

From the repository root, with Node 24, after the root `npm ci` and `npm run build`:

```sh
npm ci --prefix apps/volcano-collector
node apps/runtime/bin/volcano-collector.mjs <collector.json>
```

Without the binding installed, the entry point exits with 2 and says so.

## Private files

Both are read once at start, and must be owner-only regular files with one link.

- `collector.json`: exactly `{"producer": "<absolute path to producer.json>",
  "advertisedName": "<exact advertised name>", "serialSha256": "<64 hex digits>"}`.
  The hash is the SHA-256 of the serial as text, without trailing padding. The serial
  itself is not stored there, and the collector does not publish, log or keep it.
- `producer.json`, with its `receipt.json` beside it: the
  [hook's producer file](../runtime/README.md#agent-hooks), whose `source` is exactly
  `{"provider": "storz-bickel", "client": "volcano", "hostId": "<id>", "sourceId":
  "<id>", "feed": "volcano-observation"}`. The runtime's edge admits an observation
  only from the `ingest` credential derived from that object.

## Device Bluetooth

The device's own Bluetooth may be off, which looks like an absent device. Hold Minus
and AIR for about 3 seconds to turn it on
([Storz & Bickel](https://storz-bickel.zendesk.com/hc/en-us/articles/14360439416081-How-can-I-turn-the-Bluetooth-function-of-the-VOLCANO-HYBRID-on-off)).
The collector reports `unavailable` meanwhile, which is unknown, not off.

## macOS Bluetooth access

macOS checks Bluetooth access against the process it treats as responsible, and kills
one whose responsible app has no `NSBluetoothAlwaysUsageDescription`. Terminal.app
works once the owner has allowed it. A launchd-started Node process has no such app
around it, so a launchd launch needs a small wrapper app, which
[#617](https://github.com/jimmie-potts/agent-device-hub/issues/617) qualifies. This
package does not include one.

## Checks

`npm run test:volcano:built` from the repository root runs the adapter's tests. See
[Volcano checks](../../docs/development.md#volcano-checks).
