## Context

The hub's `ControllerClient` calls one loopback `/controller/v1` endpoint per configured alias with a bearer token, one request in flight per device and a 2 s timeout. It passes through a controller v1 receipt, including a rejection receipt with its HTTP status, and maps a bare `{failure:{code}}` body to a typed error. Nanoleaf's multi-device service takes `?deviceId=` on snapshot reads; Pixoo does not.

`TidbytController` already declares every controller v1 capability unsupported and retains such commands as `unsupported-capability` through the contract's `admit()`. The Linux runner from #21 and #38 loads a private runner JSON, takes a lease keyed by the cloud device, and runs the status and optional now-playing publishers through one controller. `LifxController` serializes each bulb's work, shares one request namespace between controller v1 commands and its `lifx-light` 1.0.0 profile, and sends nothing until a command or an explicit `refresh()`.

## Goals / Non-Goals

**Goals:** one process that is the only Tidbyt and LIFX writer; the hub reaches both through the same client, routes and MCP registry as the other kinds; LIFX color and temperature reach the dashboard and MCP without a contract change.

**Non-Goals:** automatic LIFX status (#20, #22), Tidbyt frames or playlists from the hub, integration settings routes, history series (#282), dashboard layout work (#277), moments (#292), Tronbyt (#23, #24), a packaged release archive, installing the service.

## Decisions

### One host reusing the runner configuration

The host configuration names the path of the existing Tidbyt runner JSON instead of repeating its fields. The host loads it with the runner's own loader and starts the runner in-process with `startStatusRunner`, which now also returns its controller. The status and now-playing publishers, their feed rules, the cloud connection and the lease stay exactly as delivered. Moving from the standalone runner to the host is: stop the runner, start the host with the same file.

The Tidbyt identity stays `tidbyt-status` / `tidbyt`, the runner's fixed IDs, so nothing that already reads it changes.

Alternative considered: a new inline Tidbyt block. That duplicates validation and makes rollback to the runner a configuration rewrite.

The standalone runner stays available. It and the host take the same lease, so they can never both write.

### Wire routes and statuses

- `GET /controller/v1/snapshot?deviceId=` returns the device's controller v1 snapshot.
- `POST /controller/v1/commands` accepts only a body that passes the contract's `validate('request')`. This keeps Tidbyt display and removal requests, which the in-process controller also accepts, off the network.
- `GET|POST /controller/lifx-light/v1/{snapshot,commands}` serve LIFX bulbs only. The snapshot is the LIFX controller's `{profile, controller, lighting}`. The command body must carry a `profile` member and pass the LIFX package's strict profile schema.

Admission decisions map to the contract's HTTP statuses. An unreserved rejection answers `{failure:{code}}`, which `ControllerClient` already maps. A reserved rejection or replay answers the receipt with its failure's status. An admitted command waits up to 1 s for its terminal receipt and otherwise answers the `queued` receipt with 202. A LIFX write usually settles in well under 100 ms. The hub client's 2 s timeout, and its single in-flight slot per device, make a longer wait counterproductive.

### Authentication

Credentials use the hub's shape: an ID, the SHA-256 hex digest of a 43-character base64url token, scopes and devices. The host compares the digest of the presented bearer in constant time. The contract's `authorize()` makes the decision, with `hostAllowed` set when `Host` equals the listener origin, `originPresent` from an `Origin` header (never allowed), and fetch metadata allowed only when absent or `same-origin`/`none`. Authentication runs before the body is read. Authorization needs the device ID, so for commands it runs after the bounded body is parsed and before submission. That is still before replay lookup and reservation.

### LIFX lighting in the hub

The hub validates lighting requests with its own small strict validator, like its Pixoo integration validator, rather than importing the LIFX package into the hub. A hub test checks the validator against the LIFX package's profile schema on shared valid and invalid cases, so they cannot drift silently. The hub forwards to the endpoint with `/controller/v1` replaced by `/controller/lifx-light/v1`, checks that the lighting snapshot's controller part is a valid v1 snapshot for the configured identity, and requires a v1 receipt with the same request ticket.

### Writer leases

Each configured bulb address gets a lease through the runner's `acquireWriterLease`, under `~/.local/state/agent-device-hub/lifx/`. That function is already a dedicated, OS-released SQLite lock keyed by a hash, independent of Tidbyt. A second host with an overlapping bulb, or any later LIFX runner using the same root, fails before sending traffic. All leases are taken before the listener opens and released on any startup failure.

### No bulb polling

The host never calls `refresh()` on its own. Observation appears after a brightness, color or temperature command's read-modify-write, and otherwise stays unknown with its age. That keeps the LIFX README's manual-control rule and #20's open policy intact.

### MCP and dashboard by kind

MCP binds tools per kind instead of binding every v1 tool and letting the owner reject it: Tidbyt gets status only, LIFX gets status, power, brightness, lighting status, color and temperature. The HTTP route still passes any valid v1 command to the owner, so the owner's rejection remains the authority.

The dashboard reads `/lighting/snapshot` for LIFX components, as it reads integration snapshots for Pixoo and Nanoleaf. Color and temperature forms reuse the existing guarded `EditForm` and command lifecycle, with the lighting snapshot's controller part as the guard source. The advanced-editor line is shown only for Pixoo and Nanoleaf.

## Risks / Trade-offs

- [The 1 s wait holds the hub's per-device slot, so a dashboard read during it gets 429] → The wait only applies to an admitted command and ends when the bulb settles; the dashboard already treats 429 as transient.
- [The Tidbyt publishers consume request sequences, so a hub Tidbyt command can expire] → Every Tidbyt v1 command is unsupported, and the client re-reads before sending.
- [The host reads the hub feed while the hub routes to the host] → Neither waits for the other at startup: the runner shows `FEED ?` and the hub reports the controller unavailable until both run.
- [Hub-side lighting validator drifts from the LIFX schema] → The cross-check test above.

## Migration Plan

Installation is a separate, owner-authorized step:

1. Build a pinned revision in a release directory, as for the Tidbyt runner.
2. Write the host configuration: port, `bunny-hub` credential digests per device, the existing runner JSON path, and the LIFX bulbs with their qualified model evidence.
3. Stop the standalone Tidbyt runner, start the host, and confirm `local-controllers-started`.
4. Add the `tidbyt` and `lifx` controller entries, with their plaintext tokens, to `host.json` and restart the hub.

Rollback: stop the host, start the standalone runner with the same file, and remove the entries from `host.json`.
