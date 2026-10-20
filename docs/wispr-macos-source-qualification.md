# Mac-local Wispr source qualification

Investigation for [#1169](https://github.com/jimmie-potts/agent-device-hub/issues/1169),
20 October 2026. Repository behavior was inspected at
`59e8c39ff1ebeb2f17a4a106b7af15913b8fb63e`.

**Result: no installed Mac source or app version is qualified by this report.**
A local dictation database is a documented candidate. Its schema, field meanings,
access constraints and history coverage remain unknown on the owner's Mac.
The safe fallback is to leave the Mac source unconfigured and report it as
unavailable, while preserving the separately qualified Windows source. Do not
publish an empty successful Mac snapshot or infer a healthy source from a healthy
core. This investigation creates no collector, transport or installation.

## Evidence and candidate sources

The vendor pages below were read on 20 October 2026. They document product
features, not a supported database integration API or a versioned analytics
schema. No installed app, application directory, database, account export,
transcript, settings file or permission grant was inspected.

| Candidate or capability | Evidence class | What it establishes | What remains unqualified |
| --- | --- | --- | --- |
| Mac desktop local dictation history | Vendor documentation | The [local-data guide](https://docs.wisprflow.ai/articles/3884018196-completely-removing-wispr-flow-from-your-device) names `flow.sqlite` and Mac Application Support folders; SQLite sidecars can accompany it. | Installed app/build, selected file, schema revision, table/field names, permissions and stable source identity. A folder example is not an authorized discovery target. |
| Local history completeness | Vendor documentation | The same guide says sign-out or data removal can remove local history and organization policy can prevent local storage. | This installation's settings, retention window, gaps and account-switch behavior. No full-history guarantee. |
| Account export | Vendor documentation | The [privacy overview](https://docs.wisprflow.ai/articles/3467817258-security-and-compliance-faq) describes an account export containing retained dictations and other account content. It cannot recover dictations never retained on the server. | A bounded, versioned local numeric feed. Export would select a separate cloud source; it was not requested or downloaded. |
| Vendor remote MCP | Vendor documentation | The [MCP guide](https://docs.wisprflow.ai/articles/9551372685-connect-an-mcp-client-to-wispr-flow-remote-mcp-server) explicitly excludes dictation history from its read-only access. | It cannot supply this dictation-analytics source. No connection was made. |
| Existing B.U.N.N.Y. collector 1.1.5 | Repository observation and synthetic tests | The Windows production reader refuses non-Windows platforms. Internal synthetic adapters exercise schema/numeric/language logic on other systems. | A production Mac reader, Mac WAL/locking/access qualification and installed field semantics. The profile called “native” in existing tests is not Mac support. |
| Aggregate snapshot `schemaVersion: "1.0"` | Repository contract | The pure [Wispr contracts package](../packages/wispr-contracts/README.md) validates bounded aggregate output. | Whether an installed Mac source can produce its inputs faithfully. |
| Runtime JSON `wispr-analytics/2.0` | Repository contract | The [Wispr module](../modules/wispr/README.md) projects published JSON with privacy, freshness and clear-generation checks. | Cross-host delivery and installed Mac acceptance. This response version is distinct from the snapshot schema version. |

## Conditional field mapping

These are requirements for a future source adapter, not observed Mac fields.
The existing [reader](../apps/wispr-collector/src/reader-engine.ts) accepts only
fixed identifiers on a real, nonvirtual `History` table. The legacy profile uses
`id`; the alternative uses a non-null sole textual primary key
`transcriptEntityId` only when `id` is absent. An incompatible existing `id`
does not permit fallback. Confirm uniqueness and stability before retaining
contributions. Raw row IDs stay private; a separately selected source namespace
and publication generation identify aggregate output.

| Input candidate | Existing mapping and refusal/coverage rule | Mac qualification needed |
| --- | --- | --- |
| `timestamp` | Text (or alternative-profile `DATETIME` declaration); a value must have a date, time and explicit UTC offset. Numeric epochs, invalid dates and unzoned values are excluded. Calendar grouping uses the configured time zone. | Source event meaning, offset and precision; do not guess a local zone or unit. |
| `status`, `numWords` | Numeric totals include `formatted` rows with positive safe-integer words and a valid timestamp after the capture fence. Other statuses/counts remain excluded with coverage. | Status lifecycle and word-count meaning. |
| `duration`, `speechDuration` | Positive finite values contribute recording/speech seconds, covered words and sample counts. Zero has a separate counter; missing has no sample; invalid values have invalid counters. | Seconds versus another unit, recording versus speech meaning. Until confirmed, omit these metrics. |
| `numWordsCorrected`, `numDictionaryReplacements` | Nonnegative safe integers contribute sums and sample counts. A measured zero has a sample; an absent value does not. | Counter semantics and whether updates replace earlier values. No accuracy inference. |
| `appName` / alternative `app` | Fixed app allowlist and neutral fallback; no raw path, URL or arbitrary destination string is published. | Whether the field describes the destination and which values map faithfully. |
| Optional language stages | Only an independent language opt-in selects bounded `asrText`, `formattedText`, `editedText` and fixed language/observation metadata. English tags qualify lexical analysis; unknown language is excluded. | Presence, meaning and completeness of each stage. Numeric support does not imply language support. |
| Observed-edit measures | Require the controlled profile's `editedTextStatus: complete` and valid `editObservationEnd` at or after the source time. Missing/partial/unknown metadata excludes comparison. Even a complete observation has unknown finality. | These are synthetic qualification rules, not evidence that Mac supplies them. Do not infer a sent message or corrected mistake. |
| Dictionary aggregates | Optional and separately bounded by the existing contract. | Source schema and selection remain unknown; do not discover or read a dictionary during a numeric-only check. |

Unsupported or unknown optional capabilities stay absent or excluded. Aggregate
sum fields can be zero as part of the schema's empty reduction; their sample and
coverage fields determine whether a measurement exists. They must never be
presented as measured zero, zero words-per-minute or perfect accuracy merely
because source fields are missing.

## Synthetic contract examples

The following fixture uses invented rows and neutral UUIDs only. After
`npm ci` and `npm run build:wispr` at the repository root, run this block there
with `node --input-type=module`. It calls the existing pure reduction and
validator; it neither opens a source file nor qualifies a Mac reader.

```js
import assert from 'node:assert/strict';
import { contribution, aggregate } from './apps/wispr-collector/dist/numeric.js';
import { validateSnapshot } from './packages/wispr-contracts/dist/index.js';

const row = {
  id: 'synthetic-only', timestamp: '2026-10-20T12:00:00Z',
  status: 'formatted', numWords: 120, duration: null, speechDuration: null,
  numWordsCorrected: null, numDictionaryReplacements: null,
  appName: null, invalid: [],
};
const missing = contribution(row);
assert.equal(missing.totals.words, 120);
assert.equal(missing.totals.recordingSamples, 0); // Unknown, not measured zero.
assert.equal(missing.totals.correctionSamples, 0);
const measured = contribution({ ...row, duration: 60, numWordsCorrected: 0 });
assert.equal(measured.totals.recordingSamples, 1);
assert.equal(measured.totals.recordingSeconds, 60);
assert.equal(measured.totals.recordingWords, 120);
assert.equal(measured.totals.correctionSamples, 1); // A measured zero.
const zero = contribution({ ...row, duration: 0 });
assert.equal(zero.totals.zeroRecording, 1);
assert.equal(zero.totals.recordingSamples, 0);
assert.equal(contribution({ ...row, duration: -1 }).totals.invalidRecording, 1);
assert.equal(contribution({ ...row, timestamp: '2026-10-20T12:00:00' }).exclusion, 'timestamp');
assert.equal(contribution({ ...row, numWords: Number.MAX_SAFE_INTEGER + 1 }).exclusion, 'words');
assert.equal(contribution(row, Date.parse(row.timestamp)).exclusion, 'before-capture');
const snapshot = aggregate([missing], {
  namespace: '11111111-1111-4111-8111-111111111111',
  generation: '22222222-2222-4222-8222-222222222222',
  revision: 1, now: '2026-10-20T12:01:00.000Z', timezone: 'UTC',
});
assert.equal(validateSnapshot(snapshot).ok, true);
assert.equal(snapshot.schemaVersion, '1.0');
assert.equal(snapshot.lastSuccessAt, '2026-10-20T12:01:00.000Z');
assert.equal(snapshot.numeric.totals.recordingSamples, 0);
// Negative control: the contract must refuse a content-bearing extra field.
assert.equal(validateSnapshot({ ...snapshot, transcript: 'synthetic text' }).ok, false);
console.log('Synthetic numeric mapping and refusal checks passed.');
```

Existing synthetic fixtures cover the remaining conditional cases without using
personal data:

| Evidence | Cases and limits |
| --- | --- |
| [Reader fixtures](../apps/wispr-collector/tests/reader.test.mjs) | Fixed legacy/alternative schemas, wrong declarations, duplicate IDs, view refusal, bounded rows/bytes/memory/deadline and sanitized busy failures. |
| [Language reader fixtures](../apps/wispr-collector/tests/language-reader.test.mjs) and [language fixtures](../apps/wispr-collector/tests/language.test.mjs) | Numeric-only reads exclude text; enabled stages use synthetic strings; oversized stages preserve numeric rows; missing edit-end evidence remains unknown; unknown language does not borrow an English preference. |
| [Contract fixtures](../packages/wispr-contracts/tests/contract.test.mjs) | Strict schema/version, calendar bounds, app allowlist and totals; extra content-bearing fields are refused. |
| [Module validation](../modules/wispr/README.md#validation) | Existing stale/last-good, malformed input, clear-generation and outstanding opt-out cases specify consumer behavior. Collector tests alone do not execute this module or qualify cross-host delivery. |

The supervised reader defaults to at most 100,000 rows, 256 MiB selected bytes,
512 MiB combined reader memory and a 10-second deadline; overrides can only
lower those bounds. The module separately caps snapshot files at 16 MiB,
diagnostics at 4096 bytes, responses at 1 MiB and query rows at 10,000. A candidate
adapter must satisfy both sides, not merely finish a database scan.

`lastSuccessAt` in the example is a successful synthetic collection time, not a
source event time or permission to refresh stale data. The module's last-good
numeric data keeps its original observation time on an unreadable replacement;
a clear generation invalidates it. Its default freshness threshold is ten
minutes. No Mac observation exists here, so there is no Mac freshness timestamp
to publish. Execution results and exact reviewed revisions belong in the owning
issue and PR, not in a second delivery ledger here.

## Access, privacy and the smallest next check

The application owns its source files and permissions. A future adapter must
read on that host without altering Wispr permissions, copying a live database
without its consistency requirements, or mounting it into the portable core.
A read-only SQLite connection is necessary but does not by itself qualify Mac
WAL/sidecar behavior. The existing reader's read-only transaction, query-only
mode, disabled extensions, fixed SQL and limits are reusable logic; Windows
path/ACL checks and publication replacement are not Mac-qualified.

Collector analytics, source IDs, binding identity, capture fence, exclusions,
raw-source evidence and any text derivatives remain private on the source host.
Use a separate explicitly selected namespace and private state directory for Mac;
Windows installation choices do not opt in a new source. A later adapter must
retain the current controls: independent collection and sharing choices,
language disabled unless selected, private retention until explicit clear,
clear-generation and capture fences, no silent historical reimport, and refusal
on missing control state or changed source binding. Clear affects collector
state, not Wispr history. Opt-out and clear remain distinct; unmanaged backups
cannot be recalled. See the [collector controls](../apps/wispr-collector/README.md)
and [ADR 0011](decisions/0011-private-personal-data-retention.md).

The minimum separately authorized check should be staged so schema discovery
never silently becomes a content scan:

1. The owner names one Mac installation, app/build and exact source file privately,
   and authorizes only metadata inspection. Record OS/architecture, ownership,
   mode/ACL, file/sidecar types and permission failures without changing them.
   Do not search application directories, inspect session/config files, request
   Full Disk Access, quit the app or change settings as a workaround.
2. Against that selected file, assess safe read-only access first. Inspect only
   bounded database metadata: schema version, the allowlisted table's type,
   column declarations and key constraints. No row values, text, audio or
   arbitrary schema dump. If access needs creating/modifying sidecars, stop and
   ask for an explicitly safe owner-provided consistent snapshot; do not use an
   immutable connection that ignores an active WAL.
3. If metadata fits, propose a separate bounded numeric-only sample to confirm
   timestamp offsets, units, status semantics, key stability and update behavior.
   Agree the row/byte/time limits and private evidence destination before reading.
   If static evidence cannot establish a meaning, keep it unknown; a controlled
   synthetic dictation trial needs its own authorization. Language sampling is
   a separate choice and is unnecessary for numeric qualification.
4. Publish only a sanitized capability/version result and synthetic reproducer.
   Keep actual rows, aggregates, paths, identifiers, permissions evidence and logs
   private. Record unsupported fields and coverage gaps without filling them in.

If no safely readable and semantically qualified source is available, retain the
unavailable fallback. Do not substitute an account export, remote MCP, permission
change or guessed schema. If a source qualifies, the smallest follow-on is a
native Mac source/permission/publication adapter that reuses the validated pure
mapping and store semantics, with synthetic Mac filesystem/WAL tests and separate
installed acceptance. Do not remove the Windows production guard to create it.

## Integration consequences

Mac and Windows namespaces remain distinct even for the same account. Local
history may overlap or be incomplete; summing or deduplicating across hosts needs
an explicit rule and evidence. A single existing module configuration does not
prove a multi-source reader.

The [Wispr umbrella](https://github.com/jimmie-potts/agent-device-hub/issues/467)
and [cross-host integration](https://github.com/jimmie-potts/agent-device-hub/issues/977)
should consume this capability result without assuming a Mac collector exists.
Source-bound authentication and a qualified transport must precede aggregate
transfer; sharing a database or changing a URL is not that qualification.
[Host acceptance](https://github.com/jimmie-potts/agent-device-hub/issues/565)
requires the actual selected source, host and common candidate revision.
Synthetic reductions establish neither installed access nor host support.
