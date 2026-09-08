# Cross-project work guide

Open [the HTML guide](outputs/agent-device-work-guides.html) in a browser after
cloning this repository. GitHub's file view shows HTML source. Keep the adjacent
`architecture` folder for the full interactive viewers. The inline diagrams,
timeline and guide controls work in the single HTML file.

The hub owns this generated guide for agent-device-hub, codex-nanoleaf and
Divoom/Pixoo. GitHub issues remain authoritative for scope and status. The HTML
is a dated, reviewed view of those records. Its backlog, source review and
history timestamps describe separate evidence; none means a live dashboard.

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
4. Run the commands below. Inspect desktop/mobile and print renders for diagram
   changes. Commit inputs, generator, resulting HTML and viewers together.
5. After merge/issue closure, reconcile newly confirmed history and status in a
   linked follow-up PR if those facts were unavailable before merge. This does
   not require recursively recording guide-only synchronization PRs as product
   milestones. Record their maintenance in `updates.md` instead.

Updates require human or agent review; these instructions do not start a
scheduler, run devices, deploy the guide or grant additional mutation authority.
Concurrent deliveries rebase and reconcile the guide inputs before regenerating;
never merge generated HTML conflicts by choosing one side blindly.

## Commands

Run from the repository root. Python 3 with zoneinfo data builds the HTML offline.
The browser check additionally requires installed Node, Playwright and Chromium;
use `GUIDE_PLAYWRIGHT_MODULE` and `GUIDE_CHROMIUM_PATH` for their installed paths.
No product service or hardware test is needed for this document.

```bash
python3 docs/work-guide/work/build_guide.py
python3 docs/work-guide/work/test_maintenance.py
node docs/work-guide/work/check_guide.cjs
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
