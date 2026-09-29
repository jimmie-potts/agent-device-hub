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

All object properties are explicit and required by the schema; a nullable value
or a state-bearing object expresses unavailable content. An empty array means a
known empty selection or collection; `null` means unknown. Extra fields and
unsupported schema versions are rejected rather than silently discarded.

## Field-source dictionary

The table names every field or repeated field group. JSON Schema owns exact
types and allowed values; the rules below own provenance, precedence and use.
Sources must be HTTPS GitHub API or document references, never local paths.

| Field | Source and update owner | Meaning, precedence and unavailable behavior |
| --- | --- | --- |
| `schemaVersion` | This definition; contract owner | Exactly `guide-records/1.0`. An unknown version blocks composition. |
| `producerRevision` | Guide adapter build | Full source commit for the producer and parser implementation. A pinned schema version does not substitute for producer provenance. |
| `datasetId` | Guide adapter | Opaque identity for one immutable assembled dataset. Any source/projection change creates a new identity; all consumers compare it. It is not a freshness claim. |
| `assembledAt` | Adapter clock | UTC assembly time. Does not renew source observations. Future source observations are invalid. |
| `repositories[].name`, `scope` | Adapter's configured inventory | Exactly Hub, Nanoleaf and Pixoo are `primary`. External prerequisite repositories are `reference`, excluded from primary counts. Names are GitHub `owner/repository`, never display labels. |
| `repositories[].inventory` | Paginated REST `GET /repos/{owner}/{repo}/issues?state=open`, with PRs excluded and independent inventory reconciliation | Per-repository evidence. Its primary item count covers all open issues. Retained closed references come from explicit issue reads and do not increase that count. A limited reference repository describes only explicitly read references, not its whole backlog. Missing pages never establish a complete primary inventory. |
| `issues[].id`, `repository`, `number`, `nodeId`, `url` | REST issue `number`, `node_id`, `html_url`; repository identity from the response/request | `id` is `owner/repo#number`, with the exact matching URL. `nodeId` preserves GitHub identity across a transfer/rename. A rename/transfer needs explicit reconciliation and a new dataset; do not merge conflicting identities. Guide aliases H/N/P are presentation aliases only. |
| `title`, `body` | REST `title`, `body`; issue author | Preserve source text. `body: null` means absent/unavailable, not an invented summary. The body stays application-side. |
| `state`, `stateReason` | REST `state`, `state_reason`; GitHub issue state | State normalizes to `OPEN`/`CLOSED`; reasons retain lower-case `completed`, `not_planned`, `reopened`, `duplicate` or null. Only `completed` supports the Completed display. Unknown reasons are not coerced to completed. |
| `createdAt`, `updatedAt`, `closedAt` | REST `created_at`, `updated_at`, `closed_at` | UTC source times. Open records have no closure time and only null/reopened reason. A missing closed timestamp/reason remains unknown; closed does not prove installation. |
| `labels` | Native REST `labels[].name`; issue maintainers | Preserve exact labels. Open delivery work needs one of backlog, ready, in-progress or review with the `status:` prefix. Missing/conflicting status withholds readiness. `blocked` and `deferred` remain separate gates. Other labels remain descriptive. |
| `facts` | Issue GET or saved issue entry, with its original fetch receipt; adapter | Evidence for this issue's facts. A new dataset timestamp does not renew it. An inaccessible issue with no prior record is a fetch diagnostic, not a fabricated issue. Retained records carry stale/failed evidence. |
| `story.{outcome,implementation,protections,acceptance,deferrals}` | Five authored feature sections; `story_sections._sections` and the alias table below | Each has `state`, actual `heading`, literal `text`, `source`, `parser` and `reason`. The producer records the heading it parsed. Missing/duplicate/unsupported sections retain the issue and withhold implementation readiness. |
| `guide.{state,topic,note,workaround,highlight,extends}` | `## Guide` through `guide_section.read`; story author | Same strict grammar as the guide. `topic` uses `guide_paths.TOPICS`; highlight has `kind` and literal `reason`. Normalize H/N/P references to canonical IDs. Extends is allowed only for ideas and never becomes a prerequisite. Invalid/missing placement carries a reason, not a guessed topic. |
| `guide.source`, `parser`, `reason` | Issue URL and pinned producer implementation | `guide-section/1` identifies this contract's existing parser semantics; the adapter records its exact source revision in `producerRevision`. Assigned values must come from the body at `updatedAt`. |
| `parent`, `children`, `blockedBy` | REST `/issues/{n}/parent`, `/sub_issues`, `/dependencies/blocked_by`, or equivalent native GraphQL fields | Each is `{ids, evidence}`. Parent has at most one ID. A verified absent parent is `[]`; a permission/read failure is unknown. Prose links and `Extends` never populate these fields. Collections retain their own observation and pagination receipts. |
| `planning[]` | Existing `recommendations.read`/`ratings`, or explicit source links to acceptance/closeout evidence | Optional list; empty does not prove no planning exists. Each entry has `kind`, `state`, `source`, `parser`, `sourceUpdatedAt`. Kinds separate assessment, execution, delivery, installation and physical evidence. Current parsed execution uses its existing fingerprint check. Unsupported or outdated records remain visibly unknown/stale. Link-only entries do not establish their contents or success. No new prose parser is introduced here. |
| `publication` | Explicit allowlist review by guide maintainer | Null unless selected public planning fields have been reviewed. Contains `fields`, bound `issueUpdatedAt`, `reviewedAt`, `owner`, `source`. A changed issue invalidates the selection. This is evidence of allowed data sharing, not contract approval or feature acceptance. |
| `subguides[].id`, `kind`, `topic`, `title` | Authored topic/track/section identifier and label in `guide_paths.py` or another explicitly named guide input | Kind is topic, track or section. Preserve existing IDs, never invent model categories. Where an existing named track lacks a stable authored ID, adapter audit must establish an authored ID or retain an explicit gap; a guessed slug is not authoritative. |
| `subguides[].members` | Topic membership from valid Guide sections; authored track/section selections from `GUIDE_TRACKS` or named section input | Canonical issue references, not copied facts. Each reference resolves in the dataset. A reference view never increments issue totals. Topic and selected-track membership are different scopes. |
| `subguides[].outcome`, `nextStep` | `TOPICS`/`PATHS` outcome and next-action prose, or explicit authored section | Literal authored text; nullable when absent. Never generated to fill a gap. |
| `subguides[].source`, `revision`, `asOf`, `owner` | Exact guide input at a full Git commit, authored date and named maintainer | Editorial provenance is independent of GitHub observation time. If date/owner/ID is absent from existing inputs, the adapter audit reports the gap rather than borrowing a live fetch time. |
| `subguides[].publication` | Guide maintainer's selected public fields | Null or `fields`, bound `revision`, `reviewedAt`, `owner`, `source`. Only title/outcome/nextStep may be selected. A revision mismatch excludes it from inference. |

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
| Semantic discovery | Known record references and a current explicit public-field selection | Omit unapproved text from inference; keep its record in Full guide. Relevance does not imply readiness. Dated public content may be discovered only with its age visible in the application. |
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
rules. The adapter returns immutable data or a read diagnostic. It exposes no
write, provider or device capability. Renderer and protected endpoint consume
the same dataset identity. The endpoint validates records before constructing
model input; authentication and query shape remain with the request contract.
Failed reads retain the previous validated full guide with its original dates.

