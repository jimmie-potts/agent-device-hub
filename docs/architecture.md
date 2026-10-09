# Shared architecture

## Current runtime and evidence

B.U.N.N.Y. uses one TypeScript process under `apps/runtime`, with a fixed shipped
module list, an authoritative core and the SDK's in-process bus. The
[accepted fresh cutover](https://github.com/jimmie-potts/agent-device-hub/issues/840#issuecomment-6086298585) records the established installation;
it transferred no old data. Old writers are stopped and disabled, with their
units, code, releases and stores retained for manual return. Retention does not
mean both systems run. Read [runtime setup](../apps/runtime/SETUP.md) before
installation work; its fresh setup/manual return procedure is distinct from the
legacy Hub installer and does not establish routine upgrade automation.

[Open the current architecture diagram](runtime-architecture.html), authored in
[runtime-architecture.json](runtime-architecture.json). It maps these source owners:

| Boundary | Owning source |
| --- | --- |
| Authenticated remote HTTP/SSE and MCP | `apps/runtime/src/gateway/` and the runtime [gateway guide](../apps/runtime/README.md#gateway) |
| Fixed shipped modules | `apps/runtime/src/modules.ts`, static registration build and module-owned registrations |
| Publish, subscribe, sync, request and respond | `packages/sdk/src/` and its [guide](../packages/sdk/README.md) |
| Sessions, inbox, history and action tracking | `apps/runtime/src/core/` and the [core guide](../apps/runtime/README.md#agent-session-core) |
| Per-device writers and private state/outboxes | `modules/` and their owning READMEs |
| Browser shell and module feature pages | `apps/runtime/dashboard/` and browser-only module entries |

**Connect/reconnect:** a remote client authenticates, syncs current membership
from its owner, then follows live events. A sync replaces membership, so removed
entities disappear. A bounded-buffer overflow restarts the sync rather than
combining partial snapshots. Reconnect never replays old commands or effects.

**Commands:** the owning service admits a live request with expiry. An accepted
reply records responsibility for a later outcome, not successful device output.
Core state, tracker, inbox and history changes commit together. A module commits
its outcome in its own outbox before publication and can report that outcome
again after restart; the core deduplicates it by source and ID. This reporting
retry never sends the command again. Failed and uncertain outcomes remain distinct
from succeeded, and transmitted evidence is distinct from a physical observation.

The diagram's source baseline is `36fb7b99f11b47c2f95be3f892a13d7ca72c0b0d`,
reviewed October 9, 2026. The installed evidence is the linked #840 record, not
this render. That release accepted Wispr as unconfigured and CHOMPI integration
as deferred; module inclusion or a health HTTP response does not prove every
feature is installed or every device physically qualified. GitHub owns subsequent
status and exact acceptance scope.

Review this view when gateway transport, module registration, state ownership,
sync/recovery, outcome persistence, device writers or hosting changes. A semantic
review may conclude "reviewed; no architecture change" without regeneration.
When it changes, validate and deliver the JSON with the installed archify skill,
then inspect the exact HTML in a browser. Keep deterministic receipts, browser
measurements and visual review separate. The new files have no Work Guide imports.
The [flow sequences and retained diagram guide](diagrams/README.md) explain reconnect,
command outcomes and PROMPTI input routing. The dated atlas and its nine shared
legacy diagrams retain their pinned baselines under `docs/diagrams/legacy/`,
independently of Work Guide.

This document records current and retained legacy ownership, state and command
boundaries. The [runtime](../apps/runtime/README.md), its [dashboard](../apps/runtime/dashboard/README.md)
and module guides own current implementation details. Sections labeled Legacy
refer to the retained 1.x system. GitHub issues hold delivery and acceptance status.

The [B.U.N.N.Y. HTML system design](system-design/index.html) preserves a dated
September 19, 2026 design snapshot. Its labels and open decisions reflect that
baseline, not the current implementation.

## Product direction and vocabulary

[ADR 0004](decisions/0004-local-first-personal-assistant.md) records the accepted
local-first assistant direction. Preserve the Codex-first milestone before
general device controls and Apple Music integration. Container migration and
remote voice access remain later work; [ADR 0008](decisions/0008-runtime-hosting.md)
keeps WSL as the host choice. Its proposed keep-alive and server migration are
separate from the accepted runtime service cutover; see that ADR's current-applicability note.

The shared application's user-facing name is B.U.N.N.Y. The
[application UI style guide](application-ui-style-guide.md) owns that spelling,
the visual foundation and skin template, and the component vocabulary (Brain,
Ears, Eyes, Nerves, Paws, Face, Burrow) that names the responsibilities below
without changing any owner, package, path or identifier.

The assistant is the conversational client of available services and tools.
An automation rule is an explicitly accepted event-to-action policy that can
run without an open conversation.

A playback session represents a selected media player's observed content,
playback state and supported controls. It is distinct from an agent session.
A track-change event represents an observed content transition.
Audio measurements represent sampled levels or frequency information;
track metadata and decorative animations are not audio measurements.

These terms describe responsibility boundaries. Concrete schemas, freshness,
command behavior and presentation policies belong in their owning contracts
and issue-linked specifications.

## Personal data

[ADR 0011](decisions/0011-private-personal-data-retention.md) sets the direction
for private collection: retain personal content from owner-selected sources,
including logs and telemetry, while excluding credentials and secrets. Keep
collected personal data out of every GitHub publication surface. Private
retention does not expand source selection, sharing or command authority.
Existing versioned contracts remain in force until their scoped replacements
are delivered; a bounded snapshot or diagnostic stream is not a complete archive.
The 2026-10-05 [amendment](decisions/0011-private-personal-data-retention.md#amendment-2026-10-05)
allows retained data in Claude and Codex prompts and requires no new clearing
features.

## Ownership

The hub owns provider qualification, shared event/session contracts, one
authoritative agent-state core, common controller contracts, shared MCP
infrastructure and the cross-device dashboard, including the shared device art
that dashboard draws ([ADR 0007](decisions/0007-bunny-shell.md)).

Pixoo owns its media library, renditions, player, 64x64 status renderer,
Monitor/Media policy and serialized device writer. Nanoleaf owns its Python
light-writing worker, geometry, Line allocation, spatial effects,
Work/Quiet/Free policy, scene restoration and advanced wall editor. The retained legacy Nanoleaf implementation uses separate Python services in WSL;
the earlier Windows installation and Linux transition are historical boundaries.
The current TypeScript module owns the runtime's Nanoleaf writer and private state.
[Nanoleaf #55](https://github.com/jimmie-potts/codex-nanoleaf/issues/55) holds
the installed acceptance record. Common code must not import a device
application's internal modules.

Tidbyt owns its 64×32 renderer, backend connection and serialized display writer.
LIFX owns bulb capability mapping, LAN transport, lighting policy and per-device
queues. These new controllers belong in this repository. The current [Tidbyt](../modules/tidbyt/README.md) and [LIFX](../modules/lifx/README.md)
modules run inside `apps/runtime`. Their source tests and installed/physical
acceptance are separate evidence. The retained
[local controller host](../apps/local-controllers/README.md) (#289) owned the old
controller libraries over controller v1; it is stopped after #840 and retained
for manual return. The shared core interprets
agent observations once, and each controller maps shared state to its device.

Shared agent methods stay in agent-skills. Hub development tooling will own the
versioned reusable OpenSpec validation package; device repositories own adoption,
their tests, policies and capability specifications.

## Module frontend ownership

The owner selected React and TypeScript for new module interfaces on 2026-10-08.
One shared dashboard shell owns navigation, common components, styling,
connection handling and authenticated API access. Modules own feature-specific
frontend source, compiled into the shared application from explicit browser-only
entries for the fixed shipped modules. Browser code does not import Node-side
module implementations. This adds no framework, runtime plugin loader or service.

Reviewed separately bundled editors remain a migration option where they avoid
an unnecessary rewrite. Their declared assets, content types, content security
policy and iframe configuration form one contract. Same-origin scripted frames
are trusted application code, not isolation for untrusted extensions. User content
never becomes executable code; passive HTML pages may retain restrictive policy.
The existing Nanoleaf editor can use this path without a full React conversion.

Backend storage, authorization, automation and device ownership remain independent
of React. UI reads use authenticated runtime interfaces, and commands use existing
tracking and device writers. Opening a page does not change a device, media or
scene. The frontend stories own implementation and acceptance of this decision;
it grants no installed or physical authority.

## Event and messaging platform

[ADR 0012](decisions/0012-bunny-event-platform.md), including its later amendments,
selects how components communicate and supersedes ADR 0010's staged
adoption. These parts exist as source: the message profile 2.0 contract
(`@jimmie-potts/event-contracts/v2`), its core payload families
(`@jimmie-potts/event-contracts/v2/families`), its device families with the
Hub-mode table (`@jimmie-potts/event-contracts/v2/devices`), the shared
agent-status helper (`@jimmie-potts/event-contracts/v2/status`), the SDK
(`@jimmie-potts/sdk`): its in-process bus with sync, its SSE/HTTP remote
transport and the module API, and the runtime with its agent-session core and
fixed shipped modules (`apps/runtime`). It also supports core-only disposable
runs without device modules. The 1.x field mapping is in
[MAPPING.md](../packages/event-contracts/MAPPING.md).

- **Runtime.** One TypeScript runtime, `apps/runtime`, hosts the core and
  every device as a module from a fixed, shipped list. Modules talk through the
  SDK's in-process bus; there is no broker.
- **Publishing.** Owners publish full-record state events, removal events and
  occurrence events. Core changes commit with their tracker, history and inbox
  rows in one transaction; each module reports outcomes through its own outbox.
  One owner holds each fact, and one writer controls each device.
- **Consumers.** A consumer syncs current state from the owner when it connects
  or restarts, then follows live events. Copies of other owners' state are
  rebuilt by sync, not stored.
- **Commands.** Commands are live-only requests with expiry. The core tracks
  device commands, moments and mode changes from sent to completed.
- **Conventions.** Every message uses profile 2.0: one CloudEvents envelope, one
  error body and code registry, and shared payload building blocks.
- **Edges.** Remote parts (hooks, the dashboard, MCP clients, the CHOMPI bridge
  and the Wispr collector) use the same SDK calls over SSE down and HTTP up,
  except Wispr's owner-approved published-file handoff (#927, ADR 0012).
  Its read-only module uses the existing pure Wispr contract package, without
  importing the collector or another component's implementation. Every authenticated
  read-scoped client may read its analytics routes; browser exposure and text
  sharing remain separate, off-by-default choices. Analytics stay outside MCP,
  agent snapshots and general broadcasts.
- **No replay.** Past occurrences or effects are never redelivered to views or
  devices.

[Epic #827](https://github.com/jimmie-potts/agent-device-hub/issues/827) and
[#840](https://github.com/jimmie-potts/agent-device-hub/issues/840) record the
accepted rebuild and fresh cutover. The [event profile 1.0](event-contract.md)
and released 1.x contracts remain authoritative for retained legacy consumers,
not the new runtime. Extend them only additively while those consumers remain;
separately authorized retirement owns their removal.

## Installed release ownership

The [install contract](install-contract.md) separates each runtime's release anchor
from mutable state and the shared runtime parent/Node executable. It defines
verified release identity, compatible recovery preserving latest durable state
and private operation receipts. Consumer commands and live acceptance remain
separately owned; the contract adds no installer or deployment service.

<a id="agent-observation-and-commands"></a>

## Legacy agent observation and commands

Provider emitters send small validated lifecycle observations to the active state
owner. Codex Desktop, Codex CLI and Claude Code remain distinct compatibility
targets. Qualification must record documented, observed, unsupported and unknown
signals for actual accessible versions.

The core identifies sessions by provider, source/host and session ID, retaining
turn and child relationships only where evidenced. Separate sessions in one
project stay separate. Activity, attention, retained notices, acknowledgment,
optional provider read evidence and freshness are independent concepts. The owner
forgets a session after 24 hours without lifecycle evidence, which frees its
capacity. Expiry is not acknowledgment, readership, success or cancellation. An accepted runtime end on any supported path (Codex Desktop, Codex CLI or Claude Code) retires the known session tree sooner through the same atomic replacement boundary; the owner interprets that evidence once and devices add no end filters or timers. When the owner is full, a new root task may also retire one finished subagent subtree without attention ([#807](https://github.com/jimmie-potts/agent-device-hub/issues/807)). Bounded durable guards reject recognizable delayed events. Opt-in snapshot 1.1 generations let consumers reset a recreated task even if they missed its removal.

A turn end is not proof of successful work or readership. Nanoleaf's current
Codex unread reconciliation remains a provider/consumer capability during
migration. The standalone Hub can also read Codex Desktop's unread marker from
the mounted Windows Codex home and record `read.observed` for top-level Desktop
sessions. Pixoo dismissal changes monitor state only. New generic consumers
must not assume every provider supplies read receipts.

Session titles, project names, prompts, transcripts and agent output may enter shared data under the owner-approved policy. Credentials, tokens and secrets remain excluded. Only fields declared by the selected versioned contract are transmitted; prompt, response and transcript-content capture requires its separate implementation under Hub #425.
Lifecycle 1.1 carries bounded title/source and project display metadata. Project
identity remains separate; hooks send only the cwd basename for display. Explicit
owner labels precede agent labels and provider titles. Neutral IDs remain the
fallback. No local reader or personal configuration changes merely because the
policy permits a field. Lifecycle 1.2 adds an optional Claude Desktop host
session ID read from the hook environment. The old Hub's owner keeps it in memory
only, exposes it through opt-in snapshot 1.3, and never treats it as identity.
The new runtime's core ([#831](https://github.com/jimmie-potts/agent-device-hub/issues/831))
keeps it with the session record in its private store, which
[ADR 0011](decisions/0011-private-personal-data-retention.md) allows, so it
survives a restart; it is still never an identity, ordering or merge key.

Hooks remain bounded, observational and fail-open. Device/collector failure must
not deny an agent action, change permissions or hold work waiting. MCP is the
separate deliberate command interface. Its tools call the same services as the UI.

<a id="controller-boundary"></a>

## Legacy controller boundary

A controller exposes configured identity, capabilities, validated commands and
revisioned observations. Use an authenticated machine API instead of borrowing
browser editing tokens or weakening Origin validation. Start on loopback;
reachability and deployment must be explicit.

Each physical device retains one designated writer. The hub routes commands to
that owner, with independent device queues and failure handling. Registered
destinations are operator-controlled; clients cannot supply arbitrary IPs, URLs,
paths or raw protocol commands.

Common results distinguish desired, pending, successfully sent, failed/partially
applied, uncertain and externally controlled state, plus observation age.
Service health does not refresh session/device evidence. A successful HTTP
response is not an optical measurement.

Request IDs, revision checks, generation cancellation and bounded replay protect
concurrent UI/MCP clients. Reconnect starts from an authoritative snapshot when
the cursor expires and does not replay expired effects or ambiguous writes.

Power/brightness are optional capabilities, as are scenes, zones, media and
previews. Nanoleaf timelines and Pixoo pixel buffers remain device-specific
payloads. Renderer contracts carry clock domains, epochs and update outcomes;
browsers must not create another scheduler for physical effects.

<a id="fresh-nanoleaf-linux-runtime"></a>

## Legacy fresh Nanoleaf Linux runtime

The delivered installer supports the existing Nanoleaf runtime as separate Linux
processes in Ubuntu WSL. Linux Python hooks, the CLI, the wall map and the
controller coordinate through one SQLite database on the Linux filesystem. The
existing on-demand Python worker remains the only process that writes to the
Nanoleaf device. The design does not add a second writer or put runtime SQLite
state under `/mnt/c`.

The wall map listens on configurable loopback port `8765` by default. The Python
controller listens on configurable loopback port `41231`. The Node MCP host
listens on configurable loopback port `41230` and calls the controller directly
over numeric-loopback HTTP at `127.0.0.1:41231`. Linux runtime commands do not
forward through or launch Windows executables.

Windows remains a client boundary. A Windows browser can open the wall map, and
the existing configured readers can read project, title and unread JSON from the
mounted Windows filesystem. Those metadata files are read-only inputs to Linux;
the browser receives neither device credentials nor private SQLite state.

This is a fresh installation path. Existing Nanoleaf state need not move into
Linux, and the old installation can remain unused.
[Nanoleaf #54](https://github.com/jimmie-potts/codex-nanoleaf/issues/54)
records source and setup; [#55](https://github.com/jimmie-potts/codex-nanoleaf/issues/55)
records installed service, client, browser and physical Work/Quiet/Free
acceptance. Source checks alone do not establish those installed results.

This transition excludes data migration, rollback tooling, a combined daemon, a
new hook HTTP API, shared monitoring and the Nanoleaf monorepo move. WSL service
availability follows the WSL instance lifetime. Shared monitoring and later
source migration keep their existing owners and dependency paths.

## Repositories, packages and hosting

Use this repository as the monorepo for new controllers and shared packages,
as recorded in [ADR 0003](decisions/0003-device-controller-monorepo.md).
The existing Pixoo and Nanoleaf repositories retain old source and manual-return
installations after the accepted cutover; their old writers are stopped and disabled. Pixoo's domain packages and presentation are staged
under modules/pixoo. Use TypeScript for new shared services, Tidbyt/LIFX/PC
lighting controllers and the React dashboard. The retained old Nanoleaf worker is
Python; the current runtime uses the TypeScript port under
`modules/nanoleaf` ([#26](https://github.com/jimmie-potts/agent-device-hub/issues/26)).
Qualify the native Windows helper needed by PC lighting separately.
Share JSON contracts and fixtures across languages and implement the shared
status interpreter once.

Shared packages include packages/contracts, packages/mcp, packages/agent-state,
packages/lifecycle-contracts, packages/event-contracts and packages/sdk. The [lifecycle contract](agent-lifecycle-contract.md)
and [provider matrix](provider-qualification.md) establish metadata and source evidence,
without claiming installed producer qualification. Provider normalizers and bounded
emitters live in packages/agent-state/src/providers.ts; the silent source hook is
packages/agent-state/bin/hook.mjs. The host and dashboard live under apps/.
Nanoleaf's port lives under modules/nanoleaf, not the earlier adapters/nanoleaf
proposal. controllers/tidbyt holds the
in-process cloud controller package; controllers/lifx holds the in-process LAN controller and controllers/pc-lighting
currently contains documents. Use Node 24 and npm workspaces for executable packages.
Publish versioned private artifacts when a separate consumer needs
them; avoid worktree-relative imports and unnecessary independent packages.

The [agent-state API](../packages/agent-state/README.md) owns deterministic
reduction, immutable snapshots, independent consumer queues and versioned
export/import. Its host storage boundary requires an exclusive lease and atomic
revision-checked commits. Current records, chosen labels and notices survive
journal retention. The journal retains the newest 10,000 events within 24 hours,
with pruning on writes, startup and an idle timer. The in-memory reference store
is a test adapter. The current runtime supplies its private core SQLite adapter;
Pixoo #31 records the retained embedded owner's durability and access controls.
Observation age and restart uncertainty remain separate from collector health.
The agent-state reducer sends no device commands, regardless of Media/Free modes.
The runtime core's separate action dispatcher admits and routes tracked commands
through the SDK to the owning module; it never writes a physical device itself.

Agent-state 2.0.0 calculates best-effort current activity for ordinary unordered
provider hooks. An eligible unseen turn start selects active; its matching stop
retains a completion notice. Each consumer keeps its own clearing/acknowledgment
policy. This selection belongs in the shared reducer, not the emitter, host or
device projection. Provider ordering stays unknown, and an unseen delayed start
can select incorrectly. Genuine qualified order retains precedence. Retired
identities use a bounded 256-entry FIFO; completion notices provide additional
identity retention. Saved ambiguity can recover on a fresh eligible start using
the unchanged version 1.0 store. The diagnostic journal is neither a raw-event
archive nor a complete history. See the [state policy and limits](../packages/agent-state/README.md#state-and-uncertainty)
and [legacy installed update procedure](../apps/hub/SETUP.md#upgrade-and-roll-back-the-installed-hub).
The current runtime setup and upgrade boundary is at the top of this guide.

The MCP module exports an HTTP handler and configured service/tool registration.
The owning application enables and mounts it; the module never opens a listener
or starts another device writer. Shared controller tools preserve API 1.0 request
tickets, revisions and receipts. Strict registered application extensions can use
an existing app request_id and catalog/player result without changing that wire
contract. Both paths retain fixed configured targets, current read/control scopes,
bounded authentication and response delivery, and no automatic write retries.
See [the MCP module](../packages/mcp/README.md) for its API and evidence boundary.

In the retained legacy system, Pixoo's embedded owner and the standalone Hub
compose the same core. Its Nanoleaf shared-feed path retains the Python writer
and Work/Quiet/Free policy. The current runtime's core and TypeScript Nanoleaf
module replace that running topology after #840.

Legacy owner migration is explicit and quiesced. Preserve source identities,
session/notice state, revisions and producer configuration with a versioned
export/import and rollback. Pixoo's session-source facade switches its renderer,
browser feed and shared label/acknowledgment operations to the selected owner.
Remote mode never starts a second local reducer; a stale feed stays visibly stale
until recovery or explicit rollback. Never run embedded and standalone owners
against the same state simultaneously. Controller databases stay private; Windows/WSL
processes do not coordinate through a mounted SQLite database.

The Nanoleaf shared-input cutover is complete: its legacy hooks are removed, and
the runtime port keeps shared input only (#26). Before #840, rollback used the old
Python installation; after the accepted cutover it remains the manual-return
option. Only one selected ingestion path updates each session. Shared-input consumers
can cache presentation state; they do not become independent status authorities.
Loss of the hub has a documented recovery/rollback path and never blocks agents
or ordinary media use.

[Pixoo source migration #25](https://github.com/jimmie-potts/agent-device-hub/issues/25)
staged Pixoo's code under `modules/pixoo/`. That folder's README records the
provenance, the active work at the move and every file not moved.
[Nanoleaf source migration #26](https://github.com/jimmie-potts/agent-device-hub/issues/26)
ports Nanoleaf's domain logic to TypeScript under `modules/nanoleaf/`. That folder's
PORTING.md maps every Python module and test to its slice or the runtime part that
replaces it. Repository consolidation does
not combine runtimes, install services, transfer private databases or switch the
active state owner.

## Unified UI and additional devices

The first dashboard shows sessions, attention, freshness, capabilities, device
modes, pending changes and last update outcomes, with explicit supported controls.
It links to existing advanced editors. A global mode must not silently replace
Nanoleaf Work/Quiet/Free or Pixoo Monitor/Media intent.

The current shared frontend in apps/runtime/dashboard is B.U.N.N.Y.'s central interface.
The retained apps/dashboard implementation supplies the historical #6 pattern below. It uses
the approved Nanoleaf visual language and interaction patterns. Each current
and future user-facing component joins the same navigation and reusable views
for its available status, settings and supported controls, with specialized
views where needed. A component's declared capabilities and permissions determine
which operations are available; unsupported or unavailable actions need an
explanation. All commands continue through the owning services.

[#6](https://github.com/jimmie-potts/agent-device-hub/issues/6) defines and verifies
this integration-view pattern with the initial device fixtures and a third
synthetic component. New production integrations retain their own API, UI and
acceptance work. They do not block the first Codex-integration release.
[#31](https://github.com/jimmie-potts/agent-device-hub/issues/31) extends the
same application with general controls that work without an agent session.
[ADR 0005](decisions/0005-general-device-controls.md) records the accepted
definition: controls stay in each component's existing view and submit one
guarded controller v1 command each; power and brightness are mode-independent;
content controls are disabled while a device presents agent status, with an
explicit switch to Media or Free; nothing restores automatically; availability
is declared capability times existing control scope. The ADR links the bounded
issues.
[ADR 0006](decisions/0006-hub-moments-and-interludes.md) adds event-driven
moments. The hub decides: event sources, rules, agent personas, arbitration,
choreography and the moment log. Each device guarantees: translation, one
writer, precedence at execution, returning to its current base, and evidence.
Every moment is a time-boxed interlude, and only owner-approved event kinds
may cover status presentation. No moment changes a mode. ADR 0005's explicit
restoration stays, except that an interlude ends automatically.
The hub keeps event rules, the interrupt set, arbitration settings and the
automation log in its private store under the owner lease, and arbitrates each
moment before it hands it to the shared moment sender, once per device
([#358](https://github.com/jimmie-potts/agent-device-hub/issues/358),
[#335](https://github.com/jimmie-potts/agent-device-hub/issues/335)). Moments
reach a device only through its owning controller's queue and tickets.
[ADR 0007](decisions/0007-bunny-shell.md) makes the dashboard the one
B.U.N.N.Y. shell, with a starting page set of home widgets, a page per
registered controller device and a later group page, drawn with hub-owned
shared device art from hub snapshots; the final page split stays open in #271.
The Nanoleaf wall map is a linked advanced editor until each remaining
operation has a home in the shell, then retires under its own issue.
Routine supported operations belong in the central UI; full migration of the
linked advanced editors remains separate follow-on work. Additional production
components require their own delivered integration and acceptance.

Exact hub previews are deferred for a future scope decision. Device rendering
contracts and parity checks are prerequisites for any later preview issue, not
an implicit commitment to implement previews in the first dashboard. The
overview does not wait for Nanoleaf live mirroring, Lively, an ambient redesign
or new Pixoo player UI. Those remain separately owned work.

Evaluate Home Assistant/MQTT for ordinary new device integrations before writing
custom transports. For LIFX, the user selected direct LAN after considering
Home Assistant; the controller has no Home Assistant or cloud dependency.
Broader Home Assistant/MQTT adoption remains deferred under #11.
Generic device support does not establish custom animation fidelity. Home
Assistant must delegate to an existing writer or use an explicit ownership handoff.

<a id="tidbyt-and-lifx-delivery"></a>

## Legacy Tidbyt and LIFX delivery

Automatic agent status is the first feature priority for these new controllers.
Qualify their connections, implement fake-backed controllers, then consume the
selected shared state owner. Source status integration does not wait for new
dashboard or MCP tools. Full installed lifecycle acceptance uses the reversible
producer setup specified by [#8](https://github.com/jimmie-potts/agent-device-hub/issues/8).
Existing local Codex control priorities under #4/#7 remain unchanged.

Tidbyt starts with the official cloud. Keep a pure 64×32 WebP rendering boundary
separate from connection configuration, authentication, installation identity,
capabilities and delivery outcomes. A later Tronbyt connection reuses the renderer
and controller queue. It is an explicit backend selection with no automatic
failover. Moving a physical Tidbyt to Tronbyt also requires supported firmware
and a separately authorized transition; changing a server URL alone is insufficient.
See the [Tidbyt guide](../controllers/tidbyt/README.md) for qualification sources.

LIFX starts with local LAN control. Qualify the user's exact model before physical
acceptance; the supplied "A16" name must not be silently treated as A19. Expose
only supported capabilities. Source development uses fake packets and configured
neutral identities. No startup discovery or physical writes are implied by setup.
See the [LIFX guide](../controllers/lifx/README.md).

The hub reaches both through the local controller host, registered as the
`tidbyt` and `lifx` controller kinds. The host serves each device's controller
v1 snapshot and commands on one loopback port. The Tidbyt controller declares no
v1 capability, so the hub can read its status but never pushes frames. LIFX color
and color temperature use the controller's own `lifx-light` 1.0.0 profile on a
separate typed route, not a v1 extension. The host reads a qualified bulb only on
demand, at most every 30 s while its snapshot is being read (#330). Since #20, a
qualified bulb also accepts controller v1 `mode.set` (Work/Quiet/Free) and, when
its private configuration names both a hub status feed and the bulb's own status
block, the host paints one shared color per shown-state transition through the
controller's own internal, non-public paint operation, never on its own for an
unconfigured or unqualified bulb, and never in Free.

The status issues own the initial display layout, session selection, lighting
effects, update limits, takeover/manual-control and restoration policies. Resolve
those choices before implementation readiness. Both controllers preserve shared
privacy and evidence semantics; neither infers success, read status or fresh
connectivity from absent observations.

## PC and desk lighting delivery

[The PC lighting documentation ticket](https://github.com/jimmie-potts/agent-device-hub/issues/50) records the accepted scope:
Corsair Dominator Platinum RGB DDR5 and supported H150i ELITE LCD XT lighting,
plus Lian Li Strimer lighting and the Varmilo VA108M-RGB keyboard where compatible.
Preserve iCUE, L-Connect 3 and the existing lighting and keyboard setup. Qualification
may use the existing MSI software as a Strimer synchronization route; wider motherboard/GPU lighting, cooler LCD
content and fan/pump control are outside this feature.

"PC lighting" groups tower devices and an optional keyboard. The existing controller
contract owns device identity and zone meaning; the group creates no new wire
identity. The keyboard is a separate configured lighting target with no input
handling responsibility. Keep one designated writer per target and one owner for a Strimer controller's cable outputs. Qualify vendor
handoff and restoration before enabling a target. Missing support stays explicit.

The proposed controller belongs in controllers/pc-lighting with a Windows-local
vendor adapter, independent target queues and the shared authenticated APIs.
iCUE SDK qualification comes first for Corsair. Strimer qualification must find
a supported route compatible with L-Connect, including any explicit motherboard
sync handoff. OpenRGB remains research, with no automatic dependency, migration
or competing writer. Existing Home Assistant/MQTT delegation is a qualification
comparison; broader #11 research is not a prerequisite.

Varmilo qualification is limited to existing supported vendor or maintained
interfaces. The user selected whole-keyboard shared status first; per-key regions
and separate sessions mapped to keys are deferred. Vendor software availability
and generic USB IDs do not establish a supported lighting API. If none qualifies,
record the limitation and defer the adapter. Do not introduce custom protocol
research, simulated key shortcuts or firmware replacement. Preserve normal typing,
key mappings, macros and lock indicators, and never capture keystrokes.

Automatic status consumes the authoritative shared core, now hosted by apps/runtime. It does not
add a collector or wait for general controls, the dashboard or standalone hosting.
Strimer and Varmilo each have separate qualification, adapter and physical acceptance
work, so neither blocks a verified Corsair release. Keyboard support also cannot
block Strimer. Each optional target requires its own adapter before joining status
or controls; closing a qualification issue with an unsupported result does not
satisfy that readiness gate. General UI/MCP controls follow
#31 and use the same owning services. Expose only established capabilities;
arbitrary RGB/channel operations need explicit contract or typed-extension work.

The [PC lighting guide](../controllers/pc-lighting/README.md) distinguishes screenshots,
historical logs, user-supplied identity and inventory from unverified API/physical
capabilities.
Its linked issues own readiness, status policy, manual takeover and restoration.
Source delivery adds no installed service or device operation. Full live lifecycle
acceptance uses #8, and each physical target keeps its own evidence and permission
gate. Windows vendor adapters remain on the PC during later hub-host migration.

## Desktop controls and desk presets

[The desktop-control direction](desktop-controls.md) records accepted defaults
and the qualification/delivery backlog in
[#63](https://github.com/jimmie-potts/agent-device-hub/issues/63) and its linked tickets.
The input integration and desk-preset service remain planned. The hub repository
owns their source; physical input handling stays Windows-local beside
Codex. Their implementation issues select packages, runtime and installation paths.

A control profile maps physical controls and gestures to actions with explicit
application scope. A button binding is one assignment. Selecting a profile alone
sends no device commands. A desk preset defines explicit supported actions on
configured participating lights and displays through the existing command owners.

Keyboard A/B and the attached Dual Super Buttons remain keyboard-owned. The
owner prefers B=Wispr Ctrl+Win and A=Enter, configured directly on the keyboard.
B.U.N.N.Y. has no A/B mapping, editing, storage, dispatch, restoration or preset
binding role, in version 1 or the later #70 profile editor.
The first mouse mapping requests next
task needing attention, command menu, previous task and next task within Codex,
preserving ordinary behavior elsewhere. The owner selected an app-scoped
shared-key route: PageUp/PageDown and Back/Forward from other devices also map
while Codex is active. Receiver-specific filtering is not part of that route.
The temporary AutoHotkey trial qualified this boundary; reusable implementation
and persistent installation remain separate. This local path does not wait for
shared monitoring, general controls, Music or model calls. Preserve vendor mappings and the
existing CHOMPI bridge; its MIDI bindings do not establish 8BitDo/profile support.
The CHOMPI controller epic ([#738](https://github.com/jimmie-potts/agent-device-hub/issues/738))
is a separate non-MIDI route: one Windows bridge is the only CHOMPI writer and
reads the Hub's session feed without becoming a state owner. See the
[qualification report](chompi-controller-qualification.md).

An explicitly selected qualified binding later requests
Work → Free → Quiet → Work through the hub's preset service. Keyboard A/B and the attached
Super Buttons are excluded from preset bindings.
This shared path follows the Codex-first milestone and general-control definition.
It invokes existing authenticated app/controller services and their queues,
preserving one writer per physical device and private controller databases.
Nanoleaf Work/Quiet/Free and Pixoo Monitor/Media keep their native semantics;
desk presets introduce no common device-mode enum or silent takeover.

Manual device-app changes persist until the next explicit preset request and its
supported ownership handoff. Startup, view/profile selection and reconnect do not
apply presets or replay input. Requested preset, per-device transport outcomes
and fresh visible observations stay distinct, including partial/uncertain results.
Source, installation, hardware/input, application and physical acceptance each
need their own evidence. Music policy remains owned by
[#40](https://github.com/jimmie-potts/agent-device-hub/issues/40); PC lighting is a
separate optional participant with its own qualification gates.

## Alternatives and consequences

Copying the Nanoleaf reducer into Pixoo would duplicate provider assumptions and
couple new clients to Codex-specific read behavior. A single shared core avoids
that drift, at the cost of explicit package/API compatibility and state-owner
migration work.

The original bootstrap deferred existing source moves to avoid coupling them to
active installations. The later TypeScript rebuild superseded that source-layout
choice; the original installation boundaries remain historical context.

MCP remains reusable infrastructure with device registrations. The reusable local
transport and device tools in [#7](https://github.com/jimmie-potts/agent-device-hub/issues/7)
depend on controller contracts, independently of standalone hosting. Pixoo may
retain an opt-in local endpoint through that module. Standalone discovery and
agent-status tools belong to [#13](https://github.com/jimmie-potts/agent-device-hub/issues/13),
which composes #5 and #7. Neither endpoint creates a second writer.

This direction intentionally revises the older plan for independent Pixoo and
Nanoleaf collectors. It preserves installation independence during the staged
transition rather than permanently maintaining two status implementations.

## Evidence and unresolved qualification

[Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp),
[Claude hooks](https://code.claude.com/docs/en/hooks-guide) and
[Claude MCP](https://code.claude.com/docs/en/mcp) establish extension mechanisms.
Installed-client signal coverage still requires the qualification and acceptance
issues. [Home Assistant Nanoleaf](https://www.home-assistant.io/integrations/nanoleaf/)
and [MQTT](https://www.home-assistant.io/integrations/mqtt/) are starting points
for the deferred capability assessment.

Exact schemas, SDK/package versions, controller reachability, client signals and
physical timing will be settled by their bounded issues. These unknowns do not
authorize guessed telemetry or deployment changes.

<a id="standalone-linux-host"></a>

## Legacy standalone Linux host

The [host](../apps/hub/README.md) under `apps/hub` targets native Linux in WSL.
Native Windows runtime qualification is separate. The application composes the
shared core and uses authenticated configured controller endpoints. Its private
store never opens a controller database. Source and performance receipts live
with [#5](https://github.com/jimmie-potts/agent-device-hub/issues/5) and
[#30](https://github.com/jimmie-potts/agent-device-hub/issues/30); installation
and physical acceptance retain their own owners.
[ADR 0008](decisions/0008-runtime-hosting.md) records where the six user
services run: in the Ubuntu WSL distribution, today started only by a user
session, with linger, an idle timeout and one Windows scheduled task decided
but not yet installed. A dedicated Linux server (#44, which absorbs #42's
Docker packaging) follows under the ADR's proposed trigger: the Tronbyt move
starting, a story needing LAN discovery or events, or a failed keep-alive.

## App verification previews

[App verification](app-verification.md) and
[ADR 0009](decisions/0009-app-verification-runs.md) define how an agent starts
a disposable Hub, Nanoleaf wall or Pixoo run with synthetic state and simulated
transports, keeps frozen proof and leaves a leased preview for the owner's
browser on the same PC. Each run is a transient user unit with its own
ephemeral loopback port, runtime directory and lease timer; it never attaches
to the installed services, their ports or a device. The Hub pilot is
[#494](https://github.com/jimmie-potts/agent-device-hub/issues/494); the
device adapters are
[codex-nanoleaf#193](https://github.com/jimmie-potts/codex-nanoleaf/issues/193)
and [divoom-app-upgrade#118](https://github.com/jimmie-potts/divoom-app-upgrade/issues/118);
Windows-host qualification is
[#497](https://github.com/jimmie-potts/agent-device-hub/issues/497).

## Shared playback

The standalone host owns shared playback
([#175](https://github.com/jimmie-potts/agent-device-hub/issues/175),
[#233](https://github.com/jimmie-potts/agent-device-hub/issues/233)). A shared
module keeps each source's normalized observation and freshness and the command
results. Source modules own their protocols, endpoints and field mapping. The
sources read the owner's Sony HT-A9 and Sonos Move while an iPhone plays Apple
Music to them over AirPlay; audio never passes through the hub. Playback state
is separate from agent sessions and state exports.

Clients see one stable neutral playback ID that never changes with the speaker.
The hub polls every configured source and ranks them first by whether they
report a playing or paused session, then by freshness class (available, stale,
unavailable), then by configured order. A source that goes silent mid-song
can remain shown as stale while it retains the highest rank; nothing is shown
as paused for lack of evidence. Commands name the playback ID
and go only to the presented source; they are never redirected, retried or
replayed. The owner chose this ordered preference on 2026-09-25 over the
explicit selection #175 designed, because the phone chooses the output. The
[host guide](../apps/hub/README.md#playback) documents the routes, the rule and
the source interface. Display cards read the same snapshot and render in their own
controllers: the Tidbyt runner's optional now-playing tile
([#38](https://github.com/jimmie-potts/agent-device-hub/issues/38)) writes a
second background installation through the existing Tidbyt queue. The Windows connector
([#36](https://github.com/jimmie-potts/agent-device-hub/issues/36)) is deferred;
if built, it becomes another source of the same module.

In the new runtime ([ADR 0012](decisions/0012-bunny-event-platform.md)), the
[playback module](../modules/playback/README.md)
([#929](https://github.com/jimmie-potts/agent-device-hub/issues/929)) is that one
owner. It keeps the Hub's rule, cadence and thresholds, publishes the presented
source as the core `playback` record, and answers `playback-control` with a reply
and an outcome. The Hub's old copy is stopped after the accepted
[#840 cutover](https://github.com/jimmie-potts/agent-device-hub/issues/840) and
retained for manual return.

<a id="linux-host-handoff-implementation"></a>

## Legacy Linux host handoff implementation

The [host API and migration guide](../apps/hub/README.md) define the delivered
source boundary. A directly supervised source quiesces and saves its versioned
export before verified process exit. A single-use release capability permits
an empty destination import behind a persisted admission fence. Controller
settings use their owning APIs and never create a device writer.

Activation verifies every configured consumer route and producer authority,
restores producer enablement while admission remains fenced, then clears that
fence. Durable route intent survives coordinator exit. Rollback transfers the
latest state into a fresh host store; Pixoo retains its private media directory
and selected remote facade. The tool cannot silently restore embedded ownership
into an occupied Pixoo store. Installed hooks, source qualification and physical
acceptance remain separate from these source tests.

<a id="bunny-frontend-hub-6"></a>

## Legacy B.U.N.N.Y. frontend, Hub #6

The implementation in `apps/dashboard` provides React/TypeScript activity, component
and connection views served by `apps/hub` at the same origin. A dedicated scoped
hub credential stays in page memory. Native controller credentials remain in the
hub's private configuration. The authenticated dashboard context exposes permitted
component identities and supported editor links, never arbitrary proxy targets.

The component view owns browser navigation, drafts and displayed observations.
Typed controls submit existing owning-service commands with their request and
revision identity. Feed resync and periodic snapshots refresh evidence without
replaying writes. Nanoleaf/Pixoo settings retain their device-specific meanings;
unknown components expose unavailable controls. No database, reducer, device
writer or physical effect scheduler moves into the browser.

PR #127 records Hub #6's human UI approval and source-delivery evidence.
[#151](https://github.com/jimmie-potts/agent-device-hub/issues/151) adds Pixoo
screen power, brightness, playlist and playback controls to the same view under
ADR 0005: one guarded controller v1 command per control, Monitor gating with an
explicit Media switch through the Pixoo integration mode operation, and no
automatic restoration.
[#153](https://github.com/jimmie-potts/agent-device-hub/issues/153) adds Nanoleaf
power, brightness and saved-scene controls on the capabilities Nanoleaf #64
declares: brightness shown as an override until the next explicit mode command,
scenes gated to an observed Free mode with an explicit Free switch through the
controller v1 mode command, and scene names only from the
`nanoleaf.integration/1.0` snapshot. Installation, physical acceptance and full
editor migration remain separately owned work.

<a id="standalone-mcp-composition"></a>

## Legacy standalone MCP composition

The optional host `/mcp` route composes the reusable transport with the existing state owner and controller clients. It adds no listener, reducer, replay ledger or device writer. Global session tools retain the HTTP command ledger. Configured aliases bind device tools while native snapshots and receipts keep their original identities. Read/control permissions are checked on every request; disconnect never resubmits or cancels admitted owner work. Pixoo catalog/player handlers remain owned by its separate application. See [the host tool contract](../apps/hub/README.md#optional-local-mcp) for supported commands and source-only evidence.
