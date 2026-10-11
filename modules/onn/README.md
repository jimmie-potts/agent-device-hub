# ONN controls

The ONN module controls one manually configured Android TV device through a
private Google ADB server. It contributes its React remote to the shared
dashboard and uses the core dispatcher for authenticated HTTP and MCP commands.
The [qualification record](../../docs/onn-controls-qualification.md) names the
selected route, observed app behavior and limits. Source checks do not establish
installed or physical acceptance.

The remote provides Up, Down, Left, Right, Select, Back, Home, play/pause and
standard YouTube/Stremio shortcuts. Focus the TV's text field before inserting
text. Supported input is ASCII letters, digits, spaces, dots, underscores and
hyphens, with a maximum of 256 characters; it never submits a search. Other
characters are refused before device work. Power, volume and direct seek keys
are unsupported.

To seek, focus the timeline on the TV and press Left or Right individually.
YouTube needs a separate Select to apply its marker; Stremio applies the step
while paused. The module does not infer focus or combine presses into a macro.
An app shortcut resolves the selected installed LEANBACK activity and launches
it once. It does not select a title.

## Private setup

The `modules.onn` section contains only these fields:

| Field | Required value |
| --- | --- |
| `id` | One neutral routing ID, such as `onn`; lowercase letters/digits separated by hyphens, at most 128 characters. |
| `configurationRevision` | Positive integer; advance it when the selected setup changes. |
| `adbSocket` | Exact absolute Unix socket path, at most 100 bytes; owner-only socket (`0600`) inside an owner-only directory (`0700`). |
| `serial` | Actual device IPv4 address and current Wireless debugging connection port. |
| `hostExecutable` | Exact absolute path of the qualified Google platform-tools executable; owned regular executable, without group/other write permission. |
| `hostExecutableSha256` | SHA-256 of that executable, recorded during setup. |
| `hostVersion` | Qualified platform-tools version, `37.0.1`. |
| `hostKeyDirectory` | Exact owner-only directory (`0700`) containing the privately paired `adbkey` regular file (`0600`). |

Pair manually using the actual address and ports shown on the device. The
pairing-code dialog and the main connection page use different ports. Device
settings, pairing and physical checks need an owner-approved sequence. Keep
codes and keys private. The module never starts, stops, discovers or replaces
an ADB server, and never changes ports or switches transports automatically.
If the configured dependency is missing or unsafe, it reports unavailable.
Module startup opens its private store and bus resources without waiting for
the device.

## State and outcomes

`device/2.1` provides shared identity, availability, pending work and last
outcome. `onn-state/2.0` provides the connection generation, current app and
qualified controls. Read-only polling every five seconds reports only
`youtube`, `stremio`, `other`, `none` or unknown; raw package names and private
paths never appear in state. Current-app observations become stale after
15 seconds. App launch transmission does not prove the foreground app changed.

The queue holds at most 16 accepted pending actions including the in-flight
action. One action has a five-second whole-operation deadline, shortened by
its remaining expiry. Admission commits a durable fence before any effect.
Success with transmitted evidence reports a successful protocol transmission;
only observation of the TV establishes its visible effect. A lost reply after
a possible write remains uncertain. There is no automatic action retry,
replay, compensation or fallback.

Private SQLite fences, outcomes and the SDK outbox survive restart. Interrupted
accepted work becomes failed; interrupted started work becomes uncertain.
Neither is reconstructed or executed again. Outbox republication only reports
the retained outcome. A matching request ID returns its retained admission;
changed semantic input conflicts. Two deliberate presses use distinct IDs.

Focused text remains in memory only. Both core and module admission retain a
stable private HMAC, never plaintext or an unkeyed text hash. Each owner pins
its key identity in its leased database. A missing, replaced or unsafe key
refuses new text and retries, preserving old fences. Do not replace a key to
recover a request. The dashboard clears submitted text immediately; it keeps
no text in browser storage. Inbox Send again refuses omitted input before
handling the original item; Dismiss remains available. Enter fresh text with
a new request ID for another deliberate insertion.

## MCP and verification

`onn_status` is a read-scoped cached status tool and sends no control.
Control-scoped clients use `core_send_command` with `onn-key-press`,
`onn-app-open` or `onn-text`, the configured target and the corresponding
`key`, `app` or `text`. HTTP uses the same families at
`POST /api/v2/commands/<family>`. Optional shared configuration/generation
guards prevent work against stale setup. No action accepts a package, URL,
socket path, device address or arbitrary shell string.

Use the [development checks](../../docs/development.md#onn-module-checks).
The simulation is synthetic and retains only connection/app state and an
effect count. Viewing-history collection, advertisement detection/Skip,
recommendations and exact-title launch are not implemented by this module.
