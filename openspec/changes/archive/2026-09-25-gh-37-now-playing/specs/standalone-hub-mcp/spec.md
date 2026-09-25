## ADDED Requirements

### Requirement: Source-bound playback tools
When playback is configured, the hub MCP SHALL register a read-scope playback status tool and a control-scope playback command tool bound to the configured source ID. The status tool SHALL return the shared playback snapshot. The command tool SHALL take only a client-chosen request ID and an action, SHALL submit it through the shared playback commands for the bound source and SHALL NOT accept a source, endpoint or other target. Discovery and calls SHALL require the matching scope and the source ID in the credential's devices, checked on every call. A staged hub SHALL refuse commands. Known rejections SHALL report their code with no prior effects, an uncertain result SHALL report possible effects, and nothing SHALL retry automatically.

#### Scenario: Read and command the configured source
- **WHEN** a credential with read and control scope and the source ID in its devices calls the status tool and then the command tool with a declared action
- **THEN** the status tool returns the snapshot, the source receives exactly one command, and repeating the request ID returns the original receipt without another call

#### Scenario: Missing grant or scope
- **WHEN** a credential lacks the source ID in its devices, or lacks control scope for the command tool, including after credentials change in an existing session
- **THEN** the affected tools are excluded from discovery, direct calls return `forbidden`, and the source receives no command

#### Scenario: Rejected and uncertain commands
- **WHEN** the action is not declared, the source is not available, another command is running or the hub is staged
- **THEN** the tool reports the typed rejection with no prior effects and sends nothing; and when the source does not answer a sent command, the tool reports an uncertain outcome with possible effects and does not retry
