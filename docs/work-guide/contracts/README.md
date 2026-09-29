# Guide records contract

Version `guide-records/1.0`. Owning work:
[Hub #543](https://github.com/jimmie-potts/agent-device-hub/issues/543).
The JSON schema, this dictionary and the offline reference/fixtures are one
definition. Approval is recorded against their exact digest in the delivery PR;
the version string alone is not proof of approval. No production consumer imports
these files in this delivery.

## Boundary and ownership

The Hub guide adapter produces a validated dataset from the three repositories'
GitHub records and authored guide inputs. The ordinary renderer reads those
records without inference. The protected query endpoint constructs the public
projection for Jev. Jev selects references; it does not read GitHub, author facts,
compute dependency counts, assign workflow status or change source records.

The canonical machine shape is [guide-records.schema.json](guide-records.schema.json).
[reference.mjs](reference.mjs) is an offline, side-effect-free reference for
validation, evidence gates, public projection and inverse dependency sets. It is
not a production normalizer, endpoint, renderer or provider adapter. The adapter
and inventory audit belong to #511; the fixture checks do not qualify that work.

Properties are required except optional diagnostic `producerRevision`; nullable
values and state-bearing objects express unavailable content. An empty array
means a known empty selection or collection; `null` means unknown. Extra fields and
unsupported schema versions are rejected rather than silently discarded.

## Field-source dictionary

The table names every field or repeated field group. JSON Schema owns exact
types and allowed values; the rules below own provenance, precedence and use.
Sources must be HTTPS GitHub API or document references, never local paths.

| Field | Source and update owner | Meaning, precedence and unavailable behavior |
| --- | --- | --- |
| `schemaVersion` | This definition; contract owner | Exactly `guide-records/1.0`. An unknown version blocks composition. |
| `producerRevision` | Guide adapter build | Optional full source commit for diagnostics. Omission does not block browsing or search; parser/version checks still apply. |
| `datasetId` | Guide adapter, generated automatically | SHA-256 content identity using the canonical algorithm below. Meaningful source or public-selection changes replace it; routine fetch times do not. It is not a freshness claim. |
| `publicationPolicy` | Adapter configuration | Null or `{id, source}` identifying the explicitly authorized public-data policy evaluated for this dataset. Null disables inference projection. This is configuration, not an issue field. |
| `repositories[].name`, `scope` | Adapter's configured inventory | Exactly Hub, Nanoleaf and Pixoo are `primary`. External prerequisite repositories are `reference`, excluded from primary counts. Names are GitHub `owner/repository`, never display labels. |
| `repositories[].inventory` | Paginated REST `GET /repos/{owner}/{repo}/issues?state=open`, with PRs excluded and independent inventory reconciliation | Per-repository evidence. Its primary item count covers all open issues. Retained closed references come from explicit issue reads and do not increase that count. A limited reference repository describes only explicitly read references, not its whole backlog. Missing pages never establish a complete primary inventory. |
| `issues[].id`, `repository`, `number`, `nodeId`, `url` | REST issue `number`, `node_id`, `html_url`; repository identity from the response/request | `id` is `owner/repo#number`, with the exact matching URL. `nodeId` preserves GitHub identity across a transfer/rename. A rename/transfer needs explicit reconciliation and a new dataset; do not merge conflicting identities. Guide aliases H/N/P are presentation aliases only. |
| `title`, `body` | REST `title`, `body`; issue author | Preserve source text. `body: null` means absent/unavailable, not an invented summary. The body stays application-side. |
| `state`, `stateReason` | REST `state`, `state_reason`; GitHub issue state | State normalizes to `OPEN`/`CLOSED`; reasons retain lower-case `completed`, `not_planned`, `reopened`, `duplicate` or null. Only `completed` supports the Completed display. Unknown reasons are not coerced to completed. |
| `createdAt`, `updatedAt`, `closedAt` | REST `created_at`, `updated_at`, `closed_at` | UTC source times. Open records have no closure time and only null/reopened reason. A missing closed timestamp/reason remains unknown; closed does not prove installation. |
| `labels` | Native REST `labels[].name`; issue maintainers | Preserve exact labels. Open delivery work needs one of backlog, ready, in-progress or review with the `status:` prefix. Missing/conflicting status withholds readiness. `blocked` and `deferred` remain separate gates. Other labels remain descriptive. |
| `facts` | Issue GET or saved issue entry, with its original fetch receipt; adapter | Evidence for this issue's facts. A new fetch of other records does not renew it. An inaccessible issue with no prior record is a fetch diagnostic, not a fabricated issue. Retained records carry stale/failed evidence. |
| `story.{outcome,implementation,protections,acceptance,deferrals}` | Five authored feature sections; `story_sections._sections` and the alias table below | Each has `state`, actual `heading`, literal `text`, `source`, `parser` and `reason`. The producer records the heading it parsed. Missing/duplicate/unsupported sections retain the issue and withhold implementation readiness. |
| `guide.{state,topic,note,workaround,highlight,extends}` | `## Guide` through `guide_section.read`; story author | Same strict grammar as the guide. `topic` uses `guide_paths.TOPICS`; highlight has `kind` and literal `reason`. Normalize H/N/P references to canonical IDs. Extends is allowed only for ideas and never becomes a prerequisite. Invalid/missing placement carries a reason, not a guessed topic. |
| `guide.source`, `parser`, `reason` | Issue URL and pinned producer implementation | `guide-section/1` identifies this contract's existing parser semantics; the adapter may record its source revision in optional `producerRevision`. Assigned values must come from the body at `updatedAt`. |
| `parent`, `children`, `blockedBy` | REST `/issues/{n}/parent`, `/sub_issues`, `/dependencies/blocked_by`, or equivalent native GraphQL fields | Each is `{ids, evidence}`. Parent has at most one ID. A verified absent parent is `[]`; a permission/read failure is unknown. Prose links and `Extends` never populate these fields. Collections retain their own observation and pagination receipts. |
| `planning[]` | Existing `recommendations.read`/`ratings`, or explicit source links to acceptance/closeout evidence | Required array of optional evidence; empty does not prove no planning exists. Each entry has `kind`, `state`, `source`, `parser`, `sourceUpdatedAt`. Kinds separate assessment, execution, delivery, installation and physical evidence. Current parsed execution uses its existing fingerprint check. Unsupported or outdated records remain visibly unknown/stale. Link-only entries do not establish their contents or success. No new prose parser is introduced here. |
| `publicFields` | Adapter evaluation of `publicationPolicy` | Computed allowlist of field paths safe to share from this issue at this revision. Empty means no eligible public text. Reevaluate on every content change; no per-issue human receipt or new authored section is required. |
| `subguides[].id`, `kind`, `topic`, `title` | Authored topic/track/section identifier and label in `guide_paths.py` or another explicitly named guide input | Kind is topic, track or section. Preserve existing IDs, never invent model categories. Where an existing named track lacks a stable authored ID, adapter audit must establish an authored ID or retain an explicit gap; a guessed slug is not authoritative. |
| `subguides[].members` | Topic membership from valid Guide sections; authored track/section selections from `GUIDE_TRACKS` or named section input | Canonical issue references, not copied facts. Each reference resolves in the dataset. A reference view never increments issue totals. Topic and selected-track membership are different scopes. |
| `subguides[].outcome`, `nextStep` | `TOPICS`/`PATHS` outcome and next-action prose, or explicit authored section | Literal authored text; nullable when absent. Never generated to fill a gap. |
| `subguides[].source`, `revision`, `asOf`, `owner` | Exact guide input at a full Git commit, authored date and named maintainer | Editorial provenance is independent of GitHub observation time. If date/owner/ID is absent from existing inputs, the adapter audit reports the gap rather than borrowing a live fetch time. |
| `subguides[].publicFields` | Adapter evaluation of `publicationPolicy` | Computed allowlist for the current authored revision; only title/outcome/nextStep may be selected. Empty excludes its text from inference. |

Observation objects use `source`, `observedAt`, `state`, `complete`, `reason`
and `pagination`. States are fresh, stale, unknown or failed. Fresh means a
successful observation, but the consumer must still check its age at use.
Unknown/failed is never complete. Non-fresh or incomplete evidence has a reason.
Pagination is null for a non-collection or unknown fetch; otherwise it records
`pages`, `itemCount`, `totalCount` (nullable if the API supplies none), and
`hasNextPage`. Complete collections require terminal pagination and matching
available counts. Empty successful collections record a page with zero items.
The adapter verifies the receipt against all pages; a boolean supplied by a model
or user query is not a receipt. Schema/reference checks cannot prove a fetch ran.

Source precedence is field-specific: native GitHub facts and relationships win
for their fields; parsed authored sections win for scope and placement; authored
guide files win for editorial prose. Dated editorial text cannot override a
current native blocker. Conflicting authoritative observations must be refreshed
or reported as unknown; do not select the value that makes work ready.

Explicit priority is read from native labels using the existing
`guide_status.overview_keys` `p0`–`p4` / `priority:p0`–`priority:p4` convention.
No label means unspecified. Multiple distinct priorities are a visible conflict
for priority claims, even though the existing overview sorts by the minimum.
Model relevance is a query-specific ordering and never changes source priority.
There is no new capability/domain taxonomy: queries use topics, native labels
and approved authored text first. A demonstrated gap needs a separately reviewed
vocabulary and editing/validation rule before adding such a field.

## Story parsing and provenance

Use the existing fence-aware Markdown section engine. Headings inside code
blocks are not sections. Exact supported level-two headings are:

| Record section | Current heading | Legacy alias |
| --- | --- | --- |
| outcome | Outcome and real setup | Outcome and scope |
| implementation | Smallest useful implementation | none |
| protections | Behavior and protections to preserve | none |
| acceptance | Observable acceptance and planned evidence | Acceptance criteria |
| deferrals | Meaningful deferrals | none |

Current and legacy headings together are a conflict, not a precedence shortcut.
The former `Dependencies` and `Verification and delivery target` headings remain
source text/link evidence; they are not substitutes for implementation or
protections. Do not synthesize missing sections. Placeholder acceptance (for
example TBD, TODO, Pending, N/A or None alone) cannot establish readiness.
New stories use the current template. A legacy record stays browsable until its
owner deliberately refines it. Record `story-sections/1` as the parsing rule and
retain the exact source body/update time for audit.

The reference validator checks shape and cross-record invariants; the producer
must separately verify that parsed fields equal the owning source/parser output.
The fixtures exercise the current Guide parser and topic vocabulary to detect
drift. Unsupported changed grammars require an explicit version decision.

## Evidence required by operation

| Operation | Required evidence | Missing evidence |
| --- | --- | --- |
| Ordinary browsing | A structurally valid identity and retained source facts | Show source-linked gaps, unknown status and dated facts. Optional planning metadata does not remove an issue. Unparseable transport input is quarantined with a diagnostic; retain the last validated/full guide. |
| Semantic discovery | Known record references and public fields selected under the configured policy | Omit ineligible text from inference; keep its record in Full guide. Relevance does not imply readiness. Dated public content may be discovered only with its age visible in the application. |
| Prerequisite answer | Fresh issue facts and complete fresh native dependency observations for the reachable active path, including referenced issue facts | Withhold a complete path/no-blockers claim and link the missing evidence. A closed prerequisite ends the active path. A cycle is reported. Observed partial edges may be displayed as partial. |
| Ready-work recommendation | Prerequisite evidence, one explicit ready status, open state, no blocked/deferred/idea/later/decision hold, assigned topic and usable five-section scope | Withhold the recommendation with reasons. A source gate is necessary evidence, not permission to start installation or perform contract adoption. Human approvals and other issue-specific checkpoints still apply. |
| Exact dependent counts | Fresh complete primary inventory and fresh complete native blocker/fact records for every open primary issue | Return unknown counts, not zero or a model estimate. Compute direct and transitive sets in code, count each open issue once, stop through closed nodes and exclude external repositories. |

Consumers supply a named freshness policy with `asOf` and positive `maxAgeMs`;
this root definition does not invent an operational TTL. A request cannot choose
its own more permissive policy. #544/#546 must bind the selected endpoint policy
before adoption. The fixtures use five minutes solely as a synthetic example.
Future observations, expired observations and independently stale dependencies
cannot qualify a current readiness claim.

## Read-only interface and public projection

The adapter interface is conceptual and transport-independent:

```typescript
type ReadGuideRecords = (input: {
  schemaVersion: 'guide-records/1.0';
  expectedDatasetId?: string;
}) => Promise<
  | { kind: 'records'; dataset: GuideRecordDataset }
  | { kind: 'unavailable'; source: string; reason: string }
>;
```

`GuideRecordDataset` is exactly the canonical JSON schema plus these semantic
rules. The adapter returns a snapshot or a read diagnostic. Content identity can
remain unchanged across snapshots with renewed observations. It exposes no
write, provider or device capability. Renderer and protected endpoint consume
the same dataset identity. The endpoint validates records before constructing
model input; authentication and query shape remain with the request contract.
Failed reads retain the previous validated full guide with its original dates.

### Stable content identity

The reference `datasetIdentity` algorithm hashes UTF-8 canonical JSON with a
`sha256:` prefix. It excludes only root `datasetId`, optional `producerRevision`,
and each repository/issue/relationship observation's `observedAt` and pagination
`pages`. All other content, evidence states/completeness/counts, source references,
authored dates/revisions, issue update times and public-policy selections remain
covered. Object keys sort by JavaScript string order; arrays are unordered
collections in this schema and sort by their recursively canonical JSON strings.
Scalars use JSON serialization. The reference function is the canonical algorithm;
other-language producers must match it using compatibility fixtures.

Validation recomputes this identity. A title, section, membership, relationship,
policy or eligibility change cannot reuse the prior identity. A routine refresh
with identical contents can. Producer metadata and fetch receipts are not fields
for issue authors to maintain. Assembly time belongs in diagnostic logs, outside
these records. Consumers check observation times against their trusted clock and
freshness policy at use, including again when accepting an asynchronous result.
A matching identity alone never establishes current facts or readiness.

### Compact catalog for Jev

The projection contains `schemaVersion`, `datasetId`, and arrays of issues and
sub-guides. Each entry has an `id`, selected `fields` and `truncatedFields`.
Sub-guides also have `members` restricted to included issue IDs. The endpoint
passes every eligible entry in the relevant dataset to Jev; this definition adds
no keyword prefilter. Jev can select or score these references; application code
validates the result and builds the view from its full records.

Start with existing title, Guide topic/note and outcome/implementation/deferrals
text when the public policy permits them. The last two distinguish what a story
does from adjacent work it explicitly excludes. Existing labels, state, closure
reason, Workaround, protections and acceptance text are also allowed when needed
and authorized. No new capability tags or human-written search summaries are
required. The adapter audit in #511 must check representative real stories for
missing distinctions before proposing any additional authored fields.

Each selected string contributes its first 320 Unicode code points, with its
field path listed in `truncatedFields` if longer. Values are literal excerpts;
the application retains complete sections. Arrays such as selected native labels
retain their full values. IDs remain intact. Dates, URLs, parser receipts,
revision diagnostics and dependency graphs stay application-side, where code
uses them to display provenance and verify factual claims. A clipped deferral
cannot establish that nothing else is excluded; an absent field cannot establish
absence of the capability. Discovery expresses relevance, never readiness.

This is a compact content projection, not a provider request or a global token
budget. #547/#546 own actual payload limits, typed questions and behavior when
the complete eligible catalog does not fit. They must disclose limited coverage
or decline the query rather than silently replacing the catalog with a keyword
shortlist. The application also reports omitted records and incomplete source
inventory from the local dataset; “all entries supplied” does not imply “all
GitHub issues were successfully read.”

The adapter evaluates the configured policy against the current source content
on every refresh. The policy must explicitly authorize source repositories,
selected public planning fields and content screening/exclusion rules. Bind its
source to an immutable revision and change its ID when those rules change. Merely
having an allowed field name or living on GitHub does not establish public-data
eligibility. Missing configuration, unassessed text or failed screening yields
empty selections, with ordinary browsing retained. Routine updates satisfying
that policy require no new human sign-off. Choosing the production policy and
implementing its evaluation belong to #511 and the protected endpoint; this draft
approves no live outbound sharing. The reference validates selections and shapes,
not whether arbitrary prose contains secrets.

Bodies, execution prompts, session transcripts, private paths, credentials,
unselected metadata and device commands never cross this boundary. The submitted
question is the only additional user content allowed. Consumers reject extra or
altered projected values, unknown references and mismatched dataset/catalog
identities. Code computes relationship answers and exact counts from current
local evidence. A later graph projection requires its own compatible approved
boundary.

### Search examples from existing sections

[fixtures/search.json](fixtures/search.json) contains three synthetic source
records and questions. Every question sees all three eligible records. These
are desired distinctions, not measured Jev answers:

| Question | Desired match | Existing text that supplies the distinction |
| --- | --- | --- |
| Which work plays an existing GIF, rather than importing one? | `#900011` Play a saved animation | Implementation decodes/plays GIF frames; deferrals exclude imports and event reactions. |
| How would I add an animated picture to my media library? | `#900012` Import animated media | Implementation validates an uploaded GIF and saves the original; deferrals exclude starting playback. |
| Show a reaction when an agent finishes its task | `#900013` React to a completed task | Outcome connects an existing GIF to task completion; implementation maps the event to the controller. |

For example, the application turns the first story into this compact entry
(with the other two entries alongside it):

```json
{
  "id": "jimmie-potts/agent-device-hub#900011",
  "fields": {
    "title": "Play a saved animation on Pixoo",
    "guide.topic": "pixoo-media",
    "guide.note": "Play an existing GIF from the media library.",
    "story.outcome.text": "The owner can display a saved animated image on Pixoo.",
    "story.implementation.text": "Decode and play GIF frames through the existing playback controller.",
    "story.deferrals.text": "Importing new files and reacting to agent events are separate work."
  },
  "truncatedFields": []
}
```

The offline checks verify that all three IDs and distinguishing source text
survive projection and that dropping an entry fails validation. No model is
called; provider quality, actual full-inventory coverage and integration remain
separate acceptance work.

## Compatibility, examples and approval

`fixtures/valid.json` is synthetic; its high issue numbers and `FIXTURE_` node
IDs make no claim about real issues. `fixtures/cases.json` applies named field
replacements to that one canonical dataset and records the expected result.
The base dataset IDs are reused by [the journey](journey.md).
`fixtures/search.json` adds the three search distinctions above.
Run `node --test docs/work-guide/contracts/records.test.mjs` under Node 24.

Version support is exact. Any shape/meaning/required-evidence change needs a new
reviewed version and compatibility fixtures. Additive properties are not
automatically compatible because objects are closed. Keep old definitions when
an accepted consumer still needs them; do not silently relabel old data.

Before adoption, retain in the delivery PR: issue, canonical artifact paths,
version, candidate commit, SHA-256 content digest, approver, explicit approval
statement, timestamp and durable owner-evidence link. An agent-authored statement
under shared credentials cannot supply the approval. Changed definition bytes
require renewed approval. The bundle digest covers this directory except the
test runner, plus the normative OpenSpec delta/main specification; the digest
procedure in `digest.mjs` normalizes the spec's ADDED Requirements heading,
generated main-spec title and terminal blank lines for archival. CI/review
receipts and task completion checkboxes are outside the
definition digest. Verify the same digest in merged source before issue closure.

Later integration must apply this same schema, parser rules and semantic checks
to new stories and every refresh, while keeping missing optional fields visible.
This delivery checks fixtures only. It neither audits all existing stories nor
replaces the current strict snapshot builder with a more permissive one.
