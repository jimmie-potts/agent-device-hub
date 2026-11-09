## Context

The schedule (`apps/runtime/src/core/art-schedule.ts`) is the only caller of `createArtPlans().present` in production. `present` already owns preparation through the art-stage forwarding, the fixed common start, one `moment-play/2.1` with the exact composition per display, the browser present, per-surface tracking and the preparation cutoff, and it takes a permit from its caller for policy. The core admits the Hub's own commands (`mode-set`) through the tracker's dispatcher admission: the gateway dispatches, the tracker records an admission keyed by request ID, and the responder binds and completes it.

## Goals / Non-Goals

**Goals:**
- One explicit owner path from a saved artwork to tracked appearances on chosen surfaces within about 20 seconds.
- The same command from the gallery and from MCP, with registry refusals and per-surface evidence.
- No effect on the schedule's policy, claims, count, spacing or next appearance.

**Non-Goals:**
- Generation as part of a show, per-show durations or labels, routine or event-rule actions that show art, and any device mode change. Pixoo admission changes belong to #1574.

## Decisions

- **Command and admission.** `art-show/2.0` is a core command on subject `hub`, dispatched as an ordinary tracked action from any caller with control scope. The tracker records a dispatcher admission for it, as for `mode-set`, so only a dispatched command can be answered; a direct bus command is `forbidden`. Its deadline class is `moment` (150 s): the outcome follows the start 20 s ahead, which the device class's 30 s would nearly exhaust.
- **Responder lifecycle.** The responder validates, checks the artwork and targets against the art owner's published record and the configured art targets, takes the one show slot and replies `accepted`. A background task runs `present`, appends evidence and completes the admitted operation in a core transaction (`tx.take` plus `completeCore`), then ends the admission. A restart in between leaves the operation to its deadline, `uncertain`; nothing replays, since the art plan identity derives from the request ID and the tracker refuses a reused request ID.
- **Owner permit.** The permit refuses only when the core is stopping or attention is raised. Quiet hours, the global budget, device spacing, `noFlourishes` and the schedule's enabled targets and browser flag do not apply. Holds, availability, external control, capabilities and preparation are checked by `present`; pins, Now Playing and paused items by each display's own admission.
- **Plan.** Start now + 20 s, preparation cutoff start − 1 s, tolerance 5 s (the schedule's), mood `celebrate`, `priorityClass` `event`, `coversStatus` from the request (default true), Pixoo 10 s, Tidbyt 30 s. Plan ID `art-show-<sha256(["art-show", requestId])>`.
- **Evidence.** The automation log is the shared, private, bounded attempt record the Automation page already shows as Recent attempts. Each surface becomes one row: rule `art-show`, event source `owner`, event ID the show's request ID, the moment or browser request ID when tracked, `blocked` for a target refused before planning, `not-sent` for a surface the plan did not hand off, and `receipt` when tracked. `priorityClass` `event` keeps the rows out of every flourish budget and spacing query. Alternative considered: an `origin` on the art-schedule record's attempts, as the issue proposed. It needs a state schema minor, a stored record change and arbitration between owner shows and the schedule's single latest attempt; rejected for this slice.
- **Identity for consumers.** `@jimmie-potts/event-contracts/v2/art-show` derives the plan ID and each surface's request IDs with WebCrypto, so the gallery and the MCP tool name the same operations the core tracks without a new state family.
- **Saved art source.** The core reads the art owner's published record. Its art input previously followed the record only while the schedule was enabled; the first owner show now pins that copy for the core's lifetime and waits up to 3 s for it.

## Risks / Trade-offs

- Only the 24 artworks in the published record can be shown; the gallery says so for older pages. A later read of the private catalog could lift it.
- The show slot is in memory; a second show while one prepares is `capacity`, and a restart frees it while the first's operations end `uncertain`.
- An attention raise between preparation and the start still refuses the unsent surfaces, which is the schedule's behavior too.
