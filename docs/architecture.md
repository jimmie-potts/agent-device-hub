# Shared architecture

Status: Accepted direction; implementation remains in the linked backlog.

## Ownership

The hub owns provider qualification, shared event/session contracts, one
authoritative agent-state core, common controller contracts, shared MCP
infrastructure and the future cross-device dashboard.

Pixoo owns its media library, renditions, player, 64x64 status renderer,
Monitor/Media policy and serialized device writer. Nanoleaf owns its Windows
worker, geometry, Line allocation, spatial effects, Work/Quiet/Free policy,
scene restoration and advanced wall editor. Common code must not import a
device application's internal modules.

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

## Repositories, packages and hosting

Retain the two device repositories. Use TypeScript for new shared services and
the React dashboard to fit the Pixoo stack; keep the Nanoleaf worker in Python.
Share JSON contracts and fixtures across languages and implement the shared
status interpreter once.

The proposed layout is packages/contracts, packages/agent-state,
integrations/codex, integrations/claude, adapters/nanoleaf, adapters/pixoo,
apps/hub and apps/dashboard. These are planned boundaries, not implemented
packages. Publish versioned private artifacts when a separate consumer needs
them; avoid worktree-relative imports and unnecessary independent packages.

First, Pixoo embeds the core in its existing backend. Nanoleaf can opt into that
versioned shared feed while retaining its current Windows worker. A later hub
host composes the same core and connects to both existing controllers.

Moving the state owner is explicit and quiesced. Preserve source identities,
session/notice state, revisions and producer configuration with a versioned
export/import and rollback. Never run embedded and standalone owners against the
same state simultaneously. Controller databases stay private; Windows/WSL
processes do not coordinate through a mounted SQLite database.

Legacy Nanoleaf hooks remain available until an authorized verified cutover.
Only one selected ingestion path updates each session. Shared-input consumers
can cache presentation state; they do not become independent status authorities.
Loss of the hub has a documented recovery/rollback path and never blocks agents
or ordinary media use.

A future monorepo is an option if most features routinely span the hub and
controllers. Repository consolidation does not require combining runtimes.
There is no repository move or device rewrite in this decision.

## Unified UI and additional devices

The first dashboard shows sessions, attention, freshness, capabilities, device
modes, pending changes and last update outcomes, with explicit supported controls.
It links to existing advanced editors. A global mode must not silently replace
Nanoleaf Work/Quiet/Free or Pixoo Monitor/Media intent.

Exact previews arrive only after the device rendering contracts and parity
checks. The overview does not wait for Nanoleaf live mirroring, Lively, an ambient
redesign or new Pixoo player UI. Those remain separately owned work.

Evaluate Home Assistant/MQTT for ordinary new device integrations before writing
custom transports. Adoption is deferred pending a capability assessment.
Generic device support does not establish custom animation fidelity. Home
Assistant must delegate to an existing writer or use an explicit ownership handoff.

## Alternatives and consequences

Copying the Nanoleaf reducer into Pixoo would duplicate provider assumptions and
couple new clients to Codex-specific read behavior. A single shared core avoids
that drift, at the cost of explicit package/API compatibility and state-owner
migration work.

An immediate runtime rewrite or repository consolidation would couple this
planning work to Windows installation, state migration and physical revalidation.
Keeping controllers intact allows shared status and a useful UI first.

MCP remains reusable infrastructure with device registrations. Pixoo may retain
an opt-in local endpoint through the same module; the future gateway adds device
identity. Neither endpoint creates a second writer.

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
