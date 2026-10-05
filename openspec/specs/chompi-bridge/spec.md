# chompi-bridge Specification

## Purpose

Define the CHOMPI bridge transport core: which device it opens, how a device session gates input, how it avoids replay and held controls, how one writer is enforced, and the event and light interface it offers task routing.

## Requirements

### Requirement: Controller matching and session gating
The bridge SHALL open only a HID interface matching VID `1209`, PID `000C`, product string `Agent Controller`, usage page `0xFF00` and usage `0x01`, optionally constrained by serial, and SHALL accept input only after a compatible version 1 `hello` with a nonzero epoch and the expected control, encoder and LED counts. It MUST NOT open MIDI or mass storage interfaces. When several devices match and no serial is configured, it SHALL refuse all of them.

#### Scenario: Stock CHOMPI attached
- **WHEN** the CHOMPI presents as MIDI `0483:5740`
- **THEN** the bridge matches nothing and opens no device

#### Scenario: Incompatible hello
- **WHEN** a matching device sends a `hello` with another version, epoch 0 or wrong counts
- **THEN** the bridge accepts no input from it and reports `unsupported-version` for the version and `incompatible-device` otherwise

### Requirement: Replay-free input with releases on loss
The bridge SHALL drop input from older epochs, duplicate or older sequences within an epoch, repeated presses and unmatched releases. On stale heartbeat, disconnect, epoch change or a firmware host-session restart (a current-epoch `hello` or a dropped host-current flag) it SHALL emit synthetic releases for every held control before reporting the state change, and SHALL ignore input until the device session is healthy again.

#### Scenario: Unplug during a held key
- **WHEN** the device disconnects while a key is held
- **THEN** subscribers receive a synthetic release and a `disconnected` event, and nothing from the old epoch is delivered after reconnect

#### Scenario: Firmware host-session restart
- **WHEN** the device sends a `hello` on the current epoch after a host timeout
- **THEN** the bridge releases every held control, emits one `session-restart` event and resends its current light frame, so lights never stay dark while reported applied

#### Scenario: Bridge restart with device enumerated
- **WHEN** the bridge opens a device that is already enumerated
- **THEN** it stays silent longer than the firmware host timeout, then heartbeats and waits for a fresh `hello` before accepting input

### Requirement: One writer
The bridge SHALL acquire a per-user single-instance lock before opening any device; read-only enumeration needs no lock, and a second instance SHALL exit with a distinct status without opening a device. The lock SHALL be released when the holding process exits, including on kill.

#### Scenario: Overlapping start
- **WHEN** a second bridge starts while the first holds the lock
- **THEN** the second exits with the lock-held status and the first keeps the device

### Requirement: Event and light interface
The bridge SHALL expose a versioned interface with `connected`, `input`, `stale`, `recovered`, `session-restart` and `disconnected` events through bounded subscriptions, and `setLeds` and `setBrightness` commands. A subscriber that overflows SHALL be closed rather than receive a partial stream. Light frames SHALL be sent as two parts with bounded rate and periodic resend. The interface SHALL carry no task semantics.

#### Scenario: Slow subscriber
- **WHEN** a subscriber's queue exceeds its bound
- **THEN** that subscription closes with reason `overflow` and other subscribers are unaffected

### Requirement: Portable core and lazy native transport
The bridge core SHALL run and be tested without native modules. The node-hid transport SHALL load only when the real device transport is selected, and the Windows OS adapter's koffi FFI bindings and PowerShell UI Automation helper SHALL load only when the Windows adapter is used on Windows. On any other platform the bridge SHALL use an unsupported adapter whose observations are all unknown and whose actions reject, so task routing fails closed.

#### Scenario: Linux CI
- **WHEN** the bridge suite runs in CI
- **THEN** no test loads node-hid or koffi, touches USB, opens a link or sends a keystroke to the desktop

#### Scenario: Routing on an unsupported platform
- **WHEN** `run` with a routing profile starts where no Windows adapter applies
- **THEN** every slot press fails closed and nothing is typed or opened

### Requirement: OS adapter contract version 2
OS adapter interface version 2 SHALL report every observation as known or unknown and SHALL compare titles inside the adapter without returning title or conversation text. Codex selection SHALL take the thread ID and the slot's Hub title: the adapter SHALL compare the name Codex keeps for that thread ID, read from `session_index.jsonl` in the Codex home (only `id`, `thread_name` and `updated_at`; a thread's last line is its current name), and SHALL use the Hub title only when Codex has never named the thread. It SHALL answer unknown, before any UI query, when the index cannot be read, when the thread's last entry is unusable or older than an earlier entry, when neither name exists, and when any other thread's current name equals the name to compare or any other thread whose current name is unusable has carried it. The Windows adapter SHALL type keys with `SendInput` through koffi FFI, identify the foreground window by package family (the process's package identity, or, when the process has none, the installed package folder its image runs from directly under `<Program Files>\WindowsApps`, as Codex Desktop's window process does; a real package identity always wins), open links through the shell, and use a long-lived PowerShell UI Automation helper for composer focus and the Codex selected row. It SHALL report composer focus as `false` and the Codex selected row as unknown when that client is not the foreground app, SHALL report approval visibility as unknown until an approval selector is qualified, SHALL read Codex archive filenames and Claude Desktop records by name and key only, SHALL never log, persist or return Codex thread names, SHALL send mouse-wheel input for `scrollClient` only while that client is the foreground app with the pointer inside its window (answering known `false` otherwise, without moving the pointer, clicking or typing), and SHALL release every key it holds on `releaseAll` and `close`.

#### Scenario: Client not in front
- **WHEN** another app is the foreground window
- **THEN** `composerFocused` answers known `false` and `codexSelectedThread` answers unknown, even if the client keeps an internally focused element

#### Scenario: Codex name over a stale Hub title
- **WHEN** Codex's session index names a thread differently from the slot's Hub title
- **THEN** the adapter compares the selected row with Codex's name, and the result carries only a boolean and a count

#### Scenario: Window process without package identity
- **WHEN** the foreground window's process has no package identity and its image lies in an installed package folder under `<Program Files>\WindowsApps`
- **THEN** the adapter reports that folder's package family, and it reports none for any other location

#### Scenario: Scroll outside the client
- **WHEN** `scrollClient` is called while the client is not in front or the pointer is outside its window
- **THEN** the adapter sends no input and answers known `false`

#### Scenario: Approval selector not qualified
- **WHEN** the router asks whether an approval card is visible
- **THEN** the adapter answers unknown and the router refuses Send

#### Scenario: Native read-only check
- **WHEN** the native Windows check runs
- **THEN** it loads the FFI bindings, reads the foreground identity, pings the UI Automation helper and reads composer, selected-thread and client-version observations with `SendInput` and `ShellExecute` replaced by throwing guards
