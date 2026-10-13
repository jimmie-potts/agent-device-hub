# Windows BB-8 transport

This component owns native BLE, bounded PacketV1 transactions and a private Windows receipt database. WSL never opens that database. See [qualification](../../docs/bb8-controller-qualification.md) and [module](../../modules/bb8/README.md). Installation and first physical evidence belong to #605.

The gateway's private `edge-credentials/1.0` file configures one helper credential with `role: "bb8-link"`, `source: "bunny/parts/bb8-windows"` and `scopes: []` and `robotId: "bb8"`. Its digest is the SHA-256 of the separately stored token. The role grants only internal respond/serve/publish and the core acknowledgment subscription, never public requests or session reads. Ordinary credentials and browser scopes remain unchanged. Both internal handlers require `bunny/modules/bb8` independently. The enrolled robot ID must agree in Windows and WSL configuration.

Private Windows configuration selects adapter identity, exact enrolled address, configuration revision, gateway endpoint/token file, receipt directory and qualified cross-host clock bounds. No command supplies them. Writer ownership precedes native import/access. Starting the helper connects the SDK only; explicit connect admits BLE and its unlock/transmit-power initialization, one wake, and one ping/version handshake. Native stdout/stderr is bounded and retained privately; public errors/logs use registered fixed text.

One operation runs at a time, eight may wait and 64 unconsumed results may remain. Packet collector is at most 1 KiB; writes are at most 20 bytes, spaced by at least 60 ms. Explicit connect wakes once before ping/version; missing wake write support refuses before initialization writes. Connect/handshake budget is 15 s, replies 2 s and other operations 5 s. Every write checks the operation deadline and live session. No retries or startup reconnect. Result consumption and core acknowledgment are separate. Restart resolves interrupted admissions without replaying radio work.

From the repository root on Node 24:

- `npm run test:bb8-windows` builds and runs fake BLE/packet/receipt/privacy/ownership tests.
- `npm run test:bb8-windows:built` uses current build output; CI runs it after build.
- `npm run test:bb8:package` checks the module's pure contracts and helper package consumer in isolation.

Shared build/type/lint, events/Python, SDK, runtime/catalog and browser checks are required as documented in the module guide. No source test invokes a live adapter. `@stoprocent/noble@2.8.0` is pinned and optional on non-Windows hosts; its binary-load evidence in #603 qualifies ABI only. Live setup, credentials, clock qualification, other-app ownership handoff and finite radio sequence require #605's explicit inputs.

The Windows entry is `node dist/src/process.js <private-config-file>`. It checks
owner-only ACLs without changing them and takes an OS named mutex keyed by the
selected target before registering commands. A second helper cannot use another
receipt directory to acquire the same target. The database also binds the enrolled
robot/model/adapter/target fingerprint; changing that enrollment requires an
explicit handoff under #605 rather than adopting old receipts.

The private JSON uses schema `bb8-windows/1.0` and exactly these members:
`robotId`, `model` (`original-bb8`), `configurationRevision`, `adapterAddress`,
`targetAddress`, `gatewayUrl` (HTTP loopback), `tokenFile`, `stateDirectory`,
`clockErrorMs` (0–1000) and `clockQualifiedUntilMs`. The owner supplies the two
selected addresses, matching WSL revision, private token/directory and measured
clock qualification under #605. Expired qualification refuses operations; the
helper does not set the host clock. Credentials and addresses are absent from
public records. No example target is a setup instruction.

The isolated native child receives no SDK token. Its combined stdout/stderr log
is private, capped at 64 KiB per explicit connection; overflow terminates that
connection and leaves uncertain work for reconciliation. It performs no scan or
pairing. A matching adapter/target and the required writable/notify
characteristics are checked before handshake writes. Physical model, firmware,
Windows ACL/mutex behavior and native cancellation still need the #605 trial.

Packet sequence numbers are not reused in one connection. Exhaustion after 256
requests refuses work and requires a later explicit reconnect, preventing a
late reply from satisfying a new request with a wrapped sequence number.

Structured helper diagnostics use the shared observability host adapter with no
exporter, registered fields and recorded device/outbox spans. They retain request
trace context, registry codes and fixed text, never addresses or native errors.
The private receipt directory holds `diagnostics.ndjson`, capped at 4 MiB across
starts; logs and spans append as separate, serialized JSON lines, including the
separator bytes in that cap. Ordinary diagnostic file or adapter startup failures
disable telemetry and report a fixed warning while the helper continues. Unsafe
diagnostic paths still refuse startup. Full or failed sinks drop diagnostics
without changing device outcomes.
Native capture remains a separate 64 KiB file per explicit connection.

A native radio loss advances the connection generation and aborts outstanding
work, while a healthy SDK stream still permits a fresh explicit connect. SDK
stream loss separately fences admission until the stream returns. A valid
nonzero PacketV1 response produces a failed outcome with transmitted evidence;
unknown response codes use `internal` and do not create an uncertain hold.


Docked gestures use the existing exclusive writer and receipt store. Only the fixed `look-left`, `look-right` and `shake-head` presets are accepted with `docked: true`. Every heading segment requires a newly requested charging report, requests speed zero and lasts at most 300 ms. Stop interrupts the active segment, prevents later segments and cancels queued gestures. Pending/result admission reserves the existing Stop slot while a gesture exists.

The local timer starts at the possible heading write. At its end, a separate selected Stop uses a fresh sequence and its own bounded response check, even if the heading response is missing or the original expiry has passed. The native child serializes writes; native callback or host delays can postpone delivery. A late heading response cannot acknowledge Stop. A received Stop reply permits a usable link to remain available after an uncertain result; it does not prove physical rest. No saved gesture or move executes on restart. No persistent firmware timeout/options, macro upload or raw motor command is selected.

Legacy aim/step schemas, receipt readers and transport code remain for compatibility with retained outcomes. New public aim/step admission is hibernated in the module. No arbitrary heading or duration is available through docked gesture requests.
