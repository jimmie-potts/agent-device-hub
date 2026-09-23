# Tidbyt controller

Status: the source for a fake-tested cloud controller is here as the private
workspace package `@jimmie-potts/tidbyt-controller` 0.1.0. It is an in-process
TypeScript library. It has no network listener or service and isn't installed
anywhere. Since #19 it includes a fake-tested agent status publisher. The opt-in Linux runner connects it to an existing hub feed; installation and
visible-device acceptance remain separate from these source tests.

This controller displays automatic agent status through Tidbyt's official
cloud. It consumes the feed of the selected shared agent-state owner. A later
Tronbyt connection will reuse the same renderer and device queue.
The [shared architecture](../../docs/architecture.md) and
[ADR 0003](../../docs/decisions/0003-device-controller-monorepo.md) own that direction.

## What the package provides

- **Renderer** (`src/render.ts`, `src/webp.ts`): a pure function from a 64×32
  RGB frame to lossless WebP (VP8L), with no dependencies. It has no I/O and
  knows nothing about backends, credentials or configuration. Golden images
  under `fixtures/` are checked byte for byte in TypeScript and decoded
  independently by Pillow.
- **Cloud connection** (`src/connection.ts`): background pushes to one configured
  installation through `POST /v0/devices/{device}/push`, removal of that
  installation through `DELETE /v0/devices/{device}/installations/{installation}`,
  and a read-only installation listing. It classifies each result once and never retries it.
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
- **Agent status** (`src/status.ts`, `src/font.ts`, `src/publisher.ts`): a pure view
  and 64×32 frame drawer over one agent-state snapshot, and a publisher that
  submits pushes and removals through the controller. See
  [Agent status decisions](#agent-status-decisions).

## Display profile and queue

Controller v1 has no frame command, so display writes use the controller-local
`tidbyt-display` 1.1.0 profile. A request is the v1 envelope (`apiVersion`,
`controllerId`, `deviceId`, `requestId`, `expectedConfigurationRevision`,
`expectedGeneration`) with the command
`{kind:"tidbyt.display", frame:{width:64,height:32,encoding:"rgb24-base64",data}}`
or, since 1.1.0, `{kind:"tidbyt.remove"}`. `data` is canonical base64 of
exactly 6144 bytes. A removal deletes the configured installation. It follows
the same admission, FIFO order, generation check, holds and receipts as a push,
with operation ID `remove`. Receipts and the embedded
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

## Agent status decisions

The user settled these on 2026-09-23 for #19. The
[archived design](../../openspec/changes/archive/2026-09-23-gh-19-tidbyt-agent-status/design.md)
and the [tidbyt-agent-status spec](../../openspec/specs/tidbyt-agent-status/spec.md)
hold the details.

- **Layout.** Up to four 8-pixel rows, one per root session: a colored marker, a
  label of up to ten characters and a state word. `ASK` (amber) means the
  session has attention, `RUN` (blue) means it or one of its child sessions is
  active, and `DONE` (green) means a turn-ended notice has not been acknowledged. Rows are ordered `ASK`,
  `RUN`, `DONE`, then newest evidence first. With more than four sessions,
  three rows are drawn and the fourth reads `+N MORE`. Child sessions and
  sessions with nothing outstanding are not shown.
- **Labels.** The session's user label, then its user-chosen project ID, then a
  neutral ID: `C` (Claude) or `X` (Codex) and four hex digits of the identity
  hash. No title, prompt or other agent content is drawn.
- **Uncertainty.** A session with uncertain freshness is dimmed and its marker
  becomes `?`. If the feed can't be read within 3 s or its collector isn't
  running, every row from the last good snapshot is marked that way, or the
  frame reads `FEED ?`. Read evidence doesn't retire `DONE`. By default any
  consumer's acknowledgment does; the publisher can name specific consumers.
- **Cadence.** Push only when the frame changes, at most once every 15 s,
  coalescing to the latest state. Push an unchanged frame again after 10
  minutes. Re-read the feed every 30 s and on each change notice. #16 saw no
  rate limit, and a 429 still triggers the controller's hold.
- **Rotation.** Status is a background installation in the normal rotation.
  Foreground takeover is not qualified. When a readable feed shows nothing to
  display, the publisher removes the installation, including a leftover one at
  start. When presence is unknown it first reads the installation list through
  the controller and skips the removal if the installation is already gone. An
  unavailable feed never removes it.
- **Failures.** A failed write is not replayed. A later write is a fresh request
  for the current state. The wait after an unsent write starts at 15 s and
  doubles with each further consecutive write not confirmed sent, up to 10
  minutes. A failed removal makes presence unknown again. An uncertain
  write makes installation presence unknown. A feed read that outlives its
  timeout blocks new reads until it settles.

Shared activity, attention, acknowledgment, read evidence and freshness stay
distinct. The publisher never reduces lifecycle events or acknowledges notices.

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

## Run against an installed hub

The Linux Node 24 runner is `node controllers/tidbyt/dist/cli.js /absolute/private/tidbyt-status.json` from a built release root. It opens no listener and polls the existing hub every 30 seconds with a read-only machine credential. It accepts only `http://127.0.0.1:<port>` and the configured owner ID; redirects, wrong-owner responses, invalid snapshots and unavailable reads become stale-feed evidence. All pushes and removals still use the existing controller queue.

Build a pinned reviewed revision in a separate release directory outside your working checkout. Use that revision's `package-lock.json` with `npm ci`, then `npm run build` on Node 24. Keep the release after stopping so its revision and installed bytes remain inspectable. Installing a release does not require restarting the hub or changing provider hooks.

Create a mode-600 JSON file outside Git and outside the release tree, owned by the Linux installation user:

```json
{
  "hubUrl": "http://127.0.0.1:8788",
  "ownerId": "your-configured-hub-owner",
  "tokenFile": "/absolute/private/hub-read-token",
  "credentialsFile": "/absolute/private/tidbyt.env"
}
```

`tokenFile` contains an existing dedicated read-only hub bearer, as 43 base64url characters. The hub's stored digest is not a bearer token. `credentialsFile` uses the Tidbyt fields described above. Both files must also be owner-owned regular files with no group/world permissions. Symlink files, files over 16 KiB and files inside Git checkouts are rejected. File values and session data are never printed. Do not put secrets into the shell command or environment.

Confirm the configured cloud device is the intended physical target and that no other host or process owns its display writes. The runner holds an exclusive lease under `~/.local/state/agent-device-hub/tidbyt/`, keyed by the cloud device rather than installation ID. A second runner for that device under the same Linux user fails before network access. The lease is a separate lock database; it never opens the hub or controller database. Do not delete or replace an active lease file. A crash releases the OS lock automatically; no stale-file deletion is needed.

Run the command once as the installation owner. `tidbyt-status-started` reports process startup, not cloud acceptance or a visible frame. Ctrl+C or SIGTERM stops publishing, cancels queued work, settles the active evaluation and releases the lease. **Stopping leaves the current status installation in rotation.** Starting again evaluates the current feed; when that feed is healthy and idle, the publisher removes the installation through its queue. A stale feed never means idle. To restore the prior setup, stop the runner; the hub, provider hooks and other Tidbyt apps are unchanged. Explicit installation removal is a separate queue operation with its own uncertain/failure outcome.

For the separately authorized display check, record the installed revision, Node/client versions, selected owner and sole-writer confirmation privately. Start one real agent session and hold each state long enough for the 30-second poll and 15-second write gate. Observe `RUN`, `ASK` and `DONE`, whether other apps continue rotating, and the `?`/`FEED ?` state during a controlled feed interruption. Interrupt only this consumer's feed for the stale test; do not stop the shared state owner or change other consumers. Record shutdown behavior. Existing sessions retain their normal priority, so an old attention row can precede the test session. Do not acknowledge unrelated notices merely to make the test visible.

The user's visual confirmation closes the installation issue. Source tests, a running process and cloud transport receipts do not establish display correctness or real-client attention coverage. Missing provider signals remain an acceptance gap.
