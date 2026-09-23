# Tidbyt controller

Status: the source for a fake-tested cloud controller is here as the private
workspace package `@jimmie-potts/tidbyt-controller` 0.1.0. It is an in-process
TypeScript library. It has no network listener or service, isn't installed
anywhere, and hasn't been hooked up to agent status.

This controller will display automatic agent status using Tidbyt's official
cloud first. It will consume the feed of the selected shared agent-state
owner. A later Tronbyt connection will reuse the same renderer and device queue.
The [shared architecture](../../docs/architecture.md) and
[ADR 0003](../../docs/decisions/0003-device-controller-monorepo.md) own that direction.

## What the package provides

- **Renderer** (`src/render.ts`, `src/webp.ts`): a pure function from a 64×32
  RGB frame to lossless WebP (VP8L), with no dependencies. It has no I/O and
  knows nothing about backends, credentials or configuration. Golden images
  under `fixtures/` are checked byte for byte in TypeScript and decoded
  independently by Pillow.
- **Cloud connection** (`src/connection.ts`): background pushes to one configured
  installation through `POST /v0/devices/{device}/push`, plus a read-only
  installation listing. It classifies each result once and never retries it.
  Foreground pushes are declared unsupported, so the current app keeps
  rotating. The [push qualification](https://github.com/jimmie-potts/agent-device-hub/issues/16#issuecomment-5789545093)
  records the cloud behavior this relies on.
- **Credentials** (`src/credentials.ts`): `TIDBYT_DEVICE_ID`, `TIDBYT_API_KEY` and
  an optional `TIDBYT_INSTALLATION_ID` (default `agentdevicehub`, letters and
  digits only) come from a mode-600 file outside Git, for example
  `~/.config/agent-device-hub/tidbyt.env`. The loader checks permissions, not
  location, so keep the file out of any checkout. Loading fails on
  group- or world-readable files. Secrets never come from arguments or the
  environment, and errors never repeat file contents.
- **Controller** (`src/controller.ts`): the only writer for one Tidbyt. See below.

## Display profile and queue

Controller v1 has no frame command, so display writes use the controller-local
`tidbyt-display` 1.0.0 profile. A request is the v1 envelope (`apiVersion`,
`controllerId`, `deviceId`, `requestId`, `expectedConfigurationRevision`,
`expectedGeneration`) with the command
`{kind:"tidbyt.display", frame:{width:64,height:32,encoding:"rgb24-base64",data}}`.
`data` is canonical base64 of exactly 6144 bytes. Receipts and the embedded
controller snapshot are schema-valid [controller v1](../../docs/controller-contract.md)
objects. The shared contract is unchanged. The profile is validated in
TypeScript only and has no version negotiation; a future network surface (#21)
must add a versioned profile schema and an explicit compatibility error.

- Admission follows the contract's order. The controller rejects an
  unregistered target or malformed request, then a body over 64 KiB, then an
  expired or future identity. A duplicate replays or joins the original result,
  a changed body returns `request-conflict`, and a full queue (8 by default)
  returns `capacity`. None of these reserve an identity. Display and v1
  requests are bounded by their schemas well below 64 KiB, so the body limit is
  a declared backstop rather than a reachable path. Revision and
  generation conflicts are reserved and retained. Controller v1 commands go
  through the contract's own `admit()` and are retained as
  `unsupported-capability`.
- One push is in flight at a time, in admission order. The contract's `dequeue`
  reference checks the generation just before each push. `cancelPending()`
  cancels queued writes as `stale-generation`; a write already in flight reports
  its own result.
- `sent` means the cloud accepted the push. A timeout, lost response or server
  error is `uncertain`, with possible prior effects. The controller never
  replays it, and a duplicate submission returns the retained receipt.
- A 401, 403, or the cloud's "no UID" 500 sets an authentication hold. Later
  writes fail with the same `unauthenticated` or `forbidden` code without a
  network call until `reconfigure()`.
  A 429 fails that write with `capacity` and holds queued writes for
  `Retry-After` (default 60 s, capped at 15 min).
- `refresh()` reads the installation list only. It resubmits nothing and
  reserves no identity.
- The snapshot's `display` section reports pending tickets, holds, the
  connection's declared capabilities and installation evidence with its own age.
  Visible-device evidence is always `unknown`, as are v1 observation, desired
  power/brightness/mode and external control. The v1 `state.pending` list holds
  only v1 commands, so it is always empty here; `display.pending` is the
  authority for queued display writes. `refresh()` reports `unavailable` while
  an authentication hold blocks writes, and a result from a connection that
  `reconfigure()` replaced never re-applies holds or health. Every v1 capability
  is declared unsupported. The v1 limits for events, streams and authentication timeout are
  set to the schema minimum, because the library serves none of them.

## Connection and rendering boundary

Keep cloud/server identity, credentials, installation identity, capabilities,
interruption/background behavior and delivery outcomes in the selected
connection. Backend capabilities must be qualified; similar API paths do not
establish interchangeable behavior.

Tronbyt requires its own server and compatible device firmware. A future
configuration selector is only the controller side of that transition. The
physical change needs confirmed Tidbyt generation, explicit authorization and
a recovery plan. Never enable both backend writers or use automatic failover.

The status implementation will settle layout, session selection, update cadence,
notice handling and rotation/takeover/restore policy before readiness. Preserve
shared activity, attention, acknowledgment, optional read evidence and freshness
as distinct values. Shared payloads use neutral IDs or user-chosen labels.

## Issues

GitHub issues own the delivery sequence, prerequisites and acceptance; see the
[open Tidbyt issues](https://github.com/jimmie-potts/agent-device-hub/issues?q=is%3Aissue+is%3Aopen+Tidbyt+OR+Tronbyt+in%3Atitle).
Controller contracts belong to shared #4; this directory must not invent a
competing common API.

## Development and evidence

Follow [scoped instructions](AGENTS.md) and the root
[development guide](../../docs/development.md#tidbyt-controller-checks). From the
worktree root on Node 24, run `npm run test:tidbyt`. With Pillow from
`requirements-contracts.txt` installed, also run `npm run test:tidbyt:python`.
After an intentional encoder change, run `npm run build`, regenerate the golden
images with `node controllers/tidbyt/scripts/write-golden.mjs` and rerun both checks.

Source tests use fake connections and a fake `fetch`. Real pushes need the
user's explicit go-ahead and happen only where an issue allows them: one test
push in #16, then installation in #21. Hardware acceptance also needs explicit
permission to replace what the display shows. Credentials and device/account
configuration stay outside Git. A successful push does not prove a visible
result.
