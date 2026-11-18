## MODIFIED Requirements

### Requirement: The 2.0 agent hook script

`apps/runtime/bin/monitor-hook.mjs` SHALL be the 2.0 agent hook. Run as a client's hook command, `node monitor-hook.mjs <producer file>` with the hook's JSON on stdin, it SHALL read the producer file (see "The producer file, unchanged"), build the 2.0 `lifecycle` observation directly with the runtime's own adapter in `apps/runtime/src/hook/`, with no lifecycle 1.x envelope in between, and publish it as `org.bunny.lifecycle.observed` on `bunny.event.lifecycle.<session ID>`, whose subject is the session's entity ID, in one call to the runtime's SDK edge through `publishOnce`, with no stream. The adapter SHALL check the producer's source against the contracts package's supported-source definition. For a producer that selects no lifecycle version it SHALL normalize the hook alone, and for one that selects 1.1 or 1.2 it SHALL add the version's title, project and host-session enrichment. Its output SHALL be byte-identical to the observation the retained normalizers and the earlier mapping produced for the same hook and producer file: kebab-case event kinds, the native event ID as `nativeEventId`, known ordering with the identity's source as its authority, and every other field kept; a consumer's acknowledgment SHALL produce nothing. The script SHALL import only by package name, `@jimmie-potts/runtime/hook`, which SHALL load the adapter, the SDK and the contracts and none of the rest of the runtime, so the installer can place it behind the hook link.

#### Scenario: Each accepted observation commits the session
- **WHEN** the hook runs a Claude Code session's `SessionStart`, `UserPromptSubmit` with a `prompt_id`, `PermissionRequest`, `PostToolUse` with a `tool_use_id` and `Stop` with an unchanged producer file that selects no lifecycle version, 1.1 or 1.2, against the runtime's gateway
- **THEN** each run exits 0 and writes nothing, the core accepts each observation from the producer's converted source, and each session appears quiet, with its project from 1.1 on, then holds the turn, raises the approval prompt on it, clears it and ends the turn finished with its notice

#### Scenario: A subagent
- **WHEN** the hook runs `SubagentStart` and `SubagentStop` for a subagent of a session the core holds, of a session it has not seen, and of a session its producer said is top-level, and a `SubagentStart` whose agent ID is its own session's
- **THEN** each subagent's record has the known parent in its own source and no project or host session ID, each parent counts it as working until its stop, a top-level parent stays top-level, and the hook drops the one that names its own session; an observation whose known parent is in another source or on another host, or is the child's own session, is refused at the edge with `invalid-message` and never reaches the core

#### Scenario: Each lifecycle version
- **WHEN** producers that select no version, 1.1 and 1.2 run the hook, with and without a receipt, in a Claude Desktop hook environment
- **THEN** each session reaches the core; the 1.1 and 1.2 sessions carry the project, and only the 1.2 sessions carry the host session ID

#### Scenario: Every 1.x event kind
- **WHEN** every hook fixture, producer lifecycle version and title source runs through the runtime's adapter and through the retained normalizers with the earlier mapping
- **THEN** the two observations are byte-identical, titles included, and an acknowledgment produces nothing in both
