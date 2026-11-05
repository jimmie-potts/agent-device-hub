## Context

See proposal.md for the motivation. The baseline is the current TypeScript runtime, not the legacy Hub automation routes named in the issue's historical assessment. `AutomationPart` already owns current device copies, session attention, `AutomationStore`, tracked dispatch, quiet hours and moment budgets. `power-schedules.ts` supplies the existing host-local, future-only scheduling pattern. `LivePublication` prevents replayed core occurrences from acquiring effect authority. No second scheduler service, installation or device writer is needed.

The coordinated shared-art interface is `art.targets()` for configured display IDs/kinds and `art.present(plan, permit)`. Reconcile its final implementation before product work. Its required synchronous permit checks caller policy immediately before each dispatch. Preparation, browser selection and moment results remain separate. The Art owner retains originals, compositions, provider accounting and ambient selection. Gallery browsing has its own local manual selection; Home layout pinning is placement, not evidence of a physical display pin.

Weather publishes a closed `weather-state/2.0` record. `current` is an hourly forecast, not a measurement; `likely` distinguishes a likely condition from a chance. Freshness ends at `staleAtMs`. `promptWords()` also includes a temperature, so it cannot be copied wholesale to an art prompt. No shipped calendar producer or calendar source grant exists. Art provenance is deliberately `factual: false`.

This design is required by the schema: it crosses state owners and versioned messages, adds private durable claims, and changes arbitration and visible presentation. ADR 0012 owns command/error/outcome semantics; ADR 0011 and the diagnostic contract own private evidence. No retained controller 1.x contract changes.

## Goals / Non-Goals

**Goals:** keep opportunity selection, paid creation, free preparation, browser selection, display transmission and physical observation separate. Fit bounded art policy into the current automation owner and expose it through the existing Automation workspace. Make every suppression and uncertain result inspectable without turning admission into success.

**Non-Goals:** a cron platform, timezone service, calendar connector, arbitrary event-ingestion API, generic notification payload, new personal source, automatic device mode changes, wallpaper/occupancy features, or inferred task completion. No provider text becomes an operational fact. Source delivery does not install or contact a display.

## Decisions

### One art policy beside existing automation settings

Add `ArtSchedule` under `AutomationPart`, with a focused `art-schedule.ts` helper and synchronous private store operations. Keep legacy event rules, routines and `AutomationSettings` payloads unchanged. A separate small `/api/v2/automation/art` branch in `automation-routes.ts` uses the same read/control scopes, `bunny-request:1`, Origin checks, bounded JSON and post-body authorization. Do not add a page or a second connection.

The closed policy contains enabled, host-local waking start/end, appearances, selected configured display IDs and browser participation, ambient enabled, optional generation, weather use and explicit art interrupt permission. Appearance choices are 6, 7 or 8, with 7 the default. A new store seeds a disabled draft once, with suggested 08:00 to 22:00 hours. Enabling is an explicit owner action; installation selects the actual hours. An equal waking start/end is invalid; a crossing-midnight interval belongs to its starting local date. Updates carry the observed policy revision, so two tabs cannot silently overwrite one another. Old event-settings writes cannot erase art policy.

The existing global quiet hours apply even when they use their already-supported explicit zone. Art's waking schedule itself uses only the host local clock. The UI displays that zone. Do not add time zone configuration or location inference.

### Bounded daily opportunities and durable claims

Plan at most eight appearance opportunities for one waking interval, including an early, middle and late window when the interval can fit them. Use an injected bounded choice function to vary times, and persist the chosen instants with that interval's policy revision. Reserve at least 45 elapsed minutes between planned appearances; a short interval produces fewer opportunities and an explanation, not compressed spacing. Quiet hours remove opportunities. The day plan is a bounded operational projection, not retained source history.

Use the runtime scheduler and integer delays. Re-evaluate on relevant owner state, policy changes and scheduled wakeups; no browser timer or Hub polling drives effects. Recompute a future plan after a host-clock jump, local-day change or policy edit while retaining claim watermarks. A repeated local hour cannot duplicate a claimed slot; a missing local time is skipped. Restart skips every due/past slot and creates only future opportunities. Do not refill missed daily counts or defer yesterday's gifts.

