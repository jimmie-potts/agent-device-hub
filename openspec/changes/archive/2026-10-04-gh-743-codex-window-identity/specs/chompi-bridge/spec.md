## MODIFIED Requirements

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
