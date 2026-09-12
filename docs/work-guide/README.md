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

## Planning and delivery checkpoints

The shared checkpoint contract was introduced by
[agent-skills #33](https://github.com/jimmie-potts/agent-skills/issues/33) at
[`ff80d24`](https://github.com/jimmie-potts/agent-skills/blob/ff80d247ea96a5d4c461d30a2c24148376197c7b/skills/deliver-work/references/documentation.md).
Discover the installed canonical skills when explicitly invoked. `plan-work`
reads the discovered `deliver-work` package's `references/documentation.md`
without invoking delivery. Report a missing required resource; do not install or
copy it silently. Ordinary repository maintenance follows this procedure without
implicitly invoking either skill.

At discovery, name the work source, guide coordinator, affected repositories,
canonical inputs, requested finish line, and authorized effects. Use the existing
task/PR evidence. A source-only or tracker-only request keeps its narrower limit;
these instructions do not supply permission to publish the site.

| Checkpoint | Required result |
| --- | --- |
| After authorized planning publication | Read back saved scope/dependencies, refresh affected inputs, reconcile primary coverage and roadmap order, and retain proposed architecture as planned. Tracker-only work reports guide/publication pending; read-only planning writes nothing. |
| Before implementation and candidate review | Assess guide/architecture impact. Prepare affected inputs and regenerated output in the source candidate or linked Hub companion PR. |
| After verified merge and acceptance updates | Reconcile actual history and saved issue state. Keep source, installation, real-client and physical acceptance distinct. Use a follow-up for facts unavailable before merge. |
| Authorized public publication | Publish validated output from the exact merged Hub revision through the process below, then verify what unauthenticated readers receive. |

One delivery coordinator owns links among device-source PRs, the Hub companion,
and the public publication PR. Report source/tracker completion, guide-source
synchronization, public artifact publication, and live verification separately.
For each applicable stage give its revision/evidence or pending owner and next
action. Required pending stages prevent full completion at the requested finish
line, even when the source work has merged.

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
merge alone does not update the website; report pending publication when the
public copy has not caught up. Keep the hub guide-maintenance entry with the
source PR, including a specific no-impact reason for hosting-only changes.
An unchanged source output can still have a stale public copy. If all required
public revision, content and deployment evidence already matches, record that
no-change result instead of creating an empty publication PR.

## Maintain it with each delivery

At the start of every authorized planning, implementation, bug fix,
documentation or acceptance task, inspect the affected guide and diagrams.
Before completion, record a dated entry in `updates.md` with the repository,
issue or PR, result, affected sections and validation. If the work changes no
represented fact, record the reason and preserve the existing snapshot dates.
Read-only questions and reviews do not independently authorize document writes.

For changed facts, update the owning inputs and regenerate the HTML in the same
hub PR. For device-repository work, the delivery coordinator owns a linked hub
companion PR. Include its URL and status in the device PR and completion report.
A pending companion PR means guide synchronization remains pending. Do not claim
the guide was updated merely because the device source merged.

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
4. Run the commands below. Guide-only CI filtering does not waive these local
   checks or the review evidence required by the [SDLC exception](../sdlc.md#guide-only-ci-exception). Inspect desktop/mobile and print renders for diagram
   changes. Commit inputs, generator, resulting HTML and viewers together.
5. After merge/issue closure, reconcile newly confirmed history and status in a
   linked follow-up PR if those facts were unavailable before merge. This does
   not require recursively recording guide-only synchronization PRs as product
   milestones. Record their maintenance in `updates.md` instead.

Updates require human or agent review; these instructions do not start a
scheduler, run devices, deploy the guide or grant additional mutation authority.
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