A durable opportunity ID and request IDs are allocated before any paid or display request. Claims distinguish generation requested, appearance reserved and individual target attempts. Claim and count reservations commit synchronously under the core lease, before effects; no transaction crosses an await. Count a reserved appearance once across its surfaces, including uncertain/lost replies. A crash can lose a gift but cannot authorize a replacement attempt. Keep current interval counters and a last-appearance instant across day boundaries so midnight cannot defeat 45-minute spacing. Share the existing global/device budget accounting with ordinary automation in that same synchronous admission. Using event priority for owner-approved status coverage cannot bypass that accounting. Daily appearance count and provider dollars remain separate limits.

At most one appearance evaluation and one coalesced ambient opportunity wait. A new weather change replaces the pending ambient candidate; it does not enqueue history. Hourly ambient opportunities and live weather changes never request a takeover. A weather change coinciding with an appearance shares that idea rather than doubling generation. Suppressed work may wait only inside its original window; the final start/cutoff never moves once a presentation plan has been admitted.

### Generation is preparation, not permission to show

Choose one artwork and its independently readable compositions, preferring saved favorites/positive feedback and excluding dismissed choices. Use the bounded current Art catalog copy; absence of a usable composition is a per-target limitation, not permission to invent an ID. A deterministic injected selector makes reuse testable and does not treat silence as feedback.

When generation is enabled, one early bounded preparation phase may request one automatic job for an opportunity, through `art-auto`. Save its request ID before sending. Read the producer's job result, not merely the command admission. If new art is unavailable or misses the selection deadline, choose saved art once; if none exists, record a skipped opportunity. A later job may enrich the gallery but cannot resurrect this opportunity. Automatic generation uses a generation-only start; it must not use the old `purpose:ambient` path that can select a tile after asynchronous work without renewed schedule permission.

The Art ledger remains the sole dollar accountant. The scheduler never copies, resets or grants around provider ceilings, daily pace, the automatic loop guard, lost-response reservations or no-retry policy. Saved reuse and local notice treatment call no provider. Pause of generation leaves saved art and the existing ambient tile usable.

### Dispatch through the existing presentation owner

`art.targets()` supplies configured `{target, kind}` identities, including temporarily unavailable owners. Map composition targets to those records; never assume a literal device ID. Call `art.present({id, artworkId, startAtMs, prepareUntilMs, toleranceMs, mood, priorityClass, coversStatus, displays, browser}, permit)`. The permit closure checks the current enabled policy/revision, claimed opportunity, expiry, quiet hours, available budget, active attention and any current owner hold immediately before each dispatch. The shared controller separately checks current configured ownership, fresh SDK membership, capabilities, generation and tracked preparation success.

Use separate durations within each owner's advertised bound (initial defaults: 10 seconds Pixoo, 15 seconds Tidbyt), a fixed start and bounded preparation cutoff. One missing or late device does not delay another. Only the owner's accepted art interrupt policy can set `coversStatus`; no flourish covers status. Store that permission explicitly in the art policy instead of silently broadening the existing generic interrupt set. Device pause/pin/Now Playing/attention admission remains final; empty Pixoo Media is permitted only by its existing exact-art exception. Send no mode command and restore no captured base snapshot.

The result contains `tracked` request IDs or `not-requested` typed errors for each preparation/moment/browser attempt. Join tracked records using target, family and requester before presenting their live outcome. Browser completion means selected reference committed, not decoded or visible. Only the transient ArtPresentation provider supplies decoded-visible evidence. Preserve manual Gallery selection; schedule updates never change its local selection or the Home layout.

### Free ambient selection stays with Art

Extend the current `art-auto/2.1` with a closed `2.2` action for one exact saved Tidbyt composition and configured target. It stages through the existing tracked path and then uses the Art owner's serialized ambient selection/renewal machinery. It never creates a job, calls a provider, writes Pixoo Media or starts a moment. Browser ambient selection uses the existing exact browser selection path; theme follows decoded presentation.