The projection carries `schemaVersion`, `datasetId`, and arrays of issue and
sub-guide references with selected `fields`. Issue entries carry `id`, `url`, `updatedAt`, source `observedAt` and `freshness`,
and selected title/topic/labels/state/closure reason/Guide note/Guide workaround/five-section text. Sub-guide
entries carry `id`, `revision`, `asOf`, resolvable public `members` and selected
title/outcome/nextStep. These are literal source values, not model summaries.
Publication selections are a producer-side trust boundary and require an
explicit public-data review; schema validation cannot discover secrets inside
arbitrary prose. Do not automatically approve a field merely because it has an
allowed name or came from a GitHub issue. The submitted question is the only
additional user content allowed by this boundary.

Bodies, execution prompts, session transcripts, private paths, credentials,
unselected metadata and device commands never cross this boundary. The consumer
must reject extra or altered projected facts, unknown references and mismatched
dataset/catalog identities. Relationship answers and exact counts use the
application's computed results; Jev does not fabricate missing graph data.
The later Jev adapter contract may define an additional typed graph projection
only through an approved compatible boundary, not an undeclared extra property.

## Compatibility, examples and approval

`fixtures/valid.json` is synthetic; its high issue numbers and `FIXTURE_` node
IDs make no claim about real issues. `fixtures/cases.json` applies named field
replacements to that one canonical dataset and records the expected result.
The same IDs are used by [the journey](journey.md), rather than copying facts.
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
