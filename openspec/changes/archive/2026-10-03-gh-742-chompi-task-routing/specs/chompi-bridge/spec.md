## MODIFIED Requirements

### Requirement: Portable core and lazy native transport
The bridge core SHALL run and be tested without native modules. The node-hid transport SHALL load only when the real device transport is selected, and the Windows OS adapter's koffi FFI bindings and PowerShell UI Automation helper SHALL load only when the Windows adapter is used on Windows. On any other platform the bridge SHALL use an unsupported adapter whose observations are all unknown and whose actions reject, so task routing fails closed.

#### Scenario: Linux CI
- **WHEN** the bridge suite runs in CI
- **THEN** no test loads node-hid or koffi, touches USB, opens a link or sends a keystroke to the desktop

#### Scenario: Routing on an unsupported platform
- **WHEN** `run` with a routing profile starts where no Windows adapter applies
- **THEN** every slot press fails closed and nothing is typed or opened

## ADDED Requirements

### Requirement: OS adapter contract version 1
OS adapter interface version 1 SHALL report every observation as known or unknown and SHALL compare titles inside the adapter without returning title or conversation text. The Windows adapter SHALL type keys with `SendInput` through koffi FFI, identify the foreground window by package family, open links through the shell, and use a long-lived PowerShell UI Automation helper for composer focus and the Codex selected row. It SHALL report composer focus as `false` and the Codex selected row as unknown when that client is not the foreground app, SHALL report approval visibility as unknown until an approval selector is qualified, SHALL read Codex archive filenames and Claude Desktop records by name and key only, SHALL send mouse-wheel input for `scrollClient` only while that client is the foreground app with the pointer inside its window (answering known `false` otherwise, without moving the pointer, clicking or typing), and SHALL release every key it holds on `releaseAll` and `close`.

#### Scenario: Client not in front
- **WHEN** another app is the foreground window
- **THEN** `composerFocused` answers known `false` and `codexSelectedTitle` answers unknown, even if the client keeps an internally focused element

#### Scenario: Scroll outside the client
- **WHEN** `scrollClient` is called while the client is not in front or the pointer is outside its window
- **THEN** the adapter sends no input and answers known `false`

#### Scenario: Approval selector not qualified
- **WHEN** the router asks whether an approval card is visible
- **THEN** the adapter answers unknown and the router refuses Send

#### Scenario: Native read-only check
- **WHEN** the native Windows check runs
- **THEN** it loads the FFI bindings, reads the foreground identity, pings the UI Automation helper and reads composer, selected-title and client-version observations with `SendInput` and `ShellExecute` replaced by throwing guards
