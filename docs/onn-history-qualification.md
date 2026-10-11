# ONN title-history qualification

This record selects the observation contract for one configured ONN. It does
not install a collector or claim installed acceptance. GitHub
[#1038](https://github.com/jimmie-potts/agent-device-hub/issues/1038) owns the
qualification outcome; the issues own delivery sequence and status. Original
observations, approvals and recovery evidence remain private.

## Selected source and evidence

The owner approved a fixed read-only Java/Dex MediaSession reader invoked
through the existing private ADB connection. It runs once, returns selected
metadata and exits. TypeScript in `modules/onn` owns scheduling, private storage,
state, authenticated queries and React views. This is the scoped native
exception in [ADR 0012](decisions/0012-bunny-event-platform.md). There is no APK,
resident Android service, new permission or Google account connection.

The observed setup matches the [controls qualification](onn-controls-qualification.md):
ONN 4K Pro, Android TV OS 14, standard YouTube `7.25.302` and standard Stremio
`1.11.2`, using the owner's usual EXO player. Refresh those inputs when changed.

| Capability | Qualification conclusion |
| --- | --- |
| YouTube selected title and channel | Two different selected titles/channels matched the owner's observation. Collect these fields; call the record **selected title observed**. |
| Stremio movie and episode context | A movie and two different episodes of the same series matched the owner's observation. Preserve the available series/episode strings rather than replacing them with foreground-app usage. |
| Reported playback and progress | Playing/paused state, position and duration were available; resume, content change and browsing exit were observed. These are source reports, not watched-time measurements. |
| Exit and gaps | Browsing exit returned no selected media session. Clear the current content; retain historical observations. Failed, stale or missing reads remain explicit gaps. |
| Stable IDs, numeric season/episode and genre | Not qualified as consistently available. Preserve supported values when present; expose unknowns and identity ambiguity. Do not infer missing fields. |
| YouTube main-video viewing or ad classification | Not qualified. An ad exposed the selected main-video identity with ad timing. Missing markers, a short duration or a title match do not distinguish an ad from the main video. |

The owner confirmed that the qualification reads left screen, focus and playback
unchanged and that the physical remote remained usable. This establishes the
tested source route, not the production reader's installation or privacy rules.
The production implementation must validate its own source and transport.

The owner accepted delivery of title observations and reported progress while
deferring watched-time intervals, daily/weekly watched-minute totals, time-total
charts, estimated completion, ad classification and automatic Skip. Those
features require new source evidence and explicit reselection. Topic inference
and native assistant recommendations remain deferred; retain available metadata
without assigning inferred politics/AI categories. Google TV-code/Lounge
research remains unselected and is not a release dependency. No further ad,
screen-capture or OCR qualification is required for this release.

## Reader boundary

Read only MediaSessions belonging to `com.google.android.youtube.tv` and
`com.stremio.one`. Inspect at most 32 controller package identities and return
at most eight selected sessions. Read fixed fields through MediaController;
never enumerate arbitrary bundles, URI keys, logs, notifications or screen
content. Refuse unsupported arguments. The reader has no input, launch, playback,
permission or settings action.

Use a versioned closed JSON reply, `onn-metadata/2.0`, containing:

- `deviceElapsedMs`: a nonnegative safe integer from the device elapsed clock.
- `sessions`: selected sessions with `app` (`youtube` or `stremio`), nullable
  `metadata`, nullable `playback`, and declared `omissions`.
- Metadata: nullable `title`, `displayTitle`, `subtitle`, `artist`, `album`,
  `genre`, `description`, `mediaId` and nonnegative `durationMs`.
- Playback: source `state`, `positionMs` (including `-1` for unknown), finite
  `speed` and `positionUpdatedElapsedMs`. Position-update time is not a
  playback-transition time.
- Omissions: a fixed field name and `credential-redacted` or `oversized`,
  without the omitted secret. Null source fields remain distinct from omissions.

Limit a selected string to 8,192 UTF-8 bytes and a reply, including its newline,
to 256 KiB of UTF-8. Overlong fields become explicit omissions; an oversized reply, invalid
number, excess session count or unsupported source shape is an unavailable
sample, never a truncated successful archive entry. Document these finite
limits as collection loss. Preserve valid Unicode and ordinary personal text.

Keep process startup output separate from selected JSON. A fixed invocation
opens a dedicated result descriptor and discards unrelated stdout/stderr.
Errors use fixed safe codes without exception messages or stacks. The module
validates the closed shape, numeric and size bounds again. Clients cannot supply
code, a shell string, a device address or a reader path.

Build and pin the reader artifact, source version and SHA-256 with the module
release. A separately approved setup deploys the exact owned artifact; polling
never installs, repairs, replaces or discovers a helper. An absent or mismatched
artifact reports unavailable. Preserve another owner's device files and ADB
server. Use the existing qualified socket adapter and one operation-wide abort
signal, with a five-second bound and no automatic retry or protocol fallback.

## Collection and retention

Collection is explicitly enabled in private ONN configuration and starts at
activation. The initial scheduler period is five seconds; observations become
stale after 15 seconds. These are production bounds to validate, not a promise
that every between-poll transition is seen. Serialize reads with the module's
device work, prioritize controls and record skipped/busy polls as gaps. Module
startup and ordinary controls must not wait for successful metadata collection.

Use the existing `ModuleContext.database()` lease and private module files;
add no database owner, service or infrastructure. Each intake identifies the
collector run/poll, host receive time, source/reader/app provenance, available
device and position-update times, selected fields and omissions. Persist the
credential-excluded original projection before acknowledging durable intake.
Repeated observations are retained; retrying the same intake ID is idempotent.

Retain accepted originals and observed revisions indefinitely, according to
[ADR 0011](decisions/0011-private-personal-data-retention.md). Rebuilding views,
advancing age or restarting cannot erase them. Credentials remain excluded
before storage and diagnostics. Redact recognized bearer tokens, password/token
assignments and authentication-bearing URL components narrowly; preserve the
surrounding title, ordinary URL and personal text. Document detection limits;
do not claim arbitrary prose is secret-free or drop every URL as a precaution.

Storage failure or capacity pressure exposes loss, refuses durable acceptance
and preserves earlier originals. It cannot block ordinary playback or fabricate
success. Recovery reads stored data and issues no device command. Preserve
explicit startup, source, clock, busy-poll and storage gaps. Wall-clock jumps,
device clock resets and runtime restarts never fabricate intervening samples.

## Current content and observation records

Keep the latest content projection, immutable originals, observation occurrences
and command history distinct. An occurrence is a local group of observed
metadata, with references to its originals and identity confidence. Use a stable
source ID when available. A title alone cannot prove two items are identical;
an unsupported or ambiguous identity remains explicit. No observation establishes
viewer attention or exact viewing start/end.

Current content distinguishes fresh, stale, unavailable and collecting with
gaps. An accepted empty session list clears current content. Ambiguous multiple
sessions cannot become a single confidently current title. The previous title
may remain in history, but cannot remain labelled currently playing after exit
or a content change. Report last observed position, duration and playback state
as source values; do not extrapolate progress or derive completion/watch time.

## Shared bounded reads

The ONN content contribution and MCP tools call the same stored-data query
service through the existing authenticated gateway. Reads issue no ADB operation,
command, model call or account import. Keep existing `onn_status` and control
dispatch. Add local tools `history` and `history_detail`, published through the
existing namespace as `onn_history` and `onn_history_detail`.

| Read | Minimum result |
| --- | --- |
| History | App/date/title filters, default 50 and maximum 100 summaries per page, local occurrence IDs, supported metadata, last reported progress, provenance, identity confidence and coverage/gaps. |
| Detail | One local occurrence, supported fields and paged contributing observations with their source values, timestamps, omissions and gaps. No arbitrary path or vendor URL lookup. |

Use a stable evidence cutoff and deterministic cursor order so new collection
does not change an existing page. Bound detail pages too. Validate closed inputs
and return the shared ErrorBody codes for invalid filters/cursors, unavailable
query state and capacity. Enforce an output-byte bound, with explicit field/page
omissions while preserving the private originals. Use indexed app/evidence ordering
and bounded date/title candidate filtering; do not scan the indefinite archive.
Order by evidence sequence so host-clock changes cannot reorder a cutoff page;
date filters use each observation's explicit host receive time. Return a continuation cursor even when a bounded search window finds
no match. A gateway response timeout is not SQLite cancellation.

The module-owned React page uses shared connection/authentication components.
Show current content, app/date/title filters, pagination and details. It must
answer which titles were observed last night and which episode was last observed,
with visible limits and unknowns. Date filters use explicit time boundaries;
local formatting cannot invent duration totals. There is no watched-minutes
summary tool, totals chart, completion estimate or recommendation placeholder.

## Remaining acceptance

Production checks must cover both-app extraction, malformed and ambiguous
samples, secrets versus ordinary text, bounds, durable intake/idempotence,
same-title ambiguity, content change/exit, pause/seek reports, gaps/clock changes,
restart retention, storage faults and bounded read-only API/MCP queries. Browser
checks cover keyboard, mobile/desktop, empty/error/reconnect states and
accessibility. Independent frozen-comparison reviews and applicable CI remain
required.

After source delivery, one separately approved installed walkthrough can verify
both apps' controls, titles, reported progress, content changes and exit, physical
remote coexistence, retained data across restart/reconnect, and matching dashboard
and real MCP-client reads. Reuse prior movie/episode qualification rather than
repeat a metadata-source matrix. Use the current runtime's qualified upgrade
procedure and verify receipt, running revision and health. Source, installed
client and owner-observed physical evidence stay separate.