Ambient selection needs a final policy check after staging, not just at command admission. Carry a narrow opportunity authorization reference in a closed `art-dispatch/2.1` ambient alternative; retain the existing 2.0 stage/ambient payloads unchanged. The core resolves the reference only against the current in-memory art opportunity and runs its permit immediately before forwarding the ambient command. Scope this reference to one target, composition and attempt, consume it once, and drop it on stop/restart/policy revocation. It grants no stage, moment or other family. The Art owner retains its own serialized last-issued intent, definite-refusal rollback and uncertain-result semantics. A rejected/revoked final handoff does not replace the preceding issued tile. Do not store a callback, replay a grant or introduce a reusable authorization framework.

### Closed factual notice outside the staged image

Add a rain-forecast notice to `moment-play/2.2`, beside `art`, and advertise support under `device/2.3` as a closed `moments.art.notices` list. These are the next minor versions at the planning baseline; confirm before implementation. Existing schemas remain unchanged and old readers never receive fields from a newer schema. A target without this notice capability is explicitly skipped for a factual appearance; do not silently strip its label and claim the notice showed.

The notice is a closed rain-only object: likely/chance, forecast start/end, observation time, stale time and weather source revision. Source identity is fixed to the qualified weather owner. No arbitrary label, event body, location, title, temperature or provider string crosses this boundary. Use a fresh forecast hour in a bounded approaching window (the next two hours), not the occurrence's words as evidence. Recheck source freshness, hour coverage and opportunity relevance before every factual dispatch. Require notice validity through the display's bounded hold; if it cannot remain valid, skip that factual target.

Each display renders the exact saved image in a dedicated artwork region and a separate fixed high-contrast notice band. It never edits stored bytes or reuses a composition ID for altered bytes. On 64×32, allocate two readable fixed-font lines for forecast/likelihood and the host-local hour, with the remaining area showing a fitted decorative image; on 64×64 use the same meaning at its readable size. Fixed text derives from enums and times. Show "Forecast" and distinguish "Chance" from likely rain. Do not turn an NWS forecast into "rain observed," an official safety alert, or a provider-generated factual scene. Inspect actual pixel fixtures at native size.

The browser renders a separate accessible label and evidence details beside the exact decoded visible artwork. Core `art-schedule/2.0` state supplies the bounded current notice, its opportunity/artwork/composition IDs, expiry and operation references. It owns this derived presentation fact, not a second catalog. The browser shows no notice while identity is unmatched/loading, clears it at expiry/hidden/replacement, and marks unavailable evidence honestly. Generated catalog provenance stays `factual: false`; the notice is explicitly a deterministic forecast annotation.

### Source enablement and private evidence

Only the enabled schedule-weather path opens its SDK copy and live occurrence subscription. Disabling closes them, clears derived opportunity evidence and causes zero subsequent schedule source reads. Do not persist a weather-owner state copy; persist only the core's own claim/result and the fact it used, under private storage. The independently configured weather module and existing Art follower retain their own authority; a schedule toggle is not a claim to stop their separate collection.

Automatic `art-auto/2.2` starts carry explicit current/omit weather-use policy. `omit` makes no job weather read and supplies no weather prompt words. `current` permits only fresh closed condition words, rechecked by Art before every paid call. Do not pass temperature from `promptWords`, forecast labels, notice evidence or personal events into model prompts. Existing owner-request semantics remain unchanged.

No calendar reader is composed until a qualified enabled source is accepted. Unsupported/disabled source state is visible and yields zero reads, zero notices and zero invented celebrations. A turn-ended event is not meeting or success evidence. Synthetic tests can verify refusal of absent/disabled/stale evidence without pretending to qualify a calendar provider.

Use existing operation IDs, fixed error codes and registered diagnostic fields. New policy/notice refusal uses `invalid-state`, `unsupported-capability`, `unavailable`, `expired` before intake, or `cancelled`/the applicable failed outcome after intake; preserve the missed-start classification established by the display owners. Do not publish private labels or collected evidence to GitHub. Reuse private history for retained facts and bounded operational state for current UI; a bounded UI projection is not a new deletion policy.

## Risks / Trade-offs

