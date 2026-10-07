## Context

[Hub #843](https://github.com/jimmie-potts/agent-device-hub/issues/843) is slice A of the Pixoo move: the module. The pages are #932 and the library migration is #931. Sources read at pickup on 2026-10-07, main `483d3a9`, rebased onto `a8e8bb0`:
- the issue and its hand-offs from #25 (three dropped cases, the `@pixoo/` scope, 59 baselined findings), #918 (device families, routing-ID device IDs, `notice-acknowledge`) and #919 (module API 1.1, the kit's opt-in `offline`);
- [ADR 0012](../../../docs/decisions/0012-bunny-event-platform.md) "Failure isolation", "Errors, effects and outcomes" and "Observability", as amended on 2026-10-07;
- the SDK's module API, outbox and kit;
- the runtime's host, catalog and verification runs;
- `modules/pixoo/README.md`;
- divoom-app-upgrade at `0777479`, for `ControlService`, the server's wiring and its settings files.

The safe-error rules from #953 (PR #963) arrived during the work and now cover the module.

## Goals / Non-Goals

**Goals:**
- The Pixoo as a runtime module that owns its device writer, library and presentation, with module API 1.1.
- Monitor and Now Playing from synced 2.0 records, with no stored copy.
- Every command refused before acting or accepted with a tracked outcome, never sent twice.
- Policy A: start never waits on the device; device errors become outcomes and `unavailable`.
- The imported code under the strict profile, with its behavior kept.

**Non-Goals:**
- The Pixoo pages and their HTTP routes (#932, module API 1.2 from #835), the library migration (#931), remote access (#936) and installation (#840).
- New SDK calls: `packages/sdk/src/module.ts` has one writer, #835.
- A new deletion path in the library.

## Decisions

- **One package, not a wider boundary rule.** The six `@pixoo/*` packages become `@jimmie-potts/pixoo` with relative imports. Keeping them as packages would need the boundary rule to treat a module's own workspace packages as its files, which weakens the rule for every module. The `@pixoo/` scope leaves `workspaceScopes`, and `staged` is empty.
- **Moved tests keep Vitest, from the build.** Converting 300 Vitest cases to node:test would rewrite tests the move promised to keep. The tests now compile with the module, under the strict profile, and Vitest runs `dist/tests`, so the media child process and the render worker resolve beside the compiled code. The module's own tests use node:test, as the kit's `moduleConformance` does. `test:pixoo:built` runs both.
- **The library lives in the module's database.** `Library.attach` opens the catalog in the database the runtime gives the module, beside the outbox and the module's own `pixoo_*` tables, with media in `files()/media`. Its migrations ignore `bunny_` and `pixoo_` tables. The runtime owns the database, so the library takes no owner lock and never closes it. It keeps the runtime's journal mode rather than WAL. The schema is unchanged, so #931 can migrate the installed catalog.
- **Outcome evidence for the module's own state** (decision, flagged for review). A succeeded outcome needs `transmitted` or `observed` evidence. Pause, stop and clear, the presentation and Now Playing settings, playlist and media changes, and a dismissal change only state the module owns and has committed. They complete `succeeded` with `observed`: the module's state at its new revision, published in the same transaction, is the observation, as the core's acknowledgment is. A device write completes `transmitted` once the Pixoo answers, because its answer is a transport acknowledgment; a start, a show, a resume, next and previous complete with their first upload.
- **Accepted means stored.** Admission validates the command, checks guards and capabilities, then stores the module's record of the work (`pixoo_commands`) before it replies. The work runs outside the responder, so a later stop or pause can cancel a pending start, as ControlService allowed. The outcome commits with the device's new pending count and last outcome in one outbox transaction. At the next start, each stored command without an outcome is reported `uncertain` with `uncertain-result` and never run again. A repeated `(source, requestId)` is accepted again and changes nothing, for 24 hours.
- **An upload is its command's by async context.** `PixooControl` runs each playback command's action under its own `AsyncLocalStorage` token, as ControlService did, so the first media operation the action launches is that command's. This holds whatever other commands do meanwhile, and the outcome is that upload's result.
- **The display and the catalog are served state.** `pixoo-display` holds the presentation, Now Playing and player status, which #932's pages need. `pixoo-rendition` and `pixoo-playlist` hold one record per catalog entry, with removals. One revision counter, stored, raises every served record; a change that alters nothing publishes nothing. The device's capabilities list at most 256 playlists and renditions, as `device/2.0` allows, so `media-start` refuses a playlist beyond the first 256 as `unsupported-capability`.
- **A shared device family.** Every device module serves #918's `device` family for its own devices, which owner-addressed sync allows (#967, merged as #970). The Pixoo serves `device` with its own families, and its readers name `bunny/modules/pixoo` as the owner.
- **Availability through the player's probe.** The module probes on the runtime's scheduler with a 2 s deadline, every 30 s while the device answers and after a doubling wait from 1 s while it does not. The player's own probe updates its availability and observed brightness and screen. `DeviceAvailability` logs the first failure and the recovery. The Pixoo service never polled; one probe every 30 s is the cost of an honest `unavailable`.
- **Quiet waits for a late owner.** A playback owner that starts after the Pixoo, or is not shipped, is no fault at first. Attempts log at DEBUG, and one warning follows once the wait has grown to its longest (60 s). A copy that followed its owner and then lost it warns at once.
- **Rendering in worker calls, decoding in a child process.** Dashboards and cards render through `workers.call`; a failed render keeps the last picture, is retried, and is one warning per run of failures. Media decoding keeps its forked child, because a native crash or heap exhaustion in a worker thread would stop the runtime. The child no longer writes its own diagnostic record; the module records each job's result.
- **Safe errors.** A busy library lock is told by SQLite's code, not its message. An image over the pixel limit is told by its declared size, read from its header before decoding, because sharp names the limit only in its message.
- **The presentation reads 2.0 records.** `MonitorSession` is a `session/2.0` record with its label as text. The collector mark shows running while the copy holds a snapshot, because the core served it. `ended` stays drawable for the synthetic previews, so their frames are unchanged. The Now Playing card follows the record's `availability` and the copy's state, not the age of its observation: the playback module publishes only changes and marks a silent speaker's record `stale` itself (#929), so a song that plays on unchanged keeps a current card. A whole takeover also starts on a tick, so a song already playing when Media starts takes the display over.
- **Simulator startup stays passive.** As in the Pixoo service, a real device's start restores a saved Monitor selection, and a simulated Pixoo's does not. The simulated Pixoo answers at once, refuses to connect, or never answers (`silent`). It keeps what it shows across restarts in the in-memory harness; a disposable run's child holds it and reports its state to the supervisor, which starts each new child in the last mode.
- **Configuration.** The section names `device` (routing ID, private IPv4 address, profile, optional label, model and firmware), `hostedGif` (needed for the hosted profile on a real device), the starting `presentation` and `nowPlaying` settings, and `playback`. The Pixoo's API takes no token, so the module reads no secret its section names. `convertPixooSettings` keeps the Hub's device ID `pixoo-local` by default and checks its result with `configurePixoo`.
- **The catalog after the start, frames checked once.** The start reads no catalog: a whole-library read, with a hosted check of every multi-frame rendition's frames, made a start with 32 hosted 500-frame renditions miss the 10 s deadline and every catalog command take 11 s. The first read follows the start, reads no frames and is served through sync at the current revision, since a sync of the catalog's families waits for it; publishing it instead cost one SDK outbox commit per record and stalled commands for seconds. Each rendition's hosted check reads its frames once and is kept in `pixoo_hosted_checks`, which the library's playlist starts use too.
- **Commits.** A command's acceptance commits in the transaction that publishes its pending count, and a change during its work waits up to 1 s for its completion's commit. What the module serves and its last transmission change only after a commit. The SDK outbox's one commit per published row stays shared SDK code.

## Risks / Trade-offs

- **Outcomes grow until the core acknowledges them** (#782). Tests use the kit's stand-in acknowledgment.
- **The library migration may meet schema v3** (#931). Attaching an older catalog runs the same migrations; #931 owns verifying the installed revision.
- **Observed for module-local effects** might be read as a device observation. The module README and this design state the rule, and it is listed for review.
- **Card renders can briefly lag.** A card shows once its worker call answers. A changed card keeps the card already shown until then; a first pop-up over Monitor keeps the dashboard until its card is ready.
