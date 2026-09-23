# Shared architecture

Status: Accepted direction. Controller contracts, reusable MCP, and the shared
agent-state package with source emitters are implemented. Production collector
hosting, device-feed adoption and standalone hosting remain in the backlog.
The fresh Nanoleaf Linux runtime has merged source in
[Nanoleaf PR #57](https://github.com/jimmie-potts/codex-nanoleaf/pull/57), revision
`2558df5a2fc543247b0c75898ef0260ba3ea264b`. Installed acceptance remains open
under [Nanoleaf #55](https://github.com/jimmie-potts/codex-nanoleaf/issues/55),
and [Hub #43](https://github.com/jimmie-potts/agent-device-hub/issues/43) retains
coordination and documentation of that outcome.

The [BUNNY HTML system design](system-design/index.html) expands these boundaries
into component documents, complete flows, deployment designs and open decisions.
It links existing contracts and issues without replacing their authority.

## Product direction and vocabulary

[ADR 0004](decisions/0004-local-first-personal-assistant.md) records the accepted
local-first assistant direction. Preserve the Codex-first milestone before
general device controls and Apple Music integration. Container migration and
remote voice access remain later work.

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

## Ownership

The hub owns provider qualification, shared event/session contracts, one
authoritative agent-state core, common controller contracts, shared MCP
infrastructure and the future cross-device dashboard.

Pixoo owns its media library, renditions, player, 64x64 status renderer,
Monitor/Media policy and serialized device writer. Nanoleaf owns its Python
light-writing worker, geometry, Line allocation, spatial effects,
Work/Quiet/Free policy, scene restoration and advanced wall editor. The legacy
installation runs on Windows. Delivered source supports a fresh installation of
those Nanoleaf processes and private state in Ubuntu WSL without transferring
repository ownership. Installed Linux behavior remains unverified under Nanoleaf
#55. Common code must not import a device application's internal modules.

Tidbyt owns its 64×32 renderer, backend connection and serialized display writer.
LIFX owns bulb capability mapping, LAN transport, lighting policy and per-device
queues. These new controllers belong in this repository. Their documentation
exists; their implementations remain in the backlog. The shared core interprets
agent observations once, and each controller maps shared state to its device.

Shared agent methods stay in agent-skills. Hub development tooling will own the
versioned reusable OpenSpec validation package; device repositories own adoption,
their tests, policies and capability specifications.

## Agent observation and commands

Provider emitters send small validated lifecycle observations to the active state
owner. Codex Desktop, Codex CLI and Claude Code remain distinct compatibility
targets. Qualification must record documented, observed, unsupported and unknown
signals for actual accessible versions.

The core identifies sessions by provider, source/host and session ID, retaining
turn and child relationships only where evidenced. Separate sessions in one
project stay separate. Activity, attention, retained notices, acknowledgment,
optional provider read evidence and freshness are independent concepts.

A turn end is not proof of successful work or readership. Nanoleaf's current
Codex unread reconciliation remains a provider/consumer capability during
migration. Pixoo dismissal changes monitor state only. New generic consumers
must not assume every provider supplies read receipts.

Only lifecycle metadata, identifiers, timestamps and explicit user-chosen labels
enter the shared feed. Neutral IDs are the fallback. Prompt text, transcripts,
tool arguments/results, automatically copied titles, credentials and unrelated
private paths are excluded before transmission and persistence. Existing local
Nanoleaf metadata cannot silently become shared data.

Hooks remain bounded, observational and fail-open. Device/collector failure must
not deny an agent action, change permissions or hold work waiting. MCP is the
separate deliberate command interface. Its tools call the same services as the UI.

## Controller boundary

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

## Fresh Nanoleaf Linux runtime, source delivered

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

This is a fresh installation. Existing Nanoleaf state need not move into Linux,
and the old installation can remain unused. Source issue #54 delivers setup,
service units and verification with fake devices. The installed-acceptance issue
separately owns retirement of this project's Windows writer, real WSL client and
service checks, browser reachability and physical Work/Quiet/Free observations.
This source delivery does not establish an installed Linux system. #55 must record those observations
before Hub #43 can close.

This transition excludes data migration, rollback tooling, a combined daemon, a
new hook HTTP API, shared monitoring and the Nanoleaf monorepo move. WSL service
availability follows the WSL instance lifetime. Shared monitoring and later
source migration keep their existing owners and dependency paths.

## Repositories, packages and hosting

Use this repository as the monorepo for new controllers and shared packages,
as recorded in [ADR 0003](decisions/0003-device-controller-monorepo.md).
The existing Pixoo and Nanoleaf repositories retain ownership until separately
delivered migrations. Use TypeScript for new shared services, Tidbyt/LIFX/PC
lighting controllers and the React dashboard; keep the Nanoleaf worker in Python.
Qualify the native Windows helper needed by PC lighting separately.
Share JSON contracts and fixtures across languages and implement the shared
status interpreter once.

Implemented shared packages are packages/contracts, packages/mcp, packages/agent-state
and the pure packages/lifecycle-contracts validators. The [lifecycle contract](agent-lifecycle-contract.md)
and [provider matrix](provider-qualification.md) establish metadata and source evidence,
without claiming installed producer qualification. Provider normalizers and bounded
emitters live in packages/agent-state/src/providers.ts; the silent source hook is
packages/agent-state/bin/hook.mjs. The remaining proposed layout is
adapters/nanoleaf, adapters/pixoo,
apps/hub, apps/dashboard, controllers/tidbyt, controllers/lifx and
controllers/pc-lighting. The controller directories contain documents only;
the other paths remain proposed.
Use Node 24 and npm workspaces when executable packages are introduced.
Publish versioned private artifacts when a separate consumer needs
them; avoid worktree-relative imports and unnecessary independent packages.

The [agent-state API](../packages/agent-state/README.md) owns deterministic
reduction, immutable snapshots, independent consumer queues and versioned
export/import. Its host storage boundary requires an exclusive lease and atomic
revision-checked commits. Current records, chosen labels and notices survive
journal retention. The journal retains the newest 10,000 events within 24 hours,
with pruning on writes, startup and an idle timer. The in-memory reference store
is a test adapter; Pixoo #31 supplies production durability and access controls.
Observation age and restart uncertainty remain separate from collector health.
The core sends no device commands, regardless of Media/Free modes.

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
and [installed update procedure](../apps/hub/SETUP.md#update-the-current-status-package).

The MCP module exports an HTTP handler and configured service/tool registration.
The owning application enables and mounts it; the module never opens a listener
or starts another device writer. Shared controller tools preserve API 1.0 request
tickets, revisions and receipts. Strict registered application extensions can use
an existing app request_id and catalog/player result without changing that wire
contract. Both paths retain fixed configured targets, current read/control scopes,
bounded authentication and response delivery, and no automatic write retries.
See [the MCP module](../packages/mcp/README.md) for its API and evidence boundary.

First, Pixoo embeds the core in its existing backend. Nanoleaf can opt into that
versioned shared feed while retaining its existing device worker and
Work/Quiet/Free behavior. The legacy route uses the Windows worker. The
delivered fresh Linux installer supports moving that owner into WSL independently
of shared monitoring. A later hub host composes the same core and connects to
both existing controllers.

Moving the state owner is explicit and quiesced. Preserve source identities,
session/notice state, revisions and producer configuration with a versioned
export/import and rollback. Pixoo's session-source facade switches its renderer,
browser feed and shared label/acknowledgment operations to the selected owner.
Remote mode never starts a second local reducer; a stale feed stays visibly stale
until recovery or explicit rollback. Never run embedded and standalone owners
against the same state simultaneously. Controller databases stay private; Windows/WSL
processes do not coordinate through a mounted SQLite database.

Legacy Nanoleaf hooks remain available until an authorized verified cutover.
Only one selected ingestion path updates each session. Shared-input consumers
can cache presentation state; they do not become independent status authorities.
Loss of the hub has a documented recovery/rollback path and never blocks agents
or ordinary media use.

Deferred [Pixoo source migration #25](https://github.com/jimmie-potts/agent-device-hub/issues/25)
and [Nanoleaf source migration #26](https://github.com/jimmie-potts/agent-device-hub/issues/26)
will settle provenance, active work, source ownership and package layout before
moving code. Repository consolidation does not combine runtimes, install
services, transfer private databases or switch the active state owner.

## Unified UI and additional devices

The first dashboard shows sessions, attention, freshness, capabilities, device
modes, pending changes and last update outcomes, with explicit supported controls.
It links to existing advanced editors. A global mode must not silently replace
Nanoleaf Work/Quiet/Free or Pixoo Monitor/Media intent.

The shared frontend in apps/dashboard is BUNNY's central interface. It uses
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
is declared capability times existing control scope. The bounded issues are in
the [roadmap](roadmap.md#general-device-controls).
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

## Tidbyt and LIFX delivery

Automatic agent status is the first feature priority for these new controllers.
Qualify their connections, implement fake-backed controllers, then consume the
core initially hosted inside Pixoo. Standalone hosting remains a later state-owner
migration. Source status integration does not wait for a dashboard or new MCP
tools. Full installed lifecycle acceptance depends on the reversible producer
setup in [#8](https://github.com/jimmie-potts/agent-device-hub/issues/8).
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

Automatic status consumes the shared core initially hosted in Pixoo. It does not
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
preserving ordinary behavior elsewhere. This local path does not wait for shared
monitoring, general controls, Music or model calls. Preserve vendor mappings and the
existing CHOMPI bridge; its MIDI bindings do not establish 8BitDo/profile support.

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

Moving the existing controllers now would couple this bootstrap to Windows
installation, active feature work and physical revalidation. Start new controllers
in the monorepo and defer the existing source moves to their own issues.

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

## Standalone host candidate

The active Hub #5 change under `apps/hub` targets native Linux in WSL, following
the owner's September 21 decision. Native Windows runtime qualification is
outside that delivery. The application composes the existing shared core and
uses authenticated configured controller endpoints. Its private store never
opens a controller database. This is an unmerged candidate; migration, final
controller integration and performance acceptance remain tracked by #5 and #30.
The delivered Pixoo embedded owner remains the production source baseline.


## Linux host handoff implementation

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

## BUNNY frontend, Hub #6

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
automatic restoration. Installation, physical acceptance, Nanoleaf general
controls and full editor migration remain separately owned work.

## Standalone MCP composition

The optional host `/mcp` route composes the reusable transport with the existing state owner and controller clients. It adds no listener, reducer, replay ledger or device writer. Global session tools retain the HTTP command ledger. Configured aliases bind device tools while native snapshots and receipts keep their original identities. Read/control permissions are checked on every request; disconnect never resubmits or cancels admitted owner work. Pixoo catalog/player handlers remain owned by its separate application. See [the host tool contract](../apps/hub/README.md#optional-local-mcp) for supported commands and source-only evidence.
