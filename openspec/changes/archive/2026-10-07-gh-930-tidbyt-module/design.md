## Context

Sources read at pickup on 2026-10-07, main `627e3fe3`, then rebased onto `df7854b7` (#928, the LIFX module): the issue
and its hand-offs from #918 (paint through `highestStatus` or `sessionState` with no acknowledging consumers; build the
copy from the SDK copy's states; publish `device/2.0` with a unique routing ID, `lastTransmission` on every transmitted
send and `pendingKinds` in step with `pending`) and #919 (module API 1.1, `configure`, `secrets.read` in start,
`files()`, `workers.call`, the kit's opt-in `offline` check); [ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md)
"Failure isolation", "Errors, effects and outcomes" and "Observability"; the controller's README, sources and tests;
the playback module's record ("Judge freshness by `availability`"); the LIFX module's lease, conversion and kit spec;
MAPPING.md's controller snapshot and agent status rows; and PR #970 (#967), which makes sync owner-addressed. The issue
stays aligned; the adjustments below are routine and within its scope.

## Goals / Non-Goals

**Goals:**
- Keep the runner's layout, cadence and protections on 2.0 records, with the same golden bytes.
- One writer for the cloud device; the 15-second gate holds under bursts and across restarts.
- The cloud's errors and timeouts as device state and records, with one degradation and one recovery per outage.
- The conversion of the runner's configuration, keeping both installation IDs.

**Non-Goals:**
- Tronbyt (#23, #24), the page showing the last frame (#363), the installer itself (#935), owner-addressed sync (#967),
  and removing the controller and its Pillow check (#839).

## Decisions

- **The controller v1 envelope is not copied.** Its tickets, admission, replays and conflicts served the Hub's submit
  path; in 2.0 no message carries a frame and only the module's tiles write. The queue keeps order, one call in flight
  and the two holds. Alternative rejected: keeping a private envelope inside the module, which nothing outside would use.
- **The transport is `fetch`.** The simulated cloud answers the real API's calls with its status codes, so the module's
  own classification runs in tests and runs. The connection's timeout becomes the caller's signal on the runtime's
  scheduler, so a manual clock drives it and a stop ends it.
- **Availability follows whether the cloud answered.** A lost answer or a refused connection makes the Tidbyt
  `unavailable`; a server error, a refused request or a rate limit makes it `degraded`; an accepted write or a listing
  makes it `available`. The runner's service health counted a timed-out push as degraded; policy A reports a device that
  does not answer as unavailable.
- **The gate runs from the send.** The runner's gate ran from the submission, and the frame rendered synchronously. A
  render in a worker thread and a wait in the queue now sit between the decision and the request, so the gate starts when
  each request goes out; otherwise two pushes could reach the cloud less than 15 s apart (the scenario showed 14.95 s).
  The start's listing still counts against the gate, as the runner's did.
- **Hold until the shown state is known.** The status tile waits for the first sync of the sessions to settle; a refused
  sync shows `FEED ?`, as the runner's failed read did. The now-playing tile waits until its copy first syncs, for at most
  30 s, so a playback module that starts a moment later never removes a playing card.
- **A lost copy stands in for a failed read.** With 2.0 the module cannot judge age from `observedAtMs`; a copy that stops
  following dims the card and removes it 30 s after the loss, as the runner removed a card 30 s after its last good read.
- **Tile memory survives a restart.** What a tile sent, when, and the installation's presence are kept in the module's
  database, so a restart writes nothing while the tile stands and the gate holds across it, as the LIFX module keeps its
  shown key. A lost commit only costs one more push after a restart.
- **The neutral label keeps the 1.x hash.** The 2.0 entity ID hashes the identity as an object; the tile keeps the 1.x
  array hash so an unlabelled session shows the same `C-` or `X-` ID before and after the cutover, and the golden bytes
  stay the same.
- **The key is the secret `token`.** It matches the configuration writers' convention (#919) and the catalog's seeds. The
  cloud's device ID is configuration, private in the configuration file.
- **Commands are refused, not unanswered.** The runner refused every controller v1 command with
  `unsupported-capability`; the module answers each general command family the same way, rather than leaving the bus to
  answer `unavailable`.
- **`sharp` decodes the goldens.** It bundles its own libwebp build, independent of the module's encoder, and is already
  locked for Pixoo. The simulated cloud's text pictures use the module's own subset decoder, which is a convenience for
  people and scenarios, not a check of the encoder.
- **Sync of `device` from a shared family.** The module serves `device` as the issue asks, beside the LIFX module, through
  owner-addressed sync (#967, PR #970, merged as `ff4677f3` during the review and rebased onto); the module tests and the
  catalog's reader name `bunny/modules/tidbyt` as the owner.

## Risks / Trade-offs

- [An authentication hold lasts until the runtime restarts] → As the runner's lasted until it was reconfigured; one record
  names it, and the device shows `unavailable`.
- [A worker thread per render] → At most two renders run, one per tile, and each takes milliseconds; a stop ends them.
