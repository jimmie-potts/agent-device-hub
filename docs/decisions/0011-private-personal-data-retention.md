# ADR 0011: Retain personal data privately and keep it out of GitHub

Status: accepted direction on 2026-10-03; amended on 2026-10-05 (see the
[amendment](#amendment-2026-10-05)) and on 2026-11-11, with four cases added
on 2026-11-12 (see the [amendment](#amendment-2026-11-11)); amended on
2026-11-12 with an owner-selected retention rule for repeated readings in core
history (see the [amendment](#amendment-2026-11-12)). Runtime adoption
requires scoped, versioned implementation and its own source and installed
evidence.
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

One owner-selected retention rule applies to core history's repeated readings
(2026-11-12, see the [amendment](#amendment-2026-11-12)). A stretch of state
readings that differ only in declared bookkeeping members is kept as a span:
its first confirmation, its last confirmation, the count of readings and, for a
polled record that falls silent for too long, a gap row. Each repeated
reading's own time and other bookkeeping values, such as the page a Pixoo
status picture showed, are not kept. The rule applies once
[#1772](https://github.com/jimmie-potts/agent-device-hub/issues/1772) is merged
and installed; until then history keeps what it keeps today.

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
retention. [ADR 0012](0012-bunny-event-platform.md), which superseded ADR 0010,
keeps history separate from latest-state and notification delivery.

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

## Amendment, 2026-10-05

The owner decided the following on 2026-10-05:

- Retained personal data may be included in prompts or other information sent
  to Claude and Codex. For those two assistants, this replaces the statement
  above that this direction does not approve transmission to a model. Any other
  model, cloud service, device or sharing destination still needs its own
  decision.
- New work needs no clearing, erasure or retention-expiry features. Capture
  as much as the owner-selected sources provide, and keep it in private
  owner-controlled storage.
- Existing explicit opt-out and clear behavior keeps its current meaning. The
  rule above that it remains supported until a separately scoped change
  preserves its meaning still applies.
- Existing collection and sharing choices still apply. This amendment selects no
  new source or reader.
- The GitHub boundary is unchanged. So is the exclusion of credentials,
  authentication tokens, API keys and secrets.

[ADR 0012](0012-bunny-event-platform.md) applies this policy to the B.U.N.N.Y.
message platform. Its event profile 2.0 carries personal fields that profile 1.0
excluded.

## Amendment, 2026-11-11

The owner decided the following on 2026-11-11, in chat to the coordinating
session, while answering the questions recorded in the design record
[#1728](https://github.com/jimmie-potts/agent-device-hub/issues/1728):

- At 17:13:47Z the owner answered question 3 of round 1, which recommended the
  lists below without their email and calendar lines and without the four cases
  settled on 2026-11-12, with "Let's stick with your recommendation as well."
- At 17:34:59Z the owner accepted the recommendation on question 15 of round 3,
  email and the calendar as counts and flags only, in the words "The
  recommendations for the rest of round 3."

On 2026-11-12 the owner settled four cases those words left open. The round 1
review of PR [#1741](https://github.com/jimmie-potts/agent-device-hub/pull/1741)
found them, and the coordinating session put them with a recommendation as
decision 1 of seven. At 00:36:12Z the owner answered, in chat to the
coordinating session, "For the decisions waiting on me, for all 1, 2, 3, 4, 5,
6 of those, 7 of those, your recommendation is good for all 7." The accepted
recommendations:

- an agent's latest response text: not sent;
- a session's title or label: may be sent;
- the name of a file being edited: not sent;
- an art idea the owner types: may be sent;
- a device's name as the owner labelled it: may be sent.

The decision for B.U.N.N.Y.'s decision maker, with those cases included:

- **Destination and purpose.** The classes below may be sent to OpenAI's
  Decisions endpoint as input to a decision by B.U.N.N.Y.'s decision maker.
  For that endpoint and purpose, this replaces the statement above that this
  direction does not approve transmission to a model or cloud service. Nothing
  else about OpenAI changes: the art module's use of OpenAI's Image API to draw
  stays as it was, and no other OpenAI endpoint or product is covered, apart
  from the delivery orchestrator's decision step below.
- **May be sent:**
  - agent session states, without prompts or transcripts, including a
    session's title or label (2026-11-12);
  - device states, including a device's name as the owner labelled it
    (2026-11-12);
  - the mode;
  - the time and what is scheduled;
  - weather;
  - art catalog details and the owner's art feedback, and an art idea the owner
    types (2026-11-12);
  - room-level presence, once it exists;
  - email and the calendar as counts and flags only, for example "3 unread,
    1 from a starred sender" or "a meeting in 10 minutes".
- **Not for now:**
  - Wispr speech data;
  - Volcano sessions;
  - any transcript;
  - anything recorded;
  - senders, subjects, event titles or content from email and the calendar;
  - an agent's latest response text and the name of a file being edited
    (2026-11-12).

To decide whether a given fact may be sent, check all three: it is in the
"may be sent" list; it is going to the Decisions endpoint as input to a
decision; and it does not fall under "not for now". Anything else needs the
owner's own decision.

The delivery orchestrator's decision step: at 2026-11-11T17:56:35Z, in chat to
the coordinating session, the owner answered question 3 of the orchestrator's
design record [#1722](https://github.com/jimmie-potts/agent-device-hub/issues/1722)
with "Your recommendation." That record states the decision as: "The
personal-data decision is extended to the OpenAI API for the delivery
orchestrator's decision step, limited to issue text and repository facts".
That decision covers nothing else.

What does not change:

- Existing collection and sharing choices still apply. This amendment selects
  no new source and starts no collection; email, the calendar and presence are
  not collected today.
- The GitHub boundary is unchanged: nothing personal goes to GitHub.
- The hold on ambient recording and passive transcription
  ([#642](https://github.com/jimmie-potts/agent-device-hub/issues/642)) stands.
- Prompt, response and transcript capture stays under
  [Hub #425](https://github.com/jimmie-potts/agent-device-hub/issues/425).
- Claude and Codex remain as the 2026-10-05 amendment left them.

## Amendment, 2026-11-12

The owner decided the following on 2026-11-12, in chat to the coordinating
session, while answering decision 2 of the design record
[#1768](https://github.com/jimmie-potts/agent-device-hub/issues/1768). At
15:24:52Z the owner answered "Yes to decisions 1 and 2 and go for the replay."
Decision 2 asked whether a first confirmation, a last confirmation and a count
are enough for a stretch of repeated readings, without each repeat's own time.

The owner-selected rule, for core history:

- **Kept:** every reading that changes a member other than a declared
  bookkeeping member writes a history row, as before. A stretch of readings
  that differ only in bookkeeping members is kept as its first confirmation,
  its last confirmation and the count of readings. For a record family that
  publishes on a poll, a silence longer than four times its polling interval,
  and at least two minutes, is kept as a gap row (decision 4, answered at
  15:48:22Z).
- **Not kept:** each repeated reading's own time and other bookkeeping values
  within a stretch, such as the page a Pixoo status picture showed.
- Bookkeeping members are declared per state family. Under the design in
  #1768, safety members are never bookkeeping, and story
  [#1771](https://github.com/jimmie-potts/agent-device-hub/issues/1771) is to
  refuse them. The session record's times stay rows for now (decision 6, answered at
  15:48:22Z).

[ADR 0012's amendment of 2026-11-12](0012-bunny-event-platform.md#amendment-2026-11-12)
records the rule and the other decisions. The rule applies once
[#1772](https://github.com/jimmie-potts/agent-device-hub/issues/1772) is merged
and installed; until then history keeps what it keeps today.

What does not change:

- History keeps no time limit. Time limits and purge are held by the owner
  (direction of 14:53:16Z: "We can hold off on the time-to-live record").
- Rows already stored are left as they are, and are looked at again after the
  re-measurement ([#1774](https://github.com/jimmie-potts/agent-device-hub/issues/1774))
  (decision 5, answered at 15:48:22Z).
- Removals, occurrences, outcomes and the steps of tracked actions are kept as
  before.
- Every other rule of this record stands, including the exclusion of
  credentials, authentication tokens, API keys and secrets, and the GitHub
  boundary.
