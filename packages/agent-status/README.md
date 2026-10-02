# Shared agent status

This private workspace provides status projection, bounded snapshot reads and
evaluation scheduling for LIFX and Tidbyt. Each controller retains its own queue,
mode, rendering and write policy.

`HubStatusFeed` reads the selected owner's loopback monitor route with a dedicated
read token. Snapshots keep the 2.5-second network deadline, 1 MiB bound and optional
snapshot 1.2 selection. An optional `AbortSignal` cancels a read. Existing feeds
with a zero-argument `snapshot()` remain compatible.

`subscribe()` lazily opens the existing `/api/monitor/v1/changes` SSE route. It
validates the API version, owner, current connection and bounded projection;
state/resync records request current-state evaluation. Comment heartbeats do not.
The parser accepts incrementally split UTF-8 and LF/CRLF/CR lines. Each frame is
at most 8 KiB, each chunk 64 KiB and each connection 1 MiB. Reaching a limit ends
the connection. Headers have a 2.5-second deadline and complete frames must arrive
within ten seconds. Failures reconnect after one second, doubling to 30 seconds;
a valid notice resets the delay. Reconnection sends no cursor and receives the
server's resync. Redirects are rejected and the bearer never moves to another
origin. Diagnostics do not include credentials or frame content.

A subscription has one consumer and one replaceable pending hint. No historical
record is a device command. `close()`/iterator return aborts the request, cancels
the reader, settles the pending iterator read and removes reconnect/deadline
timers. Native fetch enforces cancellation; injected transports are test seams
and must honor AbortSignal. There is no complete-history or physical-latency claim.

Both status publishers use `FeedListener` and one `EvaluationLoop`. Notifications
start an idle evaluation immediately; requests while it runs coalesce to one
rerun. A separate 30-second recovery timer cannot be postponed by notices. If an
evaluation is still running when it fires, that poll joins the single pending
rerun. Device cadence timers remain separate. Stop cancels the read wait and
stream, prevents late submissions, and preserves receipts for admitted writes.
A custom feed that ignores cancellation can retain its own pending operation;
the stopped publisher launches no replacement or write.

Run `npm run test:agent-status`, `npm run test:lifx`, `npm run test:tidbyt` and
`npm run test:local-controllers` from the root on Node 24. Fake-clock tests measure
evaluation starts separately from snapshot completion and writes. Installation,
cloud delay and visible device acceptance require their own evidence.
