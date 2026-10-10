## ADDED Requirements

### Requirement: Narrow BB-8 transport principal
The runtime SHALL grant a configured BB-8 helper credential only respond, serve, publish and subscribe on its internal command, link/result/outcome and core acknowledgment keys. Its source SHALL be bound to the configured Windows helper and ordinary read/control/ingest/browser grants SHALL remain unchanged. The helper SHALL have no public command request, session-content subscription or core-fact publication authority. Grants SHALL be checked on every call and revoked streams SHALL end.

#### Scenario: Helper and ordinary callers
- **WHEN** the selected helper serves its receipts and an ordinary reader or browser attempts to respond or serve, and the helper attempts a public request or session subscription
- **THEN** only the allowed helper operations succeed; all others are forbidden

### Requirement: BB-8 excluded from MCP execution
Generic MCP execution SHALL refuse BB-8 command families, including internal families, before dispatch. Saved-command resend SHALL not bypass this restriction.

#### Scenario: MCP LED request
- **WHEN** a control credential invokes generic MCP execution for BB-8 LED or an internal helper command
- **THEN** it receives a registered unsupported refusal and no BB-8 command is dispatched

## MODIFIED Requirements

### Requirement: Edge credentials and their reload

The configuration file's `edge` section SHALL be `{"credentials": <absolute path>, "browserAccess"?: "trusted-loopback", "launcher"?: <boolean>, "mcp"?: <boolean>, "editorLinks"?: {...}, "placeLinks"?: {...}}`, with editor links keyed by device routing ID (at most 16) and place links by ID other than `bunny` (at most 8, with a port), each a loopback `http` link without credentials, query or fragment; anything else SHALL refuse the file with `config-invalid`. The credentials file SHALL be `{"schema": "edge-credentials/1.0", "credentials": [{id, source, digest, scopes}]}`, a private file under the configuration file's rules of at most 64 KiB, with at most 32 credentials, distinct IDs, digests and sources, lowercase hexadecimal SHA-256 digests and never a token, sources not reserved (the core's, a module's, the runtime's own or the browser sessions' `bunny/parts/dashboard`), and distinct scopes from `read`, `control`, `ingest` and `admin`, and no other member except an explicit `role: bb8-link` with `robotId` for the fixed source `bunny/parts/bb8-windows` and empty ordinary scopes. The helper source SHALL require this role; malformed or mixed-role credentials SHALL be refused. Ordinary credentials that name device grants SHALL be refused rather than read wider than written; the runtime SHALL refuse to start with `edge-credentials-missing`, `edge-credentials-not-private`, `edge-credentials-invalid` or `edge-credential-source`. A token SHALL be compared with each digest in constant time.

`grantCredential`, `revokeCredential` and `writeEdgeCredentials` SHALL rewrite the file whole and owner-only while holding its lock, `<file>.lock`, which names the writer's process: writers in one process SHALL take turns, so changes made at once all take effect, and a writer in another process SHALL be refused with `edge-credentials-busy`; a writer SHALL create the lock with its content in one step and remove only a lock it created; a lock whose process has gone, or an empty or unreadable one over a minute old, SHALL be taken over in one step that never takes another writer's fresh lock: a writer that moved one SHALL put it back and refuse with `edge-credentials-busy`, and a temporary file a crashed writer left SHALL be removed. Each SHALL write a temporary file of its own name beside the file and rename it over the file only if the file still holds what the writer read, and otherwise SHALL refuse with `configuration-changed`, writing nothing. A grant of a credential the file holds as it is SHALL change nothing, and one whose ID the file holds with another digest, source or scopes, or whose source another credential has, SHALL be refused with `edge-credential-conflict`, as the old setup authority refused another owner's; a rotation revokes and then grants. SIGHUP and `Runtime.reload()` SHALL read the file again: a new credential SHALL be taken, a revoked or changed one SHALL have its streams ended and its next call refused with `unauthenticated`, and a file the runtime refuses SHALL keep the credentials it had. A SIGHUP while the runtime starts SHALL be kept and run once the gateway serves. Each reload SHALL log one `runtime.edge.reloaded` record, INFO with `succeeded` and the count, or ERROR with `failed` and the refusal's code.

