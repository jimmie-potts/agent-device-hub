# 0007. One Linux installation with the existing worker

Status: Accepted for source implementation in [#54](https://github.com/jimmie-potts/codex-nanoleaf/issues/54).

## Context

The existing bridge keeps its state and light worker on Windows. WSL commands
forward through a Windows executable because Linux and Windows SQLite locks on
one mounted file do not exclude each other. Restricted Codex tasks can fail at
WSL's AF_VSOCK boundary before that Windows process starts. The user needs one
coordinated state owner and one light writer, and does not need a Windows tray.

The bridge already has a Linux worker launch path and SQLite coordination. Its
controller and Node MCP host already support the required direct HTTP exchange.
Reusing those processes avoids a combined daemon and a new hook-ingestion API.

## Decision

Provide a fresh Linux installer. Keep private runtime files and SQLite under
`~/.local/share/codex-nanoleaf` on the Linux filesystem. Hooks, CLI, wall map and
controller use that state and the existing transactions. Only the existing
on-demand worker writes lights. User systemd units run the map, controller and
MCP as separate foreground processes. Copy the required source files, create a
private Python environment and retain the selected native Node 24 executable.

Use fixed configurable numeric-loopback ports. MCP uses the existing
`windows-http` compatibility identifier for direct Linux HTTP. Keep the current
authentication, request identities, revision checks, retry holds and mode policy.
The wall map retains its presentation and prints a browser URL on Linux.

Windows Desktop/browser clients may remain. Mounted project, title and unread
JSON stays read-only. The operator retires this project's Windows services,
worker, startup entries and hooks before activating Linux. Runtime SQLite is
never shared across the two operating systems. No old Nanoleaf data is imported;
unrelated applications, hooks and Codex data are preserved.

## Consequences

This supersedes ADRs 0005 and 0006's Windows ownership/forwarding decision only
for a fresh Linux installation. Legacy Windows installations retain that path.
The Linux port does not adopt shared monitoring, move repositories, add Docker,
or supply migration and rollback tooling. WSL lifetime governs availability.

Source checks can establish isolated installation and transport behavior. Actual
hook permissions, service startup, browser access and visible lights require
[#55](https://github.com/jimmie-potts/codex-nanoleaf/issues/55).
[Hub #43](https://github.com/jimmie-potts/agent-device-hub/issues/43) owns the
linked architecture and guide documentation. Source delivery alone does not
install or qualify the user's runtime.
