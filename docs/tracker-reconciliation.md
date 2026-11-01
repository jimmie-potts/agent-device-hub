# Native issue reconciliation

Apply this procedure at the [SDLC checkpoint](sdlc.md#tracker-reconciliation).
The coordinating writer owns discovery, authorized updates and the closeout
receipt. Use existing GitHub CLI/API access and recommendation tooling. GitHub
issues remain authoritative; do not create a second status store.

## Discover the affected records

Read the selected issue, its acceptance evidence and current ownership. Follow
parents, dependencies and tracker links only where this change affects their
acceptance, next action or ownership. Do not recursively audit unchanged parent
chains or the backlog. Paginate only the relationships needed for that decision.

A failed, unavailable or incomplete relationship read means unknown, not an
empty graph. Record the affected discovery gap and its consequence. Continue
independent checks where their evidence is sufficient, but do not claim complete
reconciliation or change an outcome that depends on the missing relationship.

## Assess acceptance and remaining work

For each affected criterion, identify delivered evidence or the remaining
obligation, its owner and its next action. Distinguish:

- Required children from optional children.
- Completed closure from not-planned closure.
- Source, installation, host, human and physical acceptance.
- Current holds from completed prerequisites retained as historical evidence.

Recheck the parent's own finish line before closing or reopening it. Closed
children, checked lists and merged PRs do not establish the parent's outcome.
An optional child does not block an otherwise accepted parent; a required child
closed as not planned does not satisfy its obligation without an authorized
scope decision. Reopened acceptance requires reassessing the affected parent,
not automatically reopening every ancestor.

Remove a current hold only when its required evidence is satisfied or its
obligation has been explicitly retired. Preserve unresolved owner holds and
historical provenance. A dependency's closed state alone is insufficient.
Change native relationships only when their meaning has changed; check for
cycles. Do not reparent shared work, change portfolio selection, silently cut
accepted behavior or restart a postponed evaluation.

For observation or cohort-dependent acceptance, retain actual cohort/window
dates, missing observations and the evidence still needed. Derive the next
eligible checkpoint from those dates and the owning criterion. If dates or
criteria are unavailable, name that missing input. Do not invent mature windows,
promise automatic between-session execution, or treat a guide refresh or Project
update as acceptance evidence.

## Reassess execution recommendations

Existing issues may carry Execution recommendations from earlier planning.
They are optional advice, not delivery gates, and new stories do not add one
(see the [scope defaults](sdlc.md#scope-defaults)). When an existing
recommendation becomes materially stale, mark its outdated assumption and
current next step; do not generate a new model assessment or fingerprint merely
because a PR completed. Dedicated maintenance of those existing sections still
uses [the canonical tooling](../apps/maintenance/recommendations/README.md)
and its parser/dry run. Routine delivery does not require that separate workflow.

## Write narrowly and recover from uncertainty

Respect the active writer's ownership before editing a record or held section.
Obtain a section-specific handoff or let the owner make the update. A sent
coordination message is neither acknowledgment nor completed acceptance.
Continue unaffected work and report the held update with its owner, reason and
next trigger.

Immediately before each write, reread the authoritative body, state, labels and
relationships relevant to that change. Compare them with the reviewed state.
If another writer changed the record, reassess against the new state before
writing; never overwrite it with a saved body. These checks are optimistic
coordination, not an atomic compare-and-swap guarantee.

Change only affected sections, checkboxes, labels and native relationships.
Preserve unrelated prose and edits. Apply the SDLC's existing label rules.
Read back each result and verify both the intended change and preservation of
unrelated data. If a write returns an ambiguous result, inspect authoritative
state before retrying. Resume only the missing authorized change. Keep stderr
visible on every tracker write, including the delivered issue's closure; an
exit status or silence is not verification. A close of #877 failed unseen while
its stderr was discarded.

Unchanged inputs and an already correct record produce a no-op: do not rewrite
text, refresh dates or fingerprints, or add duplicate comments. Preserve enough
before/after and readback evidence to distinguish an update, genuine no-op,
unverified write and blocked reconciliation.

## Report the checkpoint

Include a concise receipt in the existing closeout:

- Affected trackers updated or already current, with evidence/readback links.
- Acceptance still pending, including observation dates and the next checkpoint
  where relevant.
- Reconciliation blocked or unverified, with its owner, reason and next trigger.

Keep private receipts in the main checkout's ignored `.local/evidence/` area.
A related tracker or access failure does not erase separately verified source
delivery and does not justify false parent closure or complete-reconciliation
claims.

Existing acceptance, independent reviews, current-head CI, guarded merge and
merged-main readback remain required. The work guide stays a dated publication;
Project fields remain projections under their own authority. This manual,
event-triggered procedure adds no scheduler, scanner, model study, guide rebuild
requirement or cross-repository instruction rollout.
