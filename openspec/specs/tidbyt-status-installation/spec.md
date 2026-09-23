## Purpose

Connect the existing Tidbyt status publisher to one installed shared hub using private configuration, bounded reads and a single local device writer.

## Requirements

### Requirement: Private explicit configuration

The Linux runner SHALL take only a configuration-file path as its argument. Configuration and credential files SHALL be owner-owned regular files with no group/world permissions, bounded in size, and outside source checkouts. Errors and status output SHALL exclude secrets, session data and file contents.

#### Scenario: Unsafe configuration
- **WHEN** configuration or a credential file is readable by another user, malformed or inside a source checkout
- **THEN** startup fails before any network request with a fixed error code

### Requirement: Read only the selected hub

The runner SHALL read the configured numeric IPv4 loopback hub through its authenticated sessions route. It SHALL validate the API version, current connection, expected owner and shared snapshot; refuse redirects; enforce a 2.5 second deadline and a one MiB body bound; and expose failures to the existing publisher as unavailable feed evidence. It SHALL neither ingest events nor acknowledge notices nor open shared state databases.

#### Scenario: Wrong owner or failed feed
- **WHEN** a read returns a different owner, incompatible envelope, invalid snapshot, oversized body, timeout or failed HTTP response
- **THEN** the publisher receives unavailable evidence and retains its released stale-display behavior

#### Scenario: Current feed
- **WHEN** the selected hub returns a valid current snapshot
- **THEN** that snapshot reaches the existing publisher without another lifecycle reducer

### Requirement: One runner per device and bounded shutdown

The runner SHALL hold an OS-released local lease keyed by the configured cloud device for its lifetime. It SHALL start the existing controller and status publisher only after acquiring that lease. SIGINT and SIGTERM SHALL stop scheduling, cancel queued work, settle admitted work and release the lease. Shutdown SHALL leave the current installation in place; healthy idle removal remains the publisher's existing policy. Restart SHALL evaluate current state without replaying prior write requests.

#### Scenario: Concurrent startup
- **WHEN** another runner for the same cloud device already holds the local lease
- **THEN** startup fails before any feed or cloud request

#### Scenario: Stop and restart
- **WHEN** the runner stops or its process dies
- **THEN** the OS releases its lease, and a later start reads current state with fresh request identities

### Requirement: Separate installation acceptance

The runbook SHALL explain owner-controlled installation, startup, shutdown and recovery, and SHALL keep transport receipts separate from visual acceptance. The issue's closing evidence SHALL require a real client and the user's observations of working, attention, done, stale feed and background rotation.

#### Scenario: Source validation only
- **WHEN** fake and loopback tests pass
- **THEN** installation and physical acceptance remain pending until their own evidence is obtained
