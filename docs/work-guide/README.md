# Cross-project work guide

Read the [public guide](https://jimmie-potts.github.io/agent-device-guide/), or open
[the local HTML](outputs/agent-device-work-guides.html) in a browser after cloning
this repository. GitHub's file view shows HTML source. Keep the adjacent
`architecture` folder for the full interactive viewers. The inline diagrams,
timeline and guide controls work in the single HTML file.

The hub owns this generated guide for agent-device-hub, codex-nanoleaf and
Divoom/Pixoo. GitHub issues remain authoritative for scope and status. The HTML
is a dated, reviewed view of those records. Its backlog, source review and
history timestamps describe separate evidence; none means a live dashboard.

Issue links show an icon and status text: Open, In progress, In review, Blocked,
Completed or Closed. Completed requires GitHub's completed closure reason;
other closures remain Closed. Active work retains a blocked qualifier when a
blocked label or open prerequisite applies. Repository colors still identify
Hub, Nanoleaf and Pixoo. Counts include only open issues.

Each guide starts with its outcome and next step. Closed stories and detailed
evidence are expandable; search, Expand all and printing reveal them. The
parallel-work cards list selected independent units. A blocked or deferred label,
open prerequisite, active owner or closure removes a unit from the candidate
group. Missing dependencies fail the build instead of implying readiness.
`work/guide_paths.py` owns the reading paths and selected units;
`work/guide_status.py` derives their status and scheduling gates from the saved
snapshot. `work/guide_reading.css` styles these controls.

## Intentional guide revisions

The shared checkpoint contract was introduced by
[agent-skills #33](https://github.com/jimmie-potts/agent-skills/issues/33) at
[`ff80d24`](https://github.com/jimmie-potts/agent-skills/blob/ff80d247ea96a5d4c461d30a2c24148376197c7b/skills/deliver-work/references/documentation.md).
Discover the installed canonical skills when explicitly invoked. `plan-work`
reads the discovered `deliver-work` package's `references/documentation.md`
without invoking delivery. Report a missing required resource; do not install or
copy it silently. This repository procedure applies when a task intentionally
updates or publishes the guide, without implicitly invoking either skill.

For a guide update, name the work source, coordinator, affected repositories,
canonical inputs, requested finish line and authorized effects. Use existing
task/PR evidence. Ordinary source, tracker and acceptance work has no guide
refresh obligation; these instructions do not supply permission to publish.

| Checkpoint | Required result |
| --- | --- |
| Intentional source-guide update | Read current issue and acceptance evidence, refresh affected saved inputs, reconcile primary coverage and history, regenerate output, and validate the dated candidate. |
| Cross-repository guide update | One coordinator owns a Hub guide PR linked to the relevant device-source work. State the source revision and evidence represented by that snapshot. |
| Authorized public publication | Refresh and validate a coherent Hub guide candidate. Merge changed output through the normal gates, or reuse the reviewed revision when output is unchanged. Publish that exact revision and verify what unauthenticated readers receive. |

For an intentional guide update, one coordinator owns links among relevant
device-source PRs, the Hub guide PR and any public publication PR. Report the
guide revision, public artifact publication and live verification separately.
A normal delivery can finish without a newer guide edition; do not present a
dated snapshot as current.

Keep external prerequisites, including agent-skills work, as verified reference
links. They do not join the three source repositories' primary issue totals.
Verify their identity, state and dependency direction through the saved native
dependency records and authoritative source receipts.

## Publish the public edition

The public [agent-device-guide repository](https://github.com/jimmie-potts/agent-device-guide)
hosts the generated HTML through GitHub Pages from `main`, directory `/`.
The hub source repository stays private. Pages on the current account plan
requires a separate public repository. Links to private GitHub issues, PRs and
source files still require repository access.

This task's coordinator owns the hub source PR and the linked public publication
PR. After a guide change merges and all applicable main CI jobs pass, or the
[guide-only CI receipt](../sdlc.md#guide-only-ci-exception) is verified:

1. Use the validated output from that exact hub revision. Copy
   `outputs/agent-device-work-guides.html` to the public repository's `index.html`
   and copy the nine `outputs/architecture/*.html` viewers to `architecture/`.
   Publish only these ten HTML files, `.nojekyll` and the public README.
   Inspect their contents as well as filenames for credentials, private runtime
   data, personal paths, and unrelated material before public copying. Repair
   such content in the owning inputs and regenerate before renewed review.
2. Update the public README with the hub source revision and guide SHA-256.
   Retain the snapshot dates in the generated HTML. Do not refresh data or edit
   generated content in the public repository.
3. Open a public-repository PR from an isolated branch/worktree. Link the hub
   companion PR and obtain independent Standards and Specification reviews of
   the fixed candidate. Validate the guide and relative viewer links, confirm
   the file allowlist and hashes, and pass all configured CI before guarded merge.
4. GitHub Pages publishes the public repository's merged `main`. Read the
   successful deployment and verify the unauthenticated HTTPS landing page and
   all nine viewers against the source hashes. Record both PRs, source and
   published revisions, and the deployment result in the delivery receipt.
   Verify every required URL without authentication and compare every served
   HTML file with its reviewed source hash. A repository hash, successful Pages
   response, or representative viewer check alone is incomplete acceptance.

Copying from the private hub to the public repository is an explicit publication
step. There is no automatic cross-repository sync or new access token. A hub
merge alone does not update the website. For an authorized publication task,
report pending publication until the public copy is verified.
An unchanged source output can still have a stale public copy. If all required
public revision, content and deployment evidence already matches, record that
no-change result instead of creating an empty publication PR.

## Refresh and validate a guide revision

An intentional guide update refreshes the relevant issue, history and diagram
inputs as one dated snapshot and regenerates the HTML in a Hub PR. The PR records
its source revisions, affected sections, validation and any deliberate gap
between source and public editions. Git history and PRs retain revision history;
the former per-delivery `updates.md` ledger is retired. Read-only questions and
reviews do not independently authorize document writes. Device-repository work
needs a linked Hub PR only when its authorized scope includes a guide update.

1. Read current issue states and acceptance evidence. Refresh the backlog using
   the helper below when status or scope changes, then reconcile primary coverage
   and narrative in `work/build_guide.py`. Refresh queries can partially write
   files on failure; discard or complete that candidate before publishing it.
   Every open issue must have exactly one primary guide. Reference links do not
   own issues or increase counts.
2. Update history inputs in `work/history/github-history.json` from paginated
   read-only GitHub queries when recording merged work. Keep PR creation, source
   merge, installation and physical acceptance distinct. Never predict a merge
   date or close an issue in the guide before its authoritative source does.
3. When ownership or command flows change, update pinned architecture sources,
   SHA-256 receipts and definitions in `work/architecture_diagrams.py`. Render
   using the centrally installed archify skill; do not install or vendor it.
   Retain implemented/planned labels and each diagram's failure boundaries.
   The BUNNY atlas under `docs/system-design/` embeds the system map and the
   observation walkthrough from these same definitions; rebuild and check it
   after re-rendering either of them.
4. Run the commands below. Guide-only CI filtering does not waive these local
   checks or the review evidence required by the [SDLC exception](../sdlc.md#guide-only-ci-exception). Inspect desktop/mobile and print renders for diagram
   changes. Commit inputs, generator, resulting HTML and viewers together.
5. If the authorized guide revision must include merge or acceptance facts that
   were unavailable before merge, reconcile them in a linked follow-up PR.
   Do not recursively record guide-only PRs as product milestones.

Guide UI changes, including presentation, interactions and architecture viewers,
do not require human approval under the [SDLC UI approval scope](../sdlc.md#ui-approval-scope).
Independent Standards and Specification reviews and the required guide checks
still apply. Other UI in a mixed change retains its human approval requirement.
The exception also covers verified public copies of the guide; publishing them
still requires the separate authority and evidence described above.

These instructions do not start a scheduler, run devices, deploy the guide or
grant additional mutation authority.
Concurrent deliveries rebase and reconcile the guide inputs before regenerating;
never merge generated HTML conflicts by choosing one side blindly.

A partial refresh is an unpublished candidate. Reconcile all affected inputs
with a complete fresh snapshot and concurrent source changes, regenerate, and
renew affected checks/reviews before publishing. Preserve the last verified
public edition. After a timeout or failed publication, inspect authoritative PR,
merge and deployment records before retrying; reuse verified existing effects.
An unavailable browser, public route, or hash check leaves its acceptance pending
with the coordinator and the exact next check. Never duplicate a PR to probe a
timeout or add guide-only merges recursively to product milestones.

## Commands

Run from the repository root. Python 3 with zoneinfo data builds the HTML offline.
The browser check additionally requires installed Node, Playwright and Chromium;
use `GUIDE_PLAYWRIGHT_MODULE` and `GUIDE_CHROMIUM_PATH` for their installed paths.
No product service or hardware test is needed for this document.

```bash
python3 docs/work-guide/work/build_guide.py
python3 docs/work-guide/work/test_maintenance.py
node docs/work-guide/work/check_guide.cjs
# After committing intended generated output, rebuild and require no drift:
python3 docs/work-guide/work/build_guide.py
git diff --exit-code -- docs/work-guide/outputs
```

When refreshing GitHub data, use an authenticated `gh` client with read access to
all three repositories. Inspect the diff and reconcile coverage before building:

```bash
python3 docs/work-guide/work/refresh_backlogs.py
```

When diagrams change, read the archify skill and render before building:

```bash
ARCHIFY_DIR=/path/to/installed/archify python3 docs/work-guide/work/architecture_diagrams.py
```

The helper defaults to the central `~/.agents/skills/archify` location. Browser
screenshots, PDF and machine-local verification output are ignored by Git.
Record their actual result and HTML hash in the PR. Existing diagram receipts
are provenance for the imported baseline, not new verification of future edits.
The imported standalone viewers reference Google Fonts with offline fallbacks;
seven have known vertical overflow under Archify's first-screen check. Preserve
these limitations until a fresh check establishes a fix.

## Baseline provenance

Imported from the user-reviewed artifact produced September 8, 2026. The original
HTML SHA-256 was `0aa3a2c0786d951b348b3e12d4dd505151a0a471e5e77d38e2d2a1fd069d666c`.
The original backlog snapshot is retained. Hosting receipts, personal handoffs,
ZIPs and screenshots are excluded from source control. This repository copy is
the maintenance target once its PR is merged.
