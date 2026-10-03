# Maintenance intake

This command turns bounded Hub diagnostic findings into exact issue selections
for the [shared nightly supervisor](https://github.com/jimmie-potts/dotfiles/issues/9).
The supervisor owns the global claim, serial delivery, reviews, merge checks,
installation and tracker closeout. This package has no timer or delivery engine.
Source fixtures do not establish installed permission controls or live telemetry.
[Hub #734](https://github.com/jimmie-potts/agent-device-hub/issues/734) owns activation
and one real accepted telemetry-backed delivery through verified installation.

## Trusted boundary

The installed supervisor runs this fixed command under its global claim:

```text
node <installed>/maintenance.mjs --config <private-config.json>
```

Stdin is exactly:

```json
{"schemaVersion":1,"operation":"intake","runId":"original-run-id","deadline":1791060000,"authority":"hub-maintenance","evidenceDirectory":"/private/supervisor/owned-intake-evidence"}
```

`deadline` is the original supervisor deadline in Unix seconds. `operation` may
instead be `reconcile`. The command returns one JSON object on stdout:

```json
{"schemaVersion":1,"status":"complete","selections":[{"schemaVersion":1,"source":"maintenance","authority":"hub-maintenance","repository":"jimmie-potts/agent-device-hub","issue":123,"selectionEvidence":"Validated finding and source reference; delivery remains unverified."}],"reason":"selection-complete"}
```

`status` is `complete`, `blocked` or `uncertain`; a zero process exit alone is not
acceptance. `complete` means intake has made its selection decisions. It never
means an issue was delivered or installed. An owner-selected queue does not gain
maintenance authority. The supervisor validates the entire selection batch,
preserves parked/completed items, and records queue admission independently.

The first source and repository are fixed to Hub. The command accepts only the
configured user units, canonical `hub` records and bounded query window. It uses
`journalctl --user --output=json --all` with explicit fields and fixed argument
arrays. Every accepted message passes observability 1.1.0's existing validator;
no schema is widened. Grouping uses registered diagnostic dimensions, excluding
instance/device IDs, paths, raw messages and journal cursors from the planner.
Missing, rotated, rejected, capped or interrupted input is partial/unavailable
coverage. A successful query is never proof that all observations were retained
by journald or that a service is healthy.

## Configuration

Keep the configuration outside candidate repositories, owned by the current
user with mode 0600. Use a separate owned 0700 `stateRoot` outside source and
publishable artifacts. `evidenceDirectory` is an owned, private, dedicated
supervisor directory; put process logs beside it, not inside it.

The configuration has exactly these fields:

- `schemaVersion`: `1`; `repository`: `jimmie-potts/agent-device-hub`.
- `authority`: the supervisor's separately accepted maintenance grant.
- `checkout`: the existing source checkout. Its origin must match the fixed Hub
  repository. Intake fetches `origin/main`, compares it to GitHub's current ref,
  and reads citation bytes from that exact commit without resetting the checkout.
- `stateRoot`: the private retained evidence directory.
- `tools`: absolute, qualified regular executable paths named `journalctl`,
  `codex`, `gh` and `git`. Resolve final executable symlinks before fingerprinting.
- `planWork`: the installed canonical plan-work `SKILL.md`, discovered during
  activation rather than fetched or recreated by the command.
- `files`: absolute nonsecret file paths mapped to SHA-256. Include every tool
  above and `planWork`, plus the inspected skill dependencies, permission rules,
  hooks and host controls used for this invocation. The supervisor separately
  pins the intake package and this configuration. File drift refuses admission.
- `model`: the selected qualified subscription model (`gpt-6-astra`, `gpt-6-sol`
  or `gpt-6.1-sol`). The code requests high reasoning, `forced_login_method="chatgpt"`,
  `approval_policy="never"`, `default_permissions=":read-only"` and
  `agents.enabled=false`. These are requested controls until #734 verifies the
  effective host behavior. There is no API-key fallback or permission bypass.
- `units`: one to eight selected user-service names, each ending in `.service`.
- `limits`: all of `windowSeconds` (1–86400), `querySeconds` (1–120),
  `planningSeconds` (1–1800), `maxRows` (1–5000), `maxBytes` (8192–33554432),
  `maxFindings` (1–10), `maxPages` (1–100), and `capacityBytes`
  (1048576–1073741824). Choose capacity above the query/evidence reserve; low
  capacity refuses new input. These are processing/admission limits, not retention.

The shared supervisor's fixed `intake.argv`, fingerprints, `timeoutSeconds` and
`authority` bind this command. Its original deadline includes query and planning;
only one planning worker runs at a time, with no descendants or detached work.
The supervisor owns the whole process group and verifies/reaps leftovers before
releasing its claim. A command deadline cannot establish safety merely from a
leader PID exiting. Pause/cancellation and the four-context global limit remain
supervisor responsibilities; intake does not start another coordinator.

## Investigation and publication

The installed plan-work method runs in proposal-only mode. It receives sanitized
registered dimensions, current source revision and the public existing issue
inventory. Instructions require current North Star, architecture, contracts and
reuse assessment. Defect, regression, North Star, architecture and reuse citations
must name current tracked files with exact SHA-256 and valid line ranges. The
code verifies each citation and checks current main again before publication.
These checks bind a proposal to source; they do not mechanically prove that a
model's diagnosis is correct. Delivery repeats freshness/reproduction and obtains
independent reviews before any eligible merge.

Expected incidents, uncertain diagnoses, speculative improvements and performance
findings without representative evidence remain deferred. A missing skill,
subscription, permission or verified source reference cannot become a selection.
Deferred findings at the same source revision are not repeatedly investigated;
a later source revision permits a fresh bounded assessment. A completed issue
stays completed; recurrent diagnostics do not reopen it automatically.

The concrete GitHub adapter uses fixed REST endpoints and structured JSON.
Every bounded page of existing issues is read, including closed issues. A capped
or unavailable inventory blocks creation. Current holds and ownership remain
blocking; the supervisor refreshes dependencies, PR ownership and delivery gates
before implementation. New issue text comes from fixed templates containing
registered dimensions and verified public source links. Model explanation text,
raw evidence and arbitrary issue instructions cannot become public commands,
new authority or publication prose. Existing issues are reused without rewriting
their descriptions. Matching public markers are authoritative reconciliation
keys; conflicting matches stop selection.

## Private evidence and recovery

Accepted original messages and journal provenance are retained in
`observations-<run>.json`, including personal identifiers allowed by the released
contract. Strict contract validation excludes unsupported fields such as tokens;
the unchanged contract does not detect an arbitrary secret disguised as a valid
identifier. Child stderr and arbitrary Codex event text are not stored. Planner
returns are retained privately, while receipts keep bounded numeric usage,
requested model/effort, unknown observed identity and their digest. The model gets
only the declared sanitized projection and public source/work context; this does
not authorize new private-file access or another sharing destination.

Files are mode 0600, directories mode 0700; writes use a temporary file, fsync,
atomic rename and directory fsync. State is not an authorization grant. The
supervisor is the one writer; invocation by arbitrary clients outside its claim
is unsupported. Evidence directories must not contain symlinks or unrelated
entries. These controls do not defend against software already running with the
owner's authority.

[ADR 0011](../../docs/decisions/0011-private-personal-data-retention.md) governs
retention. There is no age-based deletion, history eviction or automatic clearing.
Capacity pressure refuses new admission and preserves prior files. Reported byte,
row, source and query limits remain known collection loss; this is not a complete
journal archive. Keep originals when preparing a sanitized publication copy.

Before creation the command durably records the original run, source, structured
payload and `bunny-maintenance:v1:<fingerprint>` marker. A lost response leaves a
pending publication. The same interrupted run accepts only `reconcile`: it reads
all issue pages, verifies a unique exact marker and body, and reads back the
resulting issue. It never repeats a write. Missing, conflicting or unavailable
readback remains uncertain/blocked; an authoritative owner repair is required.
Interrupted investigation without a publication intent makes no selection.
Unknown or expired runs cannot acquire a new deadline implicitly.

`intake-report.json` records window/components, coverage, decisions, selected
issues and pending evidence. It explicitly leaves delivery unobserved. The shared
supervisor's morning report references that file and owns the joined outcome:
queue admission, exact merged revision, installation receipt, running identity,
health, recovery or installation pending. Intake never closes an issue or counts
selection, a model return, source merge or API acknowledgment as installed success.

To disable admission, use the existing supervisor controls. Reconcile pending
issue effects before replacing the adapter. Rollback/uninstall preserves private
state. Any owner-selected clearing procedure must address both run and finding
records so it cannot resurrect cleared work. No clearing command is added here.

## Package and validate

Use Node 24 and `npm ci` from the repository root. The owning commands are listed
in [development guidance](../../docs/development.md#maintenance-intake-checks).
`npm run package:maintenance` emits a reproducible private archive and checksum
under `artifacts/`. The archive contains the Node entrypoint with its pinned
JavaScript dependency closure bundled, a manifest of file hashes/dependency
versions, package metadata and this guide. No runtime configuration or retained
evidence enters the package. It requires the separately qualified installed
executables/skills; packaging does not install or enable them.

After reviewed merge and main CI, #734 installs the accepted archive in the
established supervisor's owned tool location, verifies the archive checksum and
every manifest entry, then pins the complete command/configuration closure. Keep
the previous accepted package and configuration for the existing stopped/restart
boundary. Do not replace an active intake or supervisor. Verify effective role
controls, subscription identity, query access, private file modes, process claims
and one real scheduled delivery before claiming installed acceptance.

Unit and CLI fixtures use synthetic journals and fake executables. The package
check runs the same real bundled CLI from a disposable extracted archive. The
cross-boundary scenario reuses dotfiles' `ComposedDelivery` fixture, replacing its
intake boundary with this CLI; it covers success, CI refusal, uncertain issue or
installation effects, and reconciliation without duplicating the delivery engine.
