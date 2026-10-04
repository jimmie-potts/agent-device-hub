## MODIFIED Requirements

### Requirement: Fail-closed exact-task focus
A slot key press SHALL invalidate any earlier target and run, in order: the target check (slot assigned, client version qualified, Codex thread not archived, Claude Desktop record present and not archived), the fixed deep link for that task, verification of the foreground package family and the selected task, and composer focus. Codex selection SHALL require the selected row to match the thread's name with exactly one row of that name, where the name is the one Codex keeps for the thread in its local session index, or the slot's last-known Hub title when Codex has none; with neither, verification SHALL fail closed as `title-missing` without typing. Claude selection SHALL require only the target's `lastFocusedAt` to advance past the press, checked against every known Claude Desktop ID read in bounded calls, never a truncated subset. Verification SHALL poll observations within a bounded time and SHALL NOT repeat the link or any keystroke. An unqualified or unknown client version SHALL disable that client's routing and leave the other client unaffected, because UI selectors (and Claude's undocumented link) depend on the version, and the log SHALL name the observed version. The version gate SHALL apply before any input, not only before opening: it SHALL run again after verification and before the composer shortcut, the dictation chord and Send. At start-up the bridge SHALL warm the adapter, when it offers a warm-up, before the controller connects. Any failure or unknown SHALL light the error state, log the step and reason without titles, and leave no target. A task key press MUST NOT acknowledge, approve or dismiss anything.

#### Scenario: Foreground alone is insufficient
- **WHEN** Codex comes to the front but keeps another task selected
- **THEN** verification fails, nothing is typed and no target remains

#### Scenario: Codex thread without a Hub title
- **WHEN** the Hub has no title for a Codex slot's thread and Codex's session index names it
- **THEN** verification compares the selected row with Codex's name and focus can succeed

#### Scenario: Codex thread with no name anywhere
- **WHEN** neither Codex's session index nor the Hub has a name for the thread
- **THEN** verification fails as `title-missing`, nothing is typed and no target remains

#### Scenario: Duplicate Codex titles
- **WHEN** two open Codex tasks share the slot's title
- **THEN** Codex verification fails closed, while Claude tasks still verify by Desktop ID

#### Scenario: Many Claude sessions
- **WHEN** more than 63 Claude Desktop sessions are known and one of them besides the target also became visible
- **THEN** verification reads all of them and fails as ambiguous

#### Scenario: Unqualified client
- **WHEN** the installed Claude Desktop or Codex version is not listed
- **THEN** that client's slots open nothing and the other client's routing is unaffected

#### Scenario: Client update noticed after the link opens
- **WHEN** the gate passes on a cached version and the adapter reports an unlisted or unknown version once the updated client is in front
- **THEN** nothing is typed, not even the composer shortcut, the key lights its error state and the log names the observed version
