# Issues and epic-first planning

Use **Epic** for a bounded outcome, **Work item** for an independently verifiable
increment, and **Bug** for a failure with reproduction and expected behavior.
The [templates](../.github/ISSUE_TEMPLATE) share these meanings across Hub,
Nanoleaf and Pixoo. Keep work in its owning repository.

## File the smallest useful issue

Outcome and observable acceptance are required. Add implementation, preservation
and deferral details when they affect the work. Keep the recognized headings;
an unused conditional section may stay empty. A small issue needs no model
choice or Execution recommendation. Apply the [scope defaults](sdlc.md#scope-defaults)
without inventing irrelevant requirements. Hub's [new-story opening](sdlc.md#new-story-opening)
still applies to new feature, maintenance, investigation and child stories;
existing bodies are not reformatted at pickup.

The templates use Markdown to preserve authored headings. Their frontmatter is YAML chooser metadata, not issue
content. GitHub cannot enforce required fields in a Markdown template: replace
prompts, remove instructional comments and inspect outcome and acceptance before
filing. Bug drafts also need actual/expected behavior, setup, reproduction or its
known evidence gap, and a regression check. No live test issue is necessary.

An epic states its outcome, real setup, smallest useful release, required and
optional children, exclusions, unresolved decisions, reassessment trigger and
its own end-to-end acceptance. Keep source, installed/client, human and physical
evidence separate. Required children closed as completed are necessary only for
their stated scope; they do not prove the parent outcome. A required child closed
as not planned needs an explicit scope decision. Optional work cannot hold the
required release open. Phase remains unassigned until the owner selects it.

## Classify and connect

- `epic` explicitly classifies a bounded outcome. A title containing “Epic” or
  an issue with children alone is insufficient for epic classification.
- `idea` identifies an uncommitted possibility that needs refinement before
  delivery selection. It may coexist with `epic` for a deferred concept. Remove
  it only through an authorized refinement/selection decision; do not infer
  Commitment Ideas or any other Project value from it.
- `bug`, `enhancement`, `maintenance` and `documentation` describe work.
  Existing `status:*`, `blocked` and `deferred` meanings stay unchanged.

After filing, use GitHub's native parent/sub-issue controls to add approved
membership. Cross-repository children retain their source owner. Each issue has
one native parent; shared inputs keep that parent and other consumers link to
them. Native blocked-by relationships record true prerequisites, separately from
membership. A checklist, related link or Extends mark creates neither relation.
Keep existing parents, held decisions and unrelated fields during migration;
check for cycles and read back every authorized change. Standalone bugs,
investigations and small improvements are valid.

## Use the existing portfolio

Reuse [B.U.N.N.Y. Portfolio](https://github.com/users/jimmie-potts/projects/1).
The [accepted planning decisions](https://github.com/jimmie-potts/agent-device-hub/issues/536)
and [maintenance procedure](project-maintenance.md) own field values, capacity,
write authority and readback. This recipe creates no Project or configuration.

1. Add authorized existing issues by identity, not duplicate draft cards. Begin
   with epics; include selected stories for delivery views.
2. Use built-in Title, Repository, Labels, Status, Parent issue and Sub-issue
   progress. Phase and Commitment remain the only custom planning fields.
3. Save an epic table filtered by `is:issue is:open label:epic`, grouped by Phase.
   Keep unassigned epics visible. Add Commitment and Sub-issue progress columns.
4. Keep a story board filtered by
   `is:issue is:open -label:epic commitment:Now`, grouped by Status. Inspect one
   epic with `parent-issue:"OWNER/REPO#NUMBER"`. Keep an Ideas view using
   `is:issue is:open label:idea`; that is classification, not selection.
5. Preserve the owner's Phase and Commitment choices. An epic's Phase is
   authoritative; child Phase is a derived projection. Standalone/shared work
   needs an explicit assignment. Blank remains unassigned/unselected. Commitment
   never inherits from a parent. Ready means feasible, not selected as Now.

Phase describes a capability outcome, not a calendar or design/build/test stage.
Now is selected work within capacity; Next is the small selected candidate queue;
Later is a plausible direction; Ideas is an explicitly retained possibility.
The owner chooses these values. Native issue status remains workflow authority;
Project Status projects it. Child progress counts issues, not effort, installed
success or satisfaction of the epic's acceptance. Keep a standalone path and
avoid making every backlog item a required child just to eliminate orphans.

Preserve Project visibility, fields and existing views unless their change is
authorized. Publication of private planning data is separate work.

## Validate drafts

Parse YAML frontmatter, remove template instructions and inspect the completed
body's outcome, scope and acceptance. Keep native membership and blockers separate
from authored prose. Run the repository's workflow checks; do not create issues
solely to test intake. New stories need no Guide metadata. Historical issue bodies
remain valid without a bulk rewrite.
