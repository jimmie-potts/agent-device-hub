# Local Codex controls

The optional MCP host exposes `nanoleaf_status`, `nanoleaf_mode_set`, `nanoleaf_scenes_list`, `nanoleaf_scene_activate`, `nanoleaf_animations_list` and `nanoleaf_animation_play` through the protected local controller. Modes are Work, Quiet and Free. Their existing brightness and scene policies remain unchanged. The [local MCP specification](../openspec/specs/local-mcp-bindings/spec.md) owns behavior; [issue #33](https://github.com/jimmie-potts/codex-nanoleaf/issues/33) owns source delivery, [issue #91](https://github.com/jimmie-potts/codex-nanoleaf/issues/91) owns the scene tools, [issue #92](https://github.com/jimmie-potts/codex-nanoleaf/issues/92) owns the animation tools, [issue #113](https://github.com/jimmie-potts/codex-nanoleaf/issues/113) owns the optional [Panels tools](#control-the-panels) and [ADR 0006](decisions/0006-local-mcp-hosting.md) records hosting.

Source delivery does not install, provision credentials, launch Codex or touch lights. [Issue #55](https://github.com/jimmie-potts/codex-nanoleaf/issues/55) owns separately authorized installation, client permission checks and physical acceptance. The commands below are instructions for that handoff.

The [2026-09-08 acceptance record](hardware-validation.md) covers the retired
Windows-era clients, physical observations, restoration and cleanup.

## Prepare the source host

Use Node 24 in the same environment as Codex. The host is a separate optional package, so Python bridge startup gains no Node requirement. From the checkout:

```text
npm --prefix mcp ci --ignore-scripts
npm --prefix mcp run verify
npm --prefix mcp run build
npm --prefix mcp test
```

The private vendored MCP archive is version `1.0.0`, source `06c9c504a107cc04093c34500dadbbc6082679d2`, from [device-mcp-v1.0.0](https://github.com/jimmie-potts/agent-device-hub/releases/tag/device-mcp-v1.0.0). SHA-256 is `03f1ec51ffe5aa576799ea756dc65c0d47285e1e321fce20dc9241029196eb62`. Verification checks its release pin, installed manifest, bundled contract and the matching direct runtime contract. Dependencies and artifact content are pinned in `mcp/package-lock.json`. CI needs no sibling checkout or new private repository credential.

## Fresh Linux route

[Linux setup](linux-install.md) provisions the existing host, private credentials and a user service. The controller and MCP host both run in Linux. The generated configuration and [Linux example](../mcp/examples/linux.json) use `loopback-http`. They launch no helper process. The private client bearer is stored in `mcp-client-token` under the selected state directory. [ADR 0007](decisions/0007-linux-runtime-ownership.md) records the decision; [#55](https://github.com/jimmie-potts/codex-nanoleaf/issues/55) owns Linux client and physical acceptance.

## Run the host

The Linux installer generates the configuration and a user service; the [Linux example](../mcp/examples/linux.json) shows the same fields for a manual configuration copied to a private location outside the checkout. The transport is `loopback-http`; an installed configuration that still names `windows-http` is accepted as the same transport. Set `enabled` to true only when explicitly activating the host.

Use a fixed controller port selected through the [controller API instructions](controller-api.md). The source MCP host does not start or enable that controller. Its only route is `/mcp`, bound to numeric loopback. It does not change firewall rules, expose a LAN endpoint or start at sign-in. To run it in the foreground instead of the user service:

```bash
npm --prefix mcp start -- --config /PRIVATE/nanoleaf-mcp.json
```

The foreground process prints its local endpoint. Stop that process with Ctrl+C. Stopping MCP closes client delivery and new admission; it does not stop already admitted controller work.

## Keep credentials separate

The credential document contains at most 32 entries under `principals`. Each entry has `id`, `tokenSha256`, `scopes` and `upstreamToken`. IDs use 1 through 128 ASCII letters, digits, dots, underscores or hyphens. Scopes contain `read`, `control` or both. The MCP bearer and upstream bearer use 43 through 512 URL-safe opaque characters. Generate high-entropy credentials during authorized setup; a digest of a weak password is not an appropriate token.

`tokenSha256` is the lowercase SHA-256 digest of the MCP bearer. Only the client receives that bearer. `upstreamToken` is a different controller token issued for this principal through `controller-token`. Give each principal its own upstream credential. Duplicate principal IDs, digests and upstream credentials reject the document. Browser wall-editor tokens are never accepted here.

Keep the credential document outside Git with access restricted to the owning OS account. The host reads at most 64 KiB from a regular file at authentication and immediately before dispatch. Replace it atomically when rotating or revoking a principal. Removing an entry prevents new calls through existing sessions; changing its scopes takes effect before new dispatch. Missing or invalid files fail closed. Reissuing a controller credential follows #28's existing cancellation and revocation rules. No incoming MCP bearer is forwarded upstream, and credentials never appear in tool errors.

## Configure and inspect Codex

The [template](../mcp/examples/codex.toml) uses the inspected CLI 0.153.4 options and documented HTTP bearer configuration. On each selected client host, provide its private `NANOLEAF_MCP_TOKEN` environment variable and add the endpoint:

```text
codex mcp add nanoleaf --url http://127.0.0.1:41230/mcp --bearer-token-env-var NANOLEAF_MCP_TOKEN
codex mcp list
codex mcp get nanoleaf
```

CLI help was inspected for `--url` and `--bearer-token-env-var`. Templates and source fixtures do not prove that an installed client connected, displayed permission prompts or changed lights. Verify those outcomes during #55. See the [official MCP guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

Read status first. Mode calls require its `nextRequestId`, `configurationRevision` and `generation` as `requestId`, `expectedConfigurationRevision` and `expectedGeneration`, plus `mode`. Targets come from server configuration. Tools do not accept URLs, file paths, device overrides, raw commands, power, arbitrary brightness or zones.

## List and play saved scenes

`nanoleaf_scenes_list` needs the read scope and takes no arguments. It reads the `nanoleaf.integration/1.0` extension snapshot and returns each advertised scene as `{id, name?}`, where `id` is the opaque identifier also carried by the shared v1 `scenes` capability and `name` is the user's Nanoleaf app name, present only when it fits the 80-character label bound. Nothing else from that snapshot is exposed.

`nanoleaf_scene_activate` needs the control scope and the same `requestId`, `expectedConfigurationRevision` and `expectedGeneration` as `nanoleaf_mode_set`, plus `sceneId` from that listing. Following hub ADR 0005, activation is a separate command from mode selection; the tool never switches the device to Free itself. The controller accepts `scene.activate` only while the device is already in Free; in Work or Quiet it returns the typed `unsupported-capability` failure before any device write, with a replayable receipt. An unknown or no-longer-advertised scene ID is rejected the same way, before dispatch. Switch to Free first with `nanoleaf_mode_set`, then activate the scene.

## Play animations

`nanoleaf_animations_list` needs the read scope and takes no arguments. It returns the controller's [animation options](integration-api.md#requested-animations): the patterns and whether each takes a direction, the speeds, directions, defaults and limits. It also returns the current `mode`, `revision` and `nextRequestId`. It reads without touching tasks or lights.

`nanoleaf_animation_play` needs the control scope. It takes `requestId` (the listing's `nextRequestId`), `expectedRevision` (the listing's `revision`), `pattern` and 1 to 8 `#rrggbb` `colors`, plus optional `speed`, `loop` and, for `wave` and `gradient` only, `direction`. It sends one `animation.play` extension command with those values unchanged and adds no defaults of its own. The tool never switches mode. In Work or Quiet the controller rejects the command as `unsupported-capability` before any write, and the tool's failure carries a message saying to switch to Free with `nanoleaf_mode_set` and list the options again. To play "a slow blue-green ocean wave", call `nanoleaf_mode_set` with Free, call `nanoleaf_animations_list`, then play `wave` with `["#0044aa", "#00aa66"]` at `slow`.

The receipt comes from the extension. `queued` or `sent` does not establish visible light output; `uncertain` may have reached the device and is never retried. A mode command before the worker plays it cancels a queued animation.

## Control the Panels

After the Panels have their own [controller ledger](controller-api.md#add-the-nl22-light-panels), add `"panelsDeviceId": "panels"` to the private MCP configuration and restart the host. The host then binds the Panels as a second fixed target with four more tools:

| Tool | Scope | Same behavior as |
| --- | --- | --- |
| `nanoleaf_panels_status` | read | `nanoleaf_status` |
| `nanoleaf_panels_mode_set` | control | `nanoleaf_mode_set` |
| `nanoleaf_panels_scenes_list` | read | `nanoleaf_scenes_list` |
| `nanoleaf_panels_scene_activate` | control | `nanoleaf_scene_activate` |

Each tool always addresses its own configured device, and no tool accepts a device argument. Take a Panels request's `requestId`, `expectedConfigurationRevision` and `expectedGeneration` from `nanoleaf_panels_status`, because the Panels' ledger has its own sequence and revisions. The same MCP credentials work for both devices. The animation tools stay Lines-only. The value must differ from `deviceId`. Without it, the host is unchanged.

## Interpret results and recover

Status returns the controller snapshot with desired, pending, transmission and unknown observation evidence kept separate. A receipt saying `queued` or `sent` does not establish visible light output. A no-op can be `cancelled` with no failure or prior effects.

The host preserves controller replay/conflict/stale outcomes. It does not hold a second ledger or allocate replacement identities. If delivery fails after possible dispatch, the failure retains the original request ID and reports possible effects. Cancellation, disconnect and reconnect never retry automatically. Read status to inspect current owner state; explicitly replay the exact original request only when you intend the controller's existing replay behavior. A new identity authorizes a new request and is not an automatic recovery action.

Upstream exchanges have a six-second total budget, 64 KiB request and 512 KiB response limits. The shared host retains its 32-operation, 16-session and ten-second delivery bounds. A trickle response cannot create unbounded detached operations.

## Remove or roll back

Stop the foreground MCP process, then remove only its Codex entry with `codex mcp remove nanoleaf`. Revoke its dedicated controller credentials through the controller's existing command and remove its private MCP configuration when no longer needed. Do not clear the bridge database, run fresh setup or remove ordinary hooks, preferences or task state. To roll back source, stop this MCP host and select the previous reviewed source package; leave current controller state intact.

## Source validation

Run `npm run test:mcp`, the Python suite, browser regressions and workflow checks from the repository root. MCP tests use real protocol requests on 2025-11-25 and 2025-06-18 with synthetic credentials and fake controllers. Record their exact runtime results separately from installed-client and physical evidence in the PR.
