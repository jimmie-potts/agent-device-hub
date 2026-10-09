# Local Codex controls

The optional MCP host exposes `nanoleaf_status` and `nanoleaf_mode_set` through the protected local controller. Modes are Work, Quiet and Free. Their existing brightness and scene policies remain unchanged. The [local MCP specification](../openspec/specs/local-mcp-bindings/spec.md) owns behavior; [issue #33](https://github.com/jimmie-potts/codex-nanoleaf/issues/33) owns source delivery and [ADR 0006](decisions/0006-local-mcp-hosting.md) records hosting.

Source delivery does not install, provision credentials, launch Codex or touch lights. [Issue #34](https://github.com/jimmie-potts/codex-nanoleaf/issues/34) owns separately authorized installation, client permission checks and physical acceptance. The commands below are instructions for that handoff.

The [2026-09-08 acceptance record](hardware-validation.md) covers the tested
Windows and WSL clients, physical observations, restoration and cleanup.

## Prepare the source host

Use Node 24 in the same environment as Codex. The host is a separate optional package, so legacy Python bridge startup gains no Node requirement. From the checkout:

```text
npm --prefix mcp ci --ignore-scripts
npm --prefix mcp run verify
npm --prefix mcp run build
npm --prefix mcp test
```

The private vendored MCP archive is version `1.0.0`, source `06c9c504a107cc04093c34500dadbbc6082679d2`, from [device-mcp-v1.0.0](https://github.com/jimmie-potts/agent-device-hub/releases/tag/device-mcp-v1.0.0). SHA-256 is `03f1ec51ffe5aa576799ea756dc65c0d47285e1e321fce20dc9241029196eb62`. Verification checks its release pin, installed manifest, bundled contract and the matching direct runtime contract. Dependencies and artifact content are pinned in `mcp/package-lock.json`. CI needs no sibling checkout or new private repository credential.

## Fresh Linux route

[Linux setup](linux-install.md) provisions the existing host, private credentials and a user service. The controller and MCP host both run in Linux. The generated configuration and [Linux example](../mcp/examples/linux.json) use `windows-http`, the existing compatibility name for direct HTTP on either OS. They do not launch Windows executables. The private client bearer is stored in `mcp-client-token` under the selected state directory. [ADR 0007](decisions/0007-linux-runtime-ownership.md) records the decision; [#55](https://github.com/jimmie-potts/codex-nanoleaf/issues/55) owns Linux client and physical acceptance.

## Legacy Windows and WSL-to-Windows routes

Copy the matching example in `mcp/examples` to a private location outside the checkout. Replace all placeholder paths and target IDs. Set `enabled` to true only when explicitly activating the host.

On Windows, `windows-http` calls the controller's configured `127.0.0.1` port directly. On WSL, `wsl-helper` starts the explicitly configured Windows Python executable using the Windows path to this checkout's `mcp/windows-controller-http.py`. Keep that helper at a durable trusted Windows-accessible path. Neither route opens SQLite. The helper has no bridge imports and does not need the installed bridge's private directory.

Use a fixed controller port selected through the existing [controller API instructions](controller-api.md). The source MCP host does not start or enable that controller. Its only route is `/mcp`, bound to numeric loopback. It does not change firewall rules, expose a LAN endpoint or start at sign-in.

For Windows PowerShell:

```powershell
npm --prefix mcp start -- --config 'C:\PRIVATE\nanoleaf-mcp.json'
```

For WSL:

```bash
npm --prefix mcp start -- --config /PRIVATE/nanoleaf-mcp.json
```

The foreground process prints its local endpoint. Stop that process with Ctrl+C. Stopping MCP closes client delivery and new admission; it does not stop already admitted controller work.

## Keep credentials separate

The credential document contains at most 32 entries under `principals`. Each entry has `id`, `tokenSha256`, `scopes` and `upstreamToken`. IDs use 1 through 128 ASCII letters, digits, dots, underscores or hyphens. Scopes contain `read`, `control` or both. The MCP bearer and upstream bearer use 43 through 512 URL-safe opaque characters. Generate high-entropy credentials during authorized setup; a digest of a weak password is not an appropriate token.

`tokenSha256` is the lowercase SHA-256 digest of the MCP bearer. Only the client receives that bearer. `upstreamToken` is a different controller token issued for this principal through `controller-token`. Give each principal its own upstream credential. Duplicate principal IDs, digests and upstream credentials reject the document. Browser wall-editor tokens are never accepted here.

Keep the credential document outside Git with access restricted to the owning OS account. The host reads at most 64 KiB from a regular file at authentication and immediately before dispatch. Replace it atomically when rotating or revoking a principal. Removing an entry prevents new calls through existing sessions; changing its scopes takes effect before new dispatch. Missing or invalid files fail closed. Reissuing a controller credential follows #28's existing cancellation and revocation rules. No incoming MCP bearer is forwarded upstream, and credentials never appear in helper argv or tool errors.

## Configure and inspect Codex

The [template](../mcp/examples/codex.toml) uses the inspected CLI 0.153.4 options and documented HTTP bearer configuration. On each selected client host, provide its private `NANOLEAF_MCP_TOKEN` environment variable and add the endpoint:

```text
codex mcp add nanoleaf --url http://127.0.0.1:41230/mcp --bearer-token-env-var NANOLEAF_MCP_TOKEN
codex mcp list
codex mcp get nanoleaf
```

CLI help was inspected for `--url` and `--bearer-token-env-var`. Templates and source fixtures do not prove that an installed client connected, displayed permission prompts or changed lights. Verify those outcomes during #34. See the [official MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

Read status first. Mode calls require its `nextRequestId`, `configurationRevision` and `generation` as `requestId`, `expectedConfigurationRevision` and `expectedGeneration`, plus `mode`. Targets come from server configuration. Tools do not accept URLs, file paths, device overrides, raw commands, power, arbitrary brightness, scenes or zones.

## Interpret results and recover

Status returns the controller snapshot with desired, pending, transmission and unknown observation evidence kept separate. A receipt saying `queued` or `sent` does not establish visible light output. A no-op can be `cancelled` with no failure or prior effects.

The host preserves controller replay/conflict/stale outcomes. It does not hold a second ledger or allocate replacement identities. If delivery fails after possible dispatch, the failure retains the original request ID and reports possible effects. Cancellation, disconnect and reconnect never retry automatically. Read status to inspect current owner state; explicitly replay the exact original request only when you intend the controller's existing replay behavior. A new identity authorizes a new request and is not an automatic recovery action.

Upstream exchanges have a six-second total budget, 64 KiB request and 512 KiB response limits. Helper stderr is capped at 4 KiB. The shared host retains its 32-operation, 16-session and ten-second delivery bounds. A trickle response or blocked child cannot create unbounded detached operations.

## Remove or roll back

Stop the foreground MCP process, then remove only its Codex entry with `codex mcp remove nanoleaf`. Revoke its dedicated controller credentials through the controller's existing command and remove its private MCP configuration when no longer needed. Do not clear the bridge database, run fresh setup or remove ordinary hooks, preferences or task state. To roll back source, stop this MCP host and select the previous reviewed source package; leave current controller state intact.

## Source validation

Run `npm run test:mcp`, the Python suite, browser regressions and workflow checks from the repository root. MCP tests use real protocol requests on 2025-11-25 and 2025-06-18 with synthetic credentials and fake controllers. Windows and WSL forwarding fixtures remain source tests. Record their exact runtime/platform results separately from installed-client and physical evidence in the PR and #34 handoff.
