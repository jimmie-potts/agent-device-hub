## Context

BUNNY currently requires a separately provisioned bearer. A network page cannot identify the installation owner merely by reaching loopback.

## Decision

The Linux Hub exposes a Unix socket inside its owner-only state directory. A launcher running as that owner requests a random 43-character code. The host retains at most eight codes for 30 seconds. The launcher opens the loopback page with the code in a URL fragment. The frontend immediately removes the fragment from browser history, exchanges the code through a same-origin bounded POST, and holds the returned bearer only in memory.

The exchanged bearer lasts eight hours and has read/control on the host's configured controller aliases. It has no ingest, admin or MCP scope. Active sessions are bounded, expiry is checked on every request, and disconnect revokes the session. The socket's owner-only filesystem path is the local authority boundary. The existing manual token form remains for direct visits and older installations. Reload discards the browser's memory-only bearer, requiring a fresh launch.

## Failure and recovery

An occupied or stale socket fails startup or launch explicitly. A code is consumed once or expires. A failed exchange leaves the page disconnected. Credential replacement and shutdown revoke browser sessions. The opener never prints a code on failure. Host state and device writers are unchanged.

## Verification

Disposable private stores and fake controllers cover socket permissions, absent/replayed/expired codes, origin rejection, scope bounds, logout, reload, browser handoff and installed-package behavior. Source checks do not use a personal service or device.
