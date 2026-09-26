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

Selecting an issue link opens its task brief: the repository, number, title, a
GitHub link and copyable Explain, Plan, Implement and Review prompts for an
existing Codex or Claude session. Plan starts `plan-work` and Implement starts
`deliver-work`. Every prompt names the live issue URL. Only a current Execution
recommendation adds snapshot context: Implement then copies the story's saved
prompt, as described in the next section. A modified click, or a browser without
scripts, opens GitHub instead.
Other guide views open the same dialog with `openBrief(key)`.
`work/guide_brief.css` styles it.

The opening contains Current work, Newly added, Open defects, Useful next steps,
Blockers and decisions, and Later. Newly added shows the latest eight open issues
by creation date, plus an expandable seven-day list. Editing an issue does not
make it new. Open defects includes every open `bug`, including blocked and
deferred defects. Explicit `P0`–`P4` or `priority:p0`–`priority:p4` labels sort
first, followed by creation date. No priority or workaround is inferred.

The opening starts with the saved snapshot, including without JavaScript. A
successful complete GitHub read replaces that repository's opening-list membership
and status; a failed read keeps its complete snapshot. The opening's freshness
line names each source. New issues remain accessible through task briefs and
GitHub even before a guide assignment exists; an expandable list retains all
unassigned issues, including older ones outside the newest eight. Seven-day
membership uses each repository's own successful-read or snapshot time. A
successful complete read also replaces that repository's topic-guide
placement, notes, workarounds, highlights and counts, per the next section;
each topic's own outcome, next-step box and other editorial prose remain
dated. Recency and absence of an open prerequisite do not automatically make
an issue a recommendation.

Twelve topic guides own each open snapshot issue exactly once. The opening,
roadmap and architecture links do not add to those totals. Completed milestones
and retained evidence live in a separate expandable archive. Adding devices has separate Lines and Panels, wall map retirement, Tidbyt, LIFX,
PC-lighting, Roborock and other-integration tracks; deferred PC lighting starts
collapsed. Engineering maintenance has separate Hub, Nanoleaf and Pixoo tracks. Earlier guide anchors remain reachable. Search, Expand all and print
include archived evidence and the Direction and Ideas sections; printing restores
the reader's prior expansion state.

`work/guide_paths.py` owns the twelve topic names, their outcome and next-step
prose, aliases and track groupings; these are the guide's structure, not story
facts. Each open story's own `## Guide` section owns its topic, reading note,
workaround and highlight, per the next section. `work/guide_status.py` and
`work/guide_overview.py` select and render snapshot lists; `work/guide_overview.js`
applies complete public GitHub reads, including topic placement. Preserve the
matching selection rules when changing either implementation.
Pixoo embedded-host performance remains later by the owner's explicit choice,
even without a tracker `deferred` label. Its issue scope and acceptance stay intact.

## Guide sections

A story may carry one `## Guide` section: `**Topic:** <topic id>` (required,
one of the twelve ids `guide_paths.py` defines), `**Note:** ...` (optional,
one-line reading note), `**Workaround:** ...` (optional; shown only where a
workaround is displayed, currently Open Defects cards), `**Highlight:**
next step | decision | later | idea, <reason>` (optional; replaces a curated
next-step, decision or later pick, or marks an idea for the Ideas section) and
`**Extends:** <keys>` (optional, beside an `idea` highlight only; the stories
the idea would build on, as comma-separated guide keys such as `H67, N47`).
`work/guide_section.py` parses and renders
the section, sharing its markdown-section engine (`work/story_sections.py`)
with `work/recommendations.py`'s `## Execution recommendation` parser.

- A missing or unknown `Topic`, an unrecognized key, more than one section, a
  `Highlight` that does not read `next step | decision | later | idea,
  <reason>`, or an `Extends` line that sits beside no `idea` highlight, is not
  a comma-separated list of distinct `H<n>`, `N<n>` or `P<n>` keys, or names a
  story the snapshot does not hold makes the section unreadable: the snapshot
  build fails, naming the story,
  because every open story must carry a valid topic. There is no guessed
  default and no "assessment unavailable" fallback for the snapshot build.
- A story without a section is excluded from the snapshot's topic tables; the
  live path shows it as "topic assignment pending" instead.

`build_guide.py` derives topic-table coverage, notes, workarounds and
highlights entirely from these sections; it no longer reads a separate
coverage file or curated per-issue tables. A `next step`, `decision` or
`later` highlight populates exactly one of the opening's Useful next steps,
Blockers and decisions, or Later sections, replacing what a curated dict used
to supply. An `idea` highlight populates the Ideas section instead.

