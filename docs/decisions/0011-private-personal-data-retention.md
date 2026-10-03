# ADR 0011: Retain personal data privately and keep it out of GitHub

Status: accepted direction on 2026-10-03. Runtime adoption requires scoped,
versioned implementation and its own source and installed evidence.
Policy delivery: [Hub #775](https://github.com/jimmie-potts/agent-device-hub/issues/775).

## Context

The owner wants to collect as much data about their own activity as possible,
including content, logs and telemetry. Removing personal information before
private storage defeats that purpose. The owner also requires that collected
personal data stay out of GitHub, including private repositories.

The current setup is one owner, one Windows PC and the existing WSL Hub.
Some released contracts deliberately retain aggregates or fixed diagnostic
metadata only. This decision changes the direction for future work; it does
not claim that those implementations already retain original content.

## Decision

### Collection and retention

For an owner-selected source and collection scope, preserve the available
personal content and context in private local storage. Names, email addresses,
phone numbers, paths, URLs, session/project titles, prompts, responses and
transcripts are not reasons to discard a record or suppress an entire stage.
This applies to logs and telemetry as well as analytics inputs.

Keep original observations and observed revisions when derived features,
normalization, aggregation or a latest-value projection would otherwise lose
them. Derived tables, dashboard rankings and delivery queues may remain bounded;
they are not the retention policy for the underlying observations. Do not
claim to retain a source edit that was never observed or recover data that an
earlier collector already discarded.

Retain collected data until an explicit owner-selected clearing or retention
rule applies. Do not introduce age-based deletion, sampling, severity filtering
or lossy rollups as a privacy default. Identify existing loss separately from
privacy: unsupported source fields, polling gaps, size limits, saturation,
sampling and failed writes all limit completeness. Keep finite resource bounds
and fail-open hooks; make loss visible and qualify durable acceptance before
claiming a complete archive. Capacity pressure must not silently erase retained
observations. Existing explicit opt-out/clear behavior remains supported until
a separately scoped change preserves its meaning and recovery guarantees.

Credentials, authentication tokens, API keys and secrets remain excluded from
analytics and diagnostic capture. Credential stores retain their own protection.
An email address or personal path is not a credential merely because it is
personal. Use the narrowest supported credential exclusion, preserving the
surrounding record where possible; record omissions without copying the secret.
Document detection limits rather than claiming arbitrary prose is secret-free.

### Storage and publication

Keep collected personal data, runtime databases, logs, telemetry, media,
configuration, backups and exports in private owner-controlled storage outside
tracked source and publishable build output. Protect collector-created files
from other local users. Private storage does not defend against the owner or
software already running with the owner's authority.

Do not send collected personal data to GitHub through commits, issue or PR
bodies/comments, attachments, Actions logs/artifacts, releases, Pages or other
repository publication. Repository visibility does not change this rule.
Use synthetic fixtures and a separately prepared, sanitized explanation or
reproduction for development evidence. Keep original evidence privately;
sanitizing a publication copy must not replace or strip the retained original.
Git ignore rules alone do not prevent disclosure through tools or attachments.

### Authorization and integrity

Collection permission, retention, access and onward sharing are distinct.
This direction does not select a new source, enable a reader, expand device or
MCP access, or approve transmission to a model, cloud service or device. Retain
existing supported sharing and explicit collection/sharing choices. Once the
owner has selected a source and scope, routine collection within that choice
needs no repeated approval.

Read owner-selected sources without changing their data or permissions. The
accepted Wispr source-ACL decision is specific to that source: accept its
existing permissions while keeping collector-created files private. Do not
automatically remove another source's qualification or authorization checks;
identify the protected data, excluded actor and concrete failure before
simplifying a requirement for this setup.

Preserve versioned schemas, source identity and provenance, one state owner,
one writer per device, Origin and authentication checks, manual control,
explicit clear semantics and recovery that cannot resurrect cleared content.
Retained history never grants command authority or replays device effects.
These are authorization, integrity, recovery and device-safety controls; richer
private retention is not a reason to weaken them.

## Adoption

This is the authoritative personal-data policy for new planning and delivery.
It supersedes personal-data minimization as a default for private collection.
Released schemas and supported behavior stay in force until their owning
implementation, tests, specifications and procedures change together.

The [diagnostic contract](../observability-contract.md) currently excludes
personal content even from local output. Its replacement must distinguish
private retained evidence from publishable evidence without silently widening
existing exporters or closed schemas. The [event contract](../event-contract.md)
still bounds transport records; bounded delivery does not establish archival
retention. [ADR 0010](0010-shared-event-contracts.md) keeps history separate
from latest-state and notification delivery.

Wispr adoption must address the three-dictation ranking threshold, whole-stage
sensitivity suppression and the lack of retained source text. Removing a
threshold alone does not preserve data already lost at ingestion. Keep source
access read-only and honor separate language collection and Hub sharing choices.

For every affected change, name what is collected and retained, where it is
stored, who can read it, each sharing destination, credential handling, clearing
and recovery behavior, and known loss. Validate with synthetic personal-data
and credential examples; prove that private capture retains personal fields
while publication output excludes them. Use existing components and focused
tests rather than adding privacy modes, principal registries or policy engines.

GitHub issues own implementation order, ownership and acceptance. The separately
coordinated Wispr installation in
[#472](https://github.com/jimmie-potts/agent-device-hub/issues/472) retains its
owner and scope; this decision neither takes it over nor reports it complete.

## Consequences

Private archives become more useful and more sensitive. They need storage,
backup, recovery and export handling appropriate to their actual contents.
The owner gives up the assurance that local records contain only aggregates
or nonpersonal metadata. Protection rests on private access and controlled
publication, with credential protection retained.

The policy grants no new host, service, installation, personal-setting change,
source read or device command. Reassess these assumptions when another operator,
remote service or sharing destination is actually selected.
