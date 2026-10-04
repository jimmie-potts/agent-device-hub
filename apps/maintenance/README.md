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
Unknown or expired runs cannot acquire a new work deadline implicitly. A known
saved run may reconcile after its original deadline with a separate read-only
bound of at most 120 seconds. Its original deadline identity is unchanged; no
query, planning or new publication is allowed during that recovery.

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
under `artifacts/`. The archive contains three Node entrypoints and the Python
helper for canonical recommendations, with its pinned
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
check runs the real bundled intake, closeout and Hub installation CLIs from a
disposable extracted archive. The
cross-boundary scenario reuses dotfiles' `ComposedDelivery` fixture, replacing its
intake boundary with this CLI; it covers success, CI refusal, uncertain issue or
installation effects, and reconciliation without duplicating the delivery engine.

## Owning tracker closeout

The same package exposes `tracker-closeout.mjs --config <private-config.json>`
as the supervisor's pinned owning closeout adapter. Invoke it only after the
supervisor has verified source checks, independent reviews, merged-main CI and
the owning installation. It adds no scheduler or delivery worker. Its one
proposal-only assessment counts against the original deadline and shared context
limit. It uses the same installed subscription route and requested read-only
controls as intake; #734 must qualify their effective enforcement.

The request has exactly `schemaVersion: 1`, `operation` (`closeout` or
`reconcile`), `repository`, `issue`, `pr`, `merge`, `installationReceipt`
(`path` and SHA-256), `acceptedSourceOnly`, `requirementsBodySha256`,
`requiredAcceptance`, `deadline`
and `evidenceDirectory`. Trusted configuration selects one fixed repository
policy; the request must match it:

| Repository under `jimmie-potts` | Installation proof | Tracker projection |
| --- | --- | --- |
| `agent-device-hub` | `install-receipt/1.0`, runtime `hub` | Owning workflow labels and existing B.U.N.N.Y. item |
| `codex-nanoleaf` | `install-receipt/1.0`, runtime `nanoleaf` | Owning workflow labels and existing B.U.N.N.Y. item |
| `divoom-app-upgrade` | `install-receipt/1.0`, runtime `pixoo` | Owning workflow labels and existing B.U.N.N.Y. item |
| `agent-skills` | `installed-files/1.0`, skills plan and manager/link readback | Preserve labels; no portfolio access or writes |
| `dotfiles` | `installed-files/1.0`, canonical loading-link/file readback | Preserve labels; no portfolio access or writes |

There is no custom policy path or plugin loading. Runtime profiles validate the
full published receipt contract, installation owner, successful outcome, exact
target/running revision and healthy result. Tool profiles validate the owning
plan and file/link readback below, without a runtime-health claim. Both verify the
merged PR and unchanged selected issue body. The worker's acceptance classes
are a claim: a separate bounded assessment reviews the current body and public
comments. `acceptedSourceOnly` is normally null. An explicitly accepted source-only
exception has exactly `reason` (an exact reviewed-body excerpt) and
`installationIssue` (an allowlisted issue URL in that body); only then may
`installationReceipt` be null and required acceptance omit installed proof. The
independent assessment must confirm the narrowing and retained installation
obligation. A keyword or link alone is insufficient. The selected source issue
may close, but overall delivery remains installation pending. Any required
client, physical, owner-decision or unknown acceptance
blocks automatic closure even if the worker omitted it.

Closeout configuration contains `schemaVersion: 1`, `repository`, absolute `gh`,
`installationId`, private `stateDirectory`, `capacityBytes` (1 MiB–1 GiB) and
`planning`. The latter contains absolute `codex`, `python`, `checkout`,
`owningCheckout`, `planWork`, `recommendationPolicy`, `recommendations`, `helper`,
plus `model`,
`policyRevision`, `timeoutSeconds` (1–1800) and `files`. Use the installed shared
execution-recommendation policy, the owning
`docs/work-guide/work/recommendations.py`, its adjacent `story_sections.py`, and
the packaged `recommendation.py` helper. Pin all these files, the resolved tools
and inspected policy/control dependencies by SHA-256 in `files`; the supervisor
also pins `gh`, the package and configuration. `policyRevision` is the accepted
shared-policy commit. `checkout` is the Hub checkout that owns shared tracker
procedures and recommendation mechanics; `owningCheckout` contains the selected
repository's current source and instructions. Only Hub may omit `owningCheckout`,
in which case it uses `checkout`. Pin the owning `AGENTS.md`, `README.md` and,
for runtime repositories, `docs/sdlc.md`, plus the Hub checkout's
`docs/tracker-reconciliation.md`, `docs/project-maintenance.md` and `docs/sdlc.md`
in `planning.files`. Missing or changed instruction evidence blocks closeout.
Models are Astra, Sol 6.1 or Luna by their exact Codex IDs.
Evidence has a separate 16 MiB admission bound. Retention remains ADR 0011;
capacity refusal never clears history.