The live path (`work/guide_overview.js`) re-parses each successfully read
repository's open story bodies with the same grammar. A story unknown to the
snapshot, or reassigned since it, is placed in its live topic with its note
and gate; a story that closes live is removed from its topic, never moved
into the dated closed-evidence block. The Ideas section follows the same rules
(see below). Existing known rows patch their note,
gate and highlight-derived card in place; a genuinely new or moved-in row
lands in a "Newly added since the snapshot" block within its topic, so a
tracked topic (Adding devices, Engineering maintenance) never needs a live
guess at which curated track a story belongs to. Each topic's `N open` badge
and the matching sidebar count update to match, per successfully read
repository; a repository whose read fails keeps its topic placement, notes
and counts on the dated snapshot, same as its opening lists and badges. The
freshness line under the opening names which parts, including the ideas, are
live for which repositories and which parts (topic outcomes, next-step boxes,
history and the roadmap) stay dated regardless.

## Direction section

Beside the timeline's "Where we've been" and "Where we're going" panels, one
dated Direction section answers, in the owner's words, where B.U.N.N.Y. stands
on each surface, what it is becoming, what to build next and in what order,
what to improve in what already exists, and which later ideas are worth
keeping. Below the narrative, a computed "Least work, most unblocked" table
ranks open stories by how many other open stories record them as a native
GitHub prerequisite. It is a reference section: it adds nothing to issue
counts, and it joins search, Expand all and print.

`work/guide_direction.py` is the saved input, in the same pattern as
`guide_paths.py`: `AS_OF` and `REVISION` (the hub commit the text was written
against), `STANDING` (one entry per surface with its evidence keys),
`BECOMING`, `SEQUENCE` (ordered `(keys, why)` for what to build next),
`IMPROVEMENTS` and `DELIVERED_SINCE` (keys moved out of `SEQUENCE` at a
refresh, with the date). Its "Later ideas" list has no saved input: it lists
the stories marked `idea`, in Ideas-section order, and links to that section.
Text renders literally; keys render through
`issue_link`, so they carry the same status icon and live GitHub relabel as
every other link. The narrative is dated editorial prose and never claims live
state.

`guide_status.leverage()` computes the table from the native `blockedBy`
records that `load_dependencies` already asserts complete. For each open story,
Direct counts the open stories whose records name it, and Total follows those
stories' own records transitively, counting each open story once and never the
blocker itself. Only open stories carry a chain; a closed record or a blocker
outside the three repositories is not counted, and a cycle ends once every
reachable story has been seen. The renderer shows the ten highest Total values
with at least one dependent, each with its existing scheduling state
(candidate, active, blocked, deferred, or later by owner), "decision, no code"
for a story whose Guide highlight is a decision, and "in review" from its
label. Prose-only dependencies are not counted, and a high count is not a
priority; nothing in the table promotes a blocked, deferred or owner-later
story.

`build_guide.py` runs `guide_direction.check()` against the saved snapshot
before anything renders. Every cited key must exist in the snapshot, every
`SEQUENCE` key must be open unless it is listed in `DELIVERED_SINCE`, and every
`DELIVERED_SINCE` key must be closed, and no `SEQUENCE` story may carry an
`idea` highlight, because "build next" and "later idea" are exclusive; a
violation fails the build naming the key and the list. To promote an idea,
replace its `idea` highlight before adding the story to the sequence. The check is what keeps the text from going stale the way
`docs/roadmap.md` did before #170: a refresh that finds a closed story moves it
to `DELIVERED_SINCE` and rewrites the sequence.

## Ideas section

After Direction, one Ideas reference section (sidebar "I · Ideas") lists every
open story whose own Guide section carries `**Highlight:** idea, <reason>`: a
new capability, a generalization across devices or repositories, or a
user-visible win that recent work made cheap. The mark is a placement, not a
status, label or priority. It never promotes a blocked, deferred or
owner-later story. Ideas are counted in their topics, not here; the sidebar
count is informational.

`work/guide_ideas.py` renders the section. Entries group by topic in
`guide_paths.TOPICS` order and, within a topic, by story key. Each entry shows
the story through `issue_link`, its reason as literal text, its `Extends` keys
through `issue_link`, and its scheduling state from
`guide_status.scheduling_state` (candidate, active, blocked or deferred). The
section joins search, Expand all and print, and uses role tokens only
(`work/guide_ideas.css`). Direction's "Later ideas" lists the same stories in
compact form.

