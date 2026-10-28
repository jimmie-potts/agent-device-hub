# Report agent activity from both computers

Use the existing hook normalizers and scoped SDK ingress to report supported
Codex and Claude activity to one selected core. The hook runs where the agent
executes. An iPhone harness controls that agent; the phone is not its source.
Cloud-only work has no local hook coverage unless separately qualified.

The [private ingress guide](../apps/runtime/PRIVATE-ACCESS.md) owns the Mac HTTPS
route. The [local Mac Codex guide](mac-codex-hook-qualification.md) owns its
accepted shared Desktop and CLI feed. Preserve that local connector unless an
endpoint change is selected. [Issue #566](https://github.com/jimmie-potts/agent-device-hub/issues/566)
owns installed producer qualification on both computers. Source tests establish
neither actual client invocation nor OS or tailnet enrollment.

## Select each source

Record the installed client version, actual execution host, supported hook
entry point, absolute Node 24 executable and immutable release directory.
Keep provider/client/hostId/sourceId stable for that feed. Codex Desktop and CLI
that share settings and cannot identify their surface use the existing `local`
client. Claude Code uses `claude` and `code`. Do not guess a client from process
ancestry, absence of events or an iPhone UI.

Use the supported POSIX hook path on macOS or WSL. Keep WSL Node and private
producer files in WSL; qualify the actual Windows-client-to-WSL invocation.
The private producer reader requires owner-only POSIX files. Native Windows Node
with NTFS ACLs is not qualified by this reader; never bypass that check or infer
coverage from Linux containers. Preserve previously supported client entry points
and report a selected path that cannot satisfy this contract for its owner.

The producer source configuration has provider, client, hostId and sourceId;
an optional hook name is excluded from the existing credential derivation.
Derive the credential ID and source with `producerCredentialId` and
`producerSource` from the reviewed release's `@jimmie-potts/runtime/hook`.
Grant that source `ingest` only. Give another feed its own token and identity.
The private ingress refuses helper-derived sources whose lifecycle payload names
a different provider, client, host or source. Released local producers keep their
complete configuration-derived identity, including ignored extensions. New remote
qualification uses the four-field feed configuration above. Session IDs can repeat
across feeds.

## Prepare the private producer and receipt

New personal hooks, settings and credentials need the selected owner setup
authority. Prepare exact paths and a preservation plan before making those
changes. Keep tokens, actual addresses, client identities and receipts private,
outside Git and every GitHub publication surface. Preserve the existing notify
command and unrelated hooks, settings and credentials.

1. Verify the accepted core's exact release, private HTTPS origin and credential
   writer. Use its existing credential operations and the container operator's
   stopped-backup procedure when changing the selected installed profile.
   Keep the existing local ingest grant. The private-proxy profile permits
   ordinary scoped clients; do not give a producer read/control/admin scope.
2. Generate a fresh 32-byte base64url token in memory. The private producer holds
   the 43-character token; the core holds its SHA-256 digest. Verify
   `GET /api/v2/authority?scope=ingest` through the exact HTTPS origin with the
   Bearer token held in memory. Verify that other scopes are refused. Browser
   passwords are not machine credentials.
3. In a new owner-only directory, prepare `producer.json` with exactly `enabled`,
   `qualified`, `source`, `token`, `endpoint`, `transport` and, only if selected,
   the existing `lifecycleVersion`. Start with `enabled: false`. Set
   `transport: "private-https"`. The endpoint is the exact selected HTTPS origin
   plus `/api/monitor/v1/events`, without credentials, query or fragment. This
   suffix identifies the producer contract; publication uses that origin's
   `/api/sdk/v1/publish`. The metadata-only Codex wrapper requires no
   `lifecycleVersion` and opens no transcript or local index.
4. Qualify a disposable producer and ordinary supported payload against a
   disposable runtime using the same ingress contract before enrolling the
   personal client. Confirm the right
   host/provider, independent same-ID sessions, refused spoofing and a quiet
   unavailable/half-open path. Do not send synthetic personal-client events
   into the installed core merely to claim actual client acceptance.
5. Write the private `receipt.json` alongside the producer. Its `version` is 1,
   `state` is `installed`, and `token` is the same private token. Its `input`
   contains the exact absolute `directory`, `endpoint`, `source`,
   `qualified: true`, `transport: "private-https"` and matching optional
   `lifecycleVersion`. Retain the qualification evidence privately. A missing,
   applying, unsafe or mismatched remote receipt emits nothing.
6. Recheck the prepared bytes and expected prior settings. Set `qualified: true`
   and enable the producer only after its grant and receipt match. Both JSON
   files must be owner-only regular files with one link, opened without following
   links. The producer is at most 8 KiB; its receipt is at most 4 MiB. The hook
   never writes either file. Preserve intent and inspect actual files after an
   interrupted write rather than retrying blindly.
7. Add only the selected supported hook definitions, with absolute executable,
   release and producer paths and the existing three-second client timeout.
   Use `apps/runtime/bin/monitor-hook.mjs` for existing normalized provider paths
   or the metadata-only `apps/runtime/bin/mac-codex-hook.mjs` for its supported
   local Codex input. Keep the release and its package dependencies in place.

## Start and qualify the clients

After host sign-in, start the existing VPN and the supported agent client.
Core-container startup remains separate and does not read another host's home
or application database. Missing credentials, host sleep and an unreachable
core lose observations silently. The hook has one attempt inside its existing
2.9-second process budget. It queues nothing and changes no agent permissions.
If native filesystem or DNS work remains stuck at that deadline, the hook ends
itself by signal instead of waiting for Node's native worker to return. It stays
silent and nonblocking. The ordinary SDK error result retains its prepared trace;
server edge-refusal records retain their existing code/source/route fields without
claiming a message trace that was not admitted.
Without fresh evidence the core may show stale state; lack of an event never
means that work finished or was read.

Use ordinary controlled work through each selected Codex and Claude entry point.
Check its actual host/provider record in the dashboard, then a finished turn,
attention where supported and preserved local browser/MCP access. For the
selected iPhone-driven session, record the actual execution host and observation
path. Keep client versions, session IDs and state evidence private. Separate
actual-client results from synthetic transport and source tests.

## Switch endpoints or pause a feed

Disable only the selected connector first. Preserve its private producer,
receipt, grant identity and supported hook definitions. Select the qualified
new HTTPS origin, verify its source-bound grant and prepare a new matching
receipt. Recheck all exact inputs before enabling the producer. Changing only
the URL or relying on an old local qualification is refused. There is no
credential fallback, active-host discovery or replay after the switch.

To pause reporting, disable only its hook definitions or producer, or revoke
its credential with the existing credential writer and reload procedure.
Read back the affected grant and refusal. Preserve unrelated settings, notify
and latest core state. Connector recovery never restores an old database,
restarts legacy device writers or creates another core.
