## Context

ADR 0012 names the owner as the target of a sync, and Hub #918 made `device/2.0` a family that every device module serves for its own devices. The SDK's in-process registry refused a second owner of a family, so two device modules could not run together. Three choices needed a design: where the owner travels, what a copy does with another owner's live messages, and what a sync that names no owner does when several serve the family.

## Goals / Non-Goals

**Goals:**
- Two or more modules serve one family at once, each for its own entities, on both transports.
- A consumer syncs each owner by name and gets only that owner's records, live ones included.
- Every existing single-owner call behaves as before.

**Non-Goals:**
- A fan-out sync that merges several owners into one copy or revision (deferred by #967: consumers sync each owner, which keeps recovery per owner).
- Per-grant edge permissions that name owners ([#835](https://github.com/jimmie-potts/agent-device-hub/issues/835)); it treats the owner as part of the call.
- An owner attribute on the `sync.served` and `sync.refused` records, which would need a diagnostic-catalog change.

## Decisions

- **The owner travels beside the request, not in it.** `OutgoingSync.owner` carries it to the transport; the in-process bus routes with it, and the remote client sends it in the `sync` call's body beside `request`, which the edge passes to `InProcessBus.syncMessage`. This mirrors a command, whose routing key travels beside the message. The `sync-request` payload schema is closed (`additionalProperties: false`), so carrying the owner in the message would change the event contracts, and the envelope admits no new attribute. Rejected: an `owner` field in the payload, and putting the owner in the event subject, which already names the families.
- **A named copy follows only its owner's live messages.** The copy subscribes to `bunny.state.<family>.*`, which every owner of the family publishes on. Before buffering, a copy that names an owner drops a message whose `source` is another participant's. The drop is silent: such a message is valid traffic, not a fault, so it is not reported to `onError`, and it never counts against `maxBuffered`, so another owner's traffic cannot restart this copy's sync. A dropped message on the shared subscription queue still restarts the sync, as any gap does. A copy that names no owner follows every message on its families, as before. Rejected: filtering by subscription, which the SDK's routing keys cannot express, and also pinning a copy without an owner to whoever answered, which would change existing behavior.
- **No owner and several owners is `invalid-request`.** The requester must choose; spreading the request would merge revisions and membership that belong to different owners. The refusal is a domain refusal at INFO, and its detail says to name the owner. Checks run in the old order: a family no candidate serves is `unavailable` first, then a family with several owners, then families split across registrations. A named owner restricts the candidates to its source, so a family it does not serve is `unavailable` ("no owner serves device as bunny/modules/x").
- **One sync still covers one registration.** A source may serve families through several `serveSync` calls, but one answer has one revision, so a request whose families span two registrations stays `invalid-request` with "one sync covers one owner's families".
- **The kit names the module.** The serves and lifecycle checks sync the module's families with `owner` set to the module's source, as a consumer of a shared family must. `copies.owner` lets the stand-in serve as the owner a module names; with it, the copies check fails a module that syncs those families without naming that owner, because in the runtime that sync is refused once a second owner serves them.
- **Fixture devices.** The runtime's fixture lamp and sign serve their own devices' `device/2.0` records from the same `serveSync` as their own family, filtering by the requested families, as the LIFX module does. The lamp's record says only that it is a lamp, with every capability unsupported. The sign's mirrors its availability, and the sign publishes it beside the sign's own state when that changes. No existing scenario follows `device`, so no existing expectation changes.

## Boundaries and outcomes

- **Entry points and hand-offs.** `Sdk.sync(..., {owner})` in process and through `connectRemote`; the edge's `sync` call; `InProcessBus.syncMessage(..., owner)`. Owners keep `serveSync(families, provider)` unchanged.
- **Refusals and outcomes.** A sync only reads, so it has no succeeded, failed or uncertain outcome and no effect: it is served, or refused before any provider runs with the shared error body from `errorBody`, naming its `requestId` and trace ID, and no `sync.completed`. New refusals: `invalid-request` (several owners and none named; a malformed owner, thrown as `SdkError` before anything is sent or refused at the edge) and `unavailable` (the named owner does not serve a family). `invalid-state` now applies per source.
- **Codes and retries.** Registry codes only, with their fixed flags: `unavailable` is retryable, as a named owner may start later; `invalid-request` and `invalid-state` are not. Nothing retries a refused sync; a copy's own resync after an overflow keeps its owner.
- **Diagnostic records and trace continuity.** The bus records each sync request's one answer once, as before: `sync.served` at INFO, `sync.refused` at the code's level (INFO for `invalid-request`, WARN for `unavailable`), with the request's trace. The edge records a malformed owner once as `edge.refused` with its code and no detail. The pattern stays `sync <families>`, so the record does not name the owner; the request ID and trace lead to it.
- **Fault cases.** Another owner's removal or state of an entity on a shared family changes no named copy; another owner's traffic cannot overflow a named copy's buffer; an owner that closes leaves a family with one owner, which a sync without an owner reaches again.

## Risks / Trade-offs

- [A consumer that names no owner breaks once a second module serves its family] → The refusal says to name the owner, the kit's `copies.owner` check catches a module that does not, and the SDK README documents the call shape that device modules adopt.
- [A shared subscription carries every owner's traffic to every copy] → Named copies drop other owners' messages before buffering; a queue overflow still resyncs, which is safe.
- [The sync records do not name the owner] → Follow the request ID or trace; an owner attribute needs a catalog change and is left out.