- [Fewer than the requested daily appearances] → Quiet hours, a short waking interval, unavailable targets and owner control win; expose suppression rather than catching up or compressing spacing.
- [Policy changes while generation or staging waits] → Separate generation from presentation, check permits at each actual dispatch, revoke the narrow ambient grant and keep device-owner checks final.
- [A claimed attempt is lost in a crash] → Count it conservatively and never resend. A later unclaimed window can still be evaluated independently.
- [Factual text overwhelms a tiny panel] → Fixed vocabulary, a dedicated readable band, fitted unchanged artwork and native-size inspection; no generated text or scrolling caption dependency.
- [Minor version differences across consumers] → Old schemas remain exact, new capability gates new payloads, and packaged real-consumer fixtures assert both acceptance and refusal.
- [No calendar producer] → The meeting acceptance decision remains with the owner and coordinator. Do not mark planning implementation-ready until that scope is reconciled; no synthetic fixture substitutes for source delivery.

## Migration Plan

Before product edits, document owning build/type/test/browser/scenario coverage and CI discovery. Reconcile the final accepted shared-art interfaces and display changes into this isolated branch. Add new private art policy/claim tables under the existing lease without rewriting legacy rules, Art originals or device stores. Seed only once; invalid stored art policy refuses scheduled work with a visible failure instead of silently enabling defaults.

Ship schemas and consumers together, retaining all older schema readers. Source checks cover store reopen, old settings compatibility, disabled policy and partial module availability. Installation enables the policy only through the existing authenticated owner path after the selected integrated release is qualified. Disabling stops future scheduling and revokes unsent work; no command replay or snapshot restore is a rollback mechanism. Installed behavior and optical accuracy require the separate deployment owner's evidence.

## Validation approach

- Drive an entire synthetic waking day with injected clock/choice and temporary SQLite. Assert morning/day/evening, 45-minute spacing, quiet windows, crossing midnight, clock jumps, restart and fewer opportunities in a short day. Reopen the same store to prove durable deduplication and conservative counts.
- Hold real consumer preparation and operation outcomes while changing policy, device generation, attention and source freshness. Assert the actual command trace contains no forbidden late dispatch, resend or mode write, and that one slow device does not move another's start. Exercise unknown response and storage-fault branches, not only normal completion.
- Reuse real saved synthetic compositions with provider-call counters at zero. Hold an ambient stage across revocation and restart; assert the one-use authorization is rejected and the previous issued tile survives. Verify omitted weather performs zero schedule/job reads and never enters generated prompts.
- Test both old closed schemas and the additive payload/capability combinations through packaged event-contract consumers. Render chance and likely rain notices at native 64×32/64×64; inspect readability, fixed semantics, unchanged saved hashes, no unlabelled fallback and ordinary art without notices.
- Extend the existing Art/Automation browser checks at 320, 390 and 1440px, light/dark and reduced motion. Exercise keyboard focus, read-only/stale policy, two-tab conflict, lost mutation reply, delayed decode, exact selected identity, notice expiry, Gallery manual choice and unchanged Home geometry.
- Add one finite offline runtime scenario using the shipped synthetic provider and both real display owners' simulated transports. Its marked walkthrough must show schedule enablement, an appearance with mixed per-target evidence, a fresh forecast notice and policy revocation during delayed preparation. Independent acceptance must inspect the full recording, native render fixtures, artifact hashes and cleanup. It makes no installed or optical claim.
- Before implementation, add the coverage and selector routing to `docs/development.md` and CI. Run root build before lint, then typecheck, event/contract/package consumers, Art, weather, runtime, dashboard, Tidbyt and Pixoo owning suites, focused scenario/browser checks and workflow checks. Preserve unrelated failures with their exact evidence. Independent Standards/Specification, focused persistence/device-safety review and disposable acceptance apply to the committed comparison.

## Pending owner decision

The owner has been asked whether the first release can deliver rain notices now and defer meeting notices, or whether a calendar integration is required. This changes acceptance scope, so it is not a deferrable implementation detail. The checkpoint defines the independent scheduling/rain behavior and the required zero-read refusal when no qualified meeting source exists. It does not replace the issue's meeting acceptance criterion with a completed unavailable-only feature. There is deliberately no `tasks.md` until the owner answer and prerequisite acceptance are reconciled by the coordinator.