### Installed-files proof

For tool profiles, configuration also supplies `installedFiles` with exact
`configSha256` (the owning adapter's trusted configuration digest), `checkout`,
`allowedPaths` and `protectedPaths`. Paths are repository relative. Dotfiles adds
`link`, the existing absolute loading-link path. Skills adds `requiredSkills`
and `links`, an ordered inventory of exact `{agent, skill, path}` entries for
prequalified existing Codex/Claude loading links. Issue text and receipt content
cannot widen these bounds. Dotfiles allows only configured `scripts/`, `tests/`
and `docs/` files; its supervisor, installer and owning instructions remain
protected. Skills allows the complete configured inventory under affected linked
`skills/<name>/` directories and admitted accompanying `tests/` and `docs/` files;
the allowlist must cover that full inventory, including unchanged skill files.
Root instruction files, `scripts/` and the active `deliver-work`, `review-work`,
`code-review`, `plan-work`, `tdd`, `writing-for-agents` and `unslop` skills are
excluded. Protect every other active policy, installer and delivery dependency in
the trusted configuration; their updates retain the stopped/restart boundary.

The private receipt has exactly `schemaVersion: "installed-files/1.0"`,
`repository`, `issue`, `owner`, `outcome: "succeeded"`, `targetRevision`, `plan`,
`planSha256`, `readback` and `verifiedAt` (epoch seconds). Its identity must match
the selected issue, configured installation owner and merged revision. The
owning adapter verifies actual installed bytes before emitting it; closeout does
not run an installer or inspect a service.

The plan contains `schemaVersion: 1`, `repository`, `issue`, `owner`, `checkout`,
`previousRevision`, `targetRevision`, `remoteMain`, `commits`, `files`,
`preservedDirty`, `configSha256` and `deadline`. Files contain exactly `path`,
`sha256`, `size` and Git `mode` (`100644` or `100755`). Dotfiles adds `link` with
`path`, `target`, `device` and `inode`. Skills instead adds `requiredSkills` and
`links`; each link adds `agent` and `skill` to those same link fields. Every
configured required skill and changed skill needs a supported loading link.
New, renamed, removed or missing-link work stays with its owning qualification.

Readback contains `kind: "installed-files"`, `revision`, exact `files` and
`preservedDirtySha256`. Dotfiles adds `linkTarget`, matching the checkout.
Skills adds exact `links` and `managerStatus`, whose `codex` and `claude` entries
each contain `sha256` and `status: "correct"`. Manager status is separate from
client discovery or behavioral acceptance. Runtime health fields are rejected.

The producer hashes `plan` and `preservedDirty` using Python JSON with sorted
keys, separators `(',', ':')` and ASCII escaping. Closeout recomputes those
digests from the original receipt bytes using the pinned Python executable;
it does not reserialize the plan through JavaScript first. Full plans and
preserved owner state remain private and are never supplied to the model or
published in tracker comments.

Discovery reads native parents, dependencies, dependents, selected children,
children of the immediate parent, and explicit tracker links in the selected
body. It follows parents and prerequisites of discovered records, with a
40-record cap. It does not infer dependencies from prose mentions. Complete
relationship reads and bounded public comment pagination are required. A link
whose relevance or acceptance cannot be established remains pending. Broader
semantic changes, missing related evidence and unresolved ownership also block
closeout; they are not silently interpreted as an empty graph.

For each affected criterion the assessment records its body line, evidence or
remaining obligation, owning issue, next action and actual observation date or
unknown. It preserves parent/client/physical outcomes. Supported public effects
are deliberately narrow: refresh an affected open issue's execution advice with
the canonical parser, dry run and upsert; remove `blocked` only for the selected
accepted sole dependency with no other owner hold; publish one fixed selected
receipt comment; close the selected issue; and, for runtime profiles, project
Done onto its existing Project item. It does not close parents, create memberships, change commitment,
reparent work or alter native relationships. Parent phase must already agree.
Changed native meaning requires an owning reconciliation decision.

Advice is generated from validated structured choices and fixed prose, never
arbitrary model text. Body, comments, ownership, holds, relationships and Project
fields are reread before effects; unrelated fields must survive authoritative
readback. Changed inputs refuse the prepared update. Public mutation intent is
persisted first. `reconcile` reads authoritative state and retained assessment;
it does not rerun planning or repeat publication. A partially applied closeout
that cannot be proved complete stays uncertain for the owning recovery path.

The response repeats `schemaVersion`, `repository`, `issue` and `merge`.
`status: complete` carries `effects: verified` and a private tracker receipt
path/hash. `blocked` with `effects: none` permits the supervisor to park work;
`uncertain` retains the unresolved effect. Pending reconciliation retains the
installation receipt reference, so a tracker gap does not erase verified
installation. An accepted source-only receipt has null `installationReceiptSha256` and an
`installationPending` reason/link; this adapter never turns it into an installed
result.

## Hub installation adapter

`hub-supervisor-install.mjs --config <private-config.json>` adapts the existing
[Hub installer](../hub/SETUP.md#upgrade-and-roll-back-the-installed-hub) to the
supervisor's fixed installation protocol. The trusted supervisor invokes it
under the same shared claim after the source/review/main-CI gates. It does not
run for an accepted source-only selection. #734 owns installed qualification of
this wrapper and its complete native source/tool closure.

Stdin contains exactly `schemaVersion: 1`, `operation` (`install` or `reconcile`),
`repository` (Hub), positive `issue`, full `merge`, configured `owner`, `deadline`
and private `evidenceDirectory`. Private configuration has exactly
`schemaVersion: 1`, `owner`, absolute `node`, `sourceRoot`, `tokenFile`,
`baselineReceipt` (absolute path or null), `installationRoot`, `stateDirectory`,
`evidenceRoot`, `reserveSeconds` (600–3600) and `capacityBytes` (1 MiB–1 GiB).
The evidence directory must be a child of the configured private root, outside
source. The supervisor pins the wrapper, configuration, resolved Node and clean
native source/dependency closure. Keep the existing read credential file private;
no token or raw command stderr enters reports.

The wrapper first runs native `plan` for the exact SHA, saves it privately and
verifies owner, target, installation root, credential path, digest, complete
source comparison and no removed commits. Unknown migration and changes to
active maintenance/installer machinery are deferred to the existing stopped
boundary. Qualification must establish the complete included revision bundle,
compatibility and recovery authority; a successful schema check cannot supply
that authority. Native plan refresh and digest checks remain mandatory.

After reserving at least ten minutes, the wrapper records intent and invokes
native `upgrade` with the saved plan, exact digest and original deadline. The
native command checks the reserve again immediately before durable mutation
intent. The wrapper never kills an admitted mutation. The existing native
operation owns stop, backup, switch, recovery and receipt finalization.

Reconciliation reads the saved plan and only native receipts created after
that attempt's intent baseline. It does not reissue upgrade. Receipt reads take
the existing native installation lock only when absent, then release only that
owned lock; no stale lock is cleared. Any invalid, ambiguous or unresolved
native receipt remains blocking. Full install-receipt/1.0 validation is followed
by current native status, a bounded authenticated read-only health GET and a
second status with the same process identity. Browser sessions are not opened.

Verified success returns `status: installed`, the exact installed/running SHA,
healthy state and native receipt path/hash. A terminal refusal or successful
rollback can return `status: blocked` only with its full receipt, freshly healthy
baseline identity, and verified clear locks/barriers. Unknown or partial effects
remain `uncertain`. Durable private state and original evidence survive all
outcomes; capacity refuses new state without deleting history. Fixtures exercise
real stdin/native argv and loopback health against synthetic native output,
including the extracted package, without operating an installed service.