`convertHubEdge(hubConfig)` SHALL carry the old Hub's credentials, with each ID, digest and scope, acting as `bunny/parts/<the ID in routing form>`, or `bunny/parts/dashboard-credential` for one called `dashboard`, and its `browserAccess`, `mcp`, `editorLinks` and `placeLinks`, with the launcher on, checked as the runtime's reader checks them. It SHALL drop every device grant, since no runtime grant limits a client to some devices (owner decision, 2026-10-07), and SHALL return `widened`, the ID alone of each credential with `read` or `control`, which the old Hub limited to the devices it named and the runtime does not, for a caller to review if conversion is separately selected. It SHALL refuse, with `convert-invalid` and no digest in its detail, IDs that would share a source, editor links that are not routing IDs, unknown scopes, another browser access, an `mcp` that is not a boolean, and links or counts the runtime would refuse.

#### Scenario: Grant, revoke and reload
- **WHEN** a producer's credential is granted and a reader's revoked in the file while the reader holds a stream, and the runtime reloads, and later a malformed file is reloaded
- **THEN** before the reload the producer is unauthenticated; after it the producer holds `ingest`, the revoked token is `unauthenticated`, its stream ended and it cannot reconnect; the malformed file's reload fails with `edge-credentials-invalid` while the operator still reads; the reloads are logged as `succeeded` then `failed`; and no token appears in a record, answer, health or span

#### Scenario: The edge section checked whole
- **WHEN** the edge section names a relative credentials path, an unknown member, another browser access, a launcher that is not a boolean, an editor link to another host or with a query, a place link without a port or a place called `bunny`, and a state directory too deep for the launcher's socket
- **THEN** each configuration is refused with `config-invalid`, the deep state directory refuses the start with `launcher-path-too-long`, and with the launcher off the same runtime starts and serves no socket

#### Scenario: Optional legacy conversion
- **WHEN** a synthetic Hub configuration with five credentials, two limited to some devices with `read` and `control`, one with `read` and no device, a producer with `ingest` alone and one with `ingest` and a device grant, one of them called `dashboard`, trusted loopback sign-in, MCP on and links is converted, written to synthetic credentials and served
- **THEN** each credential keeps its ID, digest and scopes with its source and no device grant, `dashboard`'s being `bunny/parts/dashboard-credential`; `widened` names, by ID alone, the three with `read` or `control` and neither `ingest` credential; the credentials file names no device; the edge section keeps the sign-in, MCP and links, a Hub without `mcp` converts with MCP off, each converted token holds exactly its scopes at `/api/v2/authority`, trusted loopback sign-in and MCP work, and the conversion refuses colliding IDs, an unknown scope, another browser access, an `mcp` that is not a boolean, an editor link to another host, a place link without a port and nine place links

#### Scenario: One credential per ID and source
- **WHEN** a credentials file gives two credentials one source, or one acts as `bunny/parts/dashboard`, the core, a module or the runtime
- **THEN** the first is `edge-credentials-invalid` and the others `edge-credential-source`

#### Scenario: Writers that never lose a change
- **WHEN** a credential is granted twice, granted again with another token, other scopes or another's source, revoked and granted with a new token; three grants and two revocations run at once; the file changes by hand while a grant and a revocation rewrite it; a live process, then a gone one, holds the lock beside a leftover temporary file; the lock comes to be another writer's while a grant holds it; and a fresh lock takes the place of a crashed writer's between a writer's judgement and its takeover
- **THEN** the second grant changes nothing, the others are `edge-credential-conflict` until the rotation, which takes; all five changes take effect; both writes are `configuration-changed` and the hand's change stands; the live lock is `edge-credentials-busy`, the gone one's lock and temporary file are taken over and removed, and the other writer's lock stands after the grant; and the writer that found a fresh lock puts it back, refuses with `edge-credentials-busy` and writes nothing

#### Scenario: A SIGHUP while the runtime starts
- **WHEN** a runtime with an edge gets SIGHUP while a module's start is still running
- **THEN** once it is ready it logs one `runtime.edge.reloaded` record with `succeeded`, after `runtime.edge.serving`