The live path re-parses each successfully read repository's open bodies with
the same grammar. A story newly marked, or moved to another topic, since the
snapshot lands in a "Newly added since the snapshot" block inside its topic
group; a story that closes live or loses its mark is removed; existing rows
patch their reason, `Extends` and state in place. A repository whose read
fails keeps the snapshot's rows. Direction's "Later ideas" follows. The live
path checks only the form of `Extends` keys, because it reads open stories
alone; the snapshot build also checks that each key exists. A key the live read
cannot place links to GitHub without a status claim.

An idea often extends work that has since closed. `refresh_backlogs.py` reads
and saves every story an open story's `Extends` names that the refreshed
records lack, so the build's existence check passes without a hand-kept list.
Marks reach the saved snapshot only at a backlog refresh. Until then, readers
without scripts, or whose GitHub read fails, see the snapshot's marks.

## Execution recommendations

A story may carry one `## Execution recommendation` section that names the
session to start in Claude Code and in Codex: model, thinking level, session type
(`One-shot`, `Pair`, `Orchestrate` or `Investigate first`), worker subagents, the
two final reviewers, availability and the prompts to paste. The `plan-work`
policy's `references/execution-recommendations.md` defines that shape, as merged
in [`agent-skills@3746fab`](https://github.com/jimmie-potts/agent-skills/blob/3746fab762ad00e708199e698f8e8b580c818d82/skills/plan-work/references/execution-recommendations.md).
This README covers only how the guide reads and shows the section, and the
fingerprint this repository puts in the policy's fingerprint slot.

`work/recommendations.py` parses the section from the saved story bodies in
`work/backlogs/*-issues.json`. The parser is strict and never fills a gap:

- A missing host value, table row or prompt, an unknown key, table row or session
  type, a duplicate section, stray text, availability that does not start with
  `Verified` or `Provisional`, or a `Reviewers` value that is not `None` exactly
  for `Investigate first` makes the story "Assessment unavailable". So does a
  `Cheaper start` line without both cheaper prompts, unless it starts with
  `none recorded`, and a fingerprint other than 12 hex characters: this
  repository always fills the slot, never with `not used`.
- `**Status:** insufficient` with `**Missing:**` shows "Insufficient information"
  and the missing input. That form carries no answer, table or prompts.
- A story without a section shows "Not yet assessed".
- The `**Assessed:**` line ends with a `fingerprint:` code span holding the first
  12 hex characters of the SHA-256 of the story body with this section and the
  `## Guide` section removed, after normalizing line endings, trailing spaces and
  blank-line runs. The build recomputes it from the saved body. A different value
  shows "Needs reassessment (story text changed after <date>)". Labels, state and
  dependencies are not in the body, so a status refresh neither confirms nor
  stales a recommendation. Prompt blocks sit inside the section, so editing a
  prompt does not stale it. The Guide section is placement metadata, so adding,
  moving or rewording it does not stale it either; keep scope out of its notes.

A section may also carry a `**Work surface:**` line, directly after `**Start
with:**` (or, in the `insufficient` form, after `**Missing:**`), with exactly
one value: `UI`, `Backend` or `Unknown`, as defined in
[`agent-skills@2d5b86a`](https://github.com/jimmie-potts/agent-skills/blob/2d5b86a25f2204bffc3529431923420c316fcdbf/skills/plan-work/references/execution-recommendations.md).
The guide shows it as a badge in the task brief's "Start with" block and next
to each open story's entry. A story without the line shows "Not classified";
the guide never infers a value. An unknown value makes the whole section
"Assessment unavailable", the same as any other unreadable line.

Topic rows and opening cards show one text label per story, session type first,
for example "Start One-shot · Sonnet medium / Luna medium". Live GitHub reads keep
each story's snapshot label; a story missing from the snapshot shows "Not yet
assessed". The fingerprint is not rechecked in the browser, so a story edited
after the snapshot keeps its dated label until the next guide refresh.

The task brief shows a "Start with" block above the actions: the state, assessment
date and policy revision, the story's recorded complexity, uncertainty and impact,
the answer line, a two-host table with a verified or provisional label per host,
and a details element with the reasons, availability and reassessment trigger.
While the recommendation is current, Implement offers a host toggle (Claude Code
or Codex, remembered in browser storage when available) and a start toggle
(Recommended or Cheaper; Cheaper is disabled and shows the recorded reason when
none is recorded), and copies
the saved prompt verbatim. Every other state uses the generic Implement prompt and
says why. Explain, Plan and Review never change. Printing an open brief prints it
with its details expanded.

`recommendations.py upsert` writes sections from assessor input, a JSON list kept
outside Git in the main checkout's `.local/evidence/`. It does not assess. For each
story it re-reads the live body and replaces only this section, adding a `## Work
assessment` section only for ratings the story does not already record. It renders
the prompts from one template per session type and host; implementing prompts
authorize the two reviewers named in the `Reviewers` row. It keeps the recorded
date when the fingerprint is unchanged, writes nothing when the section is
unchanged, refuses a story edited after the input's `read_at` time or while it is
being written, and reads the result back. Run it with `--dry-run` first;
`--receipt` appends one JSON line per story. `recommendations.py report` lists
the saved state of every open story.

```bash
python3 docs/work-guide/work/recommendations.py upsert --input <entries.json> --dry-run
python3 docs/work-guide/work/recommendations.py report
```

## Skin and tokens

The guide and the B.U.N.N.Y. atlas share one skin, Neon Geometry Wars. Both
generators inline `docs/skins/fixed.css` and then
`docs/skins/neon-geometry-wars.css` ahead of their own CSS. Guide and atlas
styles use token names only; color values live in those two files.

- Fixed tokens, in `fixed.css`, keep their meaning in every skin. Each has a
  dark, light and print shade, and no skin redefines them. They cover repository
  identity (`--repo-hub`, `--repo-nanoleaf`, `--repo-pixoo`), issue status
  (`--status-open`, `--status-active`, `--status-blocked`, `--status-completed`,
  `--status-closed`), atlas document status (`--status-delivered`,
  `--status-planned`, `--status-qualification`, `--status-mixed`,
  `--status-optional`), map edge keys (`--edge-observe`, `--edge-feed`,
  `--edge-command`, `--edge-other`) and alternative walkthrough lanes
  (`--walk-alt`).
- Role tokens, in the skin file, name what a value is for. Surfaces: `--bg`,
  `--panel`, `--panel-translucent`, `--raised`, `--inset`. Text: `--text`,
  `--muted`. Borders: `--edge`, `--edge-strong`, `--edge-faint`. Accent and
  selection: `--accent`, `--accent-ink`, `--link`, `--focus`. Pending:
  `--pending`. Decoration: `--glow`, `--grid-image`, `--grid-size`. Shape:
  `--radius`. Type: `--font`, `--mono`, `--type-body`, `--type-small`,
  `--type-label`. Spacing: `--space-xs` through `--space-xl`.

`<html>` carries `data-skin` and `data-theme="dark"` or `"light"`. Before the
page paints, a small head script applies the stored theme (or the system
preference) and removes the `bunny-design-motion` key left by the retired Pause
motion control. The guide and the atlas share the `bunny-design-theme` key, so
a choice carries between them. Without scripts, CSS follows the system
preference. Print uses its own palette and shows no decoration.
`docs/skins/skin.py` gives both generators the stylesheet, the head script and
the Light mode toggle.

The skin's decoration is the corner brackets, the top and sidebar rules, the
hero artwork and glow, an opening of about 2 seconds, and a circuit trace: a
pulse that runs once down the page background through a tiled circuit pattern
from 0.5 to 3.1 seconds, then leaves the layer transparent. It uses CSS
animation only, scoped to `html[data-skin="neon-geometry-wars"]`. The trace
passes behind content; no decoration is drawn over text, issue badges or diagram
edges, and none of it indicates live agent or device activity. Every animation plays once per load and ends within 5 seconds,
so the pages have no pause control (WCAG 2.2.2); `prefers-reduced-motion` stops
it entirely. A skin must keep that limit or bring back a pause control.

To add a skin, copy `neon-geometry-wars.css` to a new `<name>.css` and change
only values and decoration. Keep every role name and all four token blocks:
dark, light, the no-script light fallback (identical to the light block) and
print. Scope decoration under `html[data-skin="<name>"]`, then set `SKIN` in
`docs/skins/skin.py` to the new name. The token check fails on a color literal
in any guide or atlas style source, a missing or unknown role, a skin that
redefines a fixed token, a fallback that differs from the light block, or
decoration outside its skin scope:

```bash
python3 docs/skins/check_tokens.py
```

`work/test_maintenance.py` and `docs/system-design/check.py` run the same check.
Both browser checks run `docs/skins/check_skin.cjs` for the theme control, the
5-second one-shot motion limit, reduced motion, print and decoration placement.

The nine Archify viewers and the atlas's API and database reference
(`docs/system-design/reference/`, with its bundled Scalar and SchemaSpy output)
keep their own styling and are outside the token check.

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
The hub, Nanoleaf and Pixoo source repositories are public (checked September
25, 2026), so issue, PR and source links open without a GitHub sign-in. The
separate publication repository keeps the site limited to reviewed exports at
its existing URLs.

This task's coordinator owns the hub source PR and the linked public publication
PR. After a guide change merges and all applicable main CI jobs pass, or the
[guide-only CI receipt](../sdlc.md#guide-only-ci-exception) is verified:

1. Use the validated output from that exact hub revision. Run
   `python3 docs/system-design/export_public.py /absolute/new/site-stage` from
   a clean archive of the same Hub revision. The exporter stages the guide as
   `index.html`, nine viewers under `architecture/`, and the atlas under
   `atlas/`. It changes the guide's local atlas link to the public path. Copy
   these staged bytes into the public repository. The public allowlist is these
   ten guide/viewer HTML files,
   the exporter-manifested atlas files, `.nojekyll` and the public README. Do not
   copy atlas authoring sources, generators, tests, fixtures or caches.
   Inspect their contents as well as filenames for credentials, private runtime
   data, personal paths, and unrelated material before public copying. Repair
   such content in the owning inputs and regenerate before renewed review.
2. Update the public README with the hub source revision, guide SHA-256, atlas
   manifest SHA-256 and atlas entry-point URL.
   Retain the snapshot dates in the generated HTML. Do not refresh data or edit
   generated content in the public repository.
3. Open a public-repository PR from an isolated branch/worktree. Link the hub
   companion PR and obtain independent Standards and Specification reviews of
   the fixed candidate. Validate the guide, atlas and relative viewer links,
   confirm the file allowlist and hashes, and pass all configured CI before
   guarded merge. Atlas UI outside `docs/work-guide/` needs explicit human
   approval of the fixed candidate under `docs/sdlc.md`.
4. GitHub Pages publishes the public repository's merged `main`. Read the
   successful deployment and verify the unauthenticated HTTPS landing page,
   all nine viewers and every atlas-manifested file against the reviewed source
   hashes. Record both PRs, source and published revisions, and the deployment
   result in the delivery receipt. A repository hash, successful Pages response
   or representative page check alone is incomplete acceptance.

Copying from the hub to the publication repository is an explicit publication
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
   and narrative in `work/build_guide.py`. Review `work/guide_direction.py`:
   move delivered keys to `DELIVERED_SINCE`, rewrite the sequence, and update
   `AS_OF` and `REVISION` when the text changes; the build fails naming any
   cited story that closed without that review. Refresh queries can partially
   write files on failure; discard or complete that candidate before publishing
   it. Every open issue must have exactly one primary guide. Reference links do
   not own issues or increase counts.
2. Update history inputs in `work/history/github-history.json` from paginated
   read-only GitHub queries when recording merged work. Keep PR creation, source
   merge, installation and physical acceptance distinct. Never predict a merge
   date or close an issue in the guide before its authoritative source does.
3. When ownership or command flows change, update pinned architecture sources,
   SHA-256 receipts and definitions in `work/architecture_diagrams.py`. Render
   using the centrally installed archify skill; do not install or vendor it.
   Retain implemented/planned labels and each diagram's failure boundaries.
   The B.U.N.N.Y. atlas under `docs/system-design/` embeds the system map and the
   observation walkthrough from these same definitions; rebuild and check it
   after re-rendering either of them. Those two keep `sourceRevisions`; other
   diagrams may pin newer sources through `viewRevisions` and a `revisions`
   entry. `build_guide.py` fails when a definition no longer matches its saved
   specification or render receipt, so re-render after every definition edit.
   Each sequence diagram needs one walkthrough phase per segment; number the
   main-path segments and label alternatives separately.
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
The browser check additionally requires installed Node, Playwright and Chromium.
After `npm ci`, the repository's pinned Playwright resolves by default, and the
check prefers full Chromium builds, as CI does; use `GUIDE_PLAYWRIGHT_MODULE`
and `GUIDE_CHROMIUM_PATH` to override their paths. The check never installs
software.
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
