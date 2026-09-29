# Portfolio Project maintenance

Use this procedure for authorized portfolio planning, Project maintenance and
delivery of a Project item. GitHub issues own workflow and acceptance. The
Project projects that state and the owner's planning choices; it does not
approve delivery or select work automatically.

## Authority and identity

Read the accepted [planning decisions](https://github.com/jimmie-potts/agent-device-hub/issues/536)
and [Project setup](https://github.com/jimmie-potts/agent-device-hub/issues/537)
at pickup, together with the selected issue and its current owner. These issues
own the current planning rules; do not copy their queue into repository docs.

The private [B.U.N.N.Y. Portfolio](https://github.com/users/jimmie-potts/projects/1)
is owned by `jimmie-potts`. Verify these identities against live reads:

| Object | ID |
| --- | --- |
| Project | `PVT_kwHOAu24Wc4Bkz2N` |
| Phase | `PVTSSF_lAHOAu24Wc4Bkz2NzhjjE0g` |
| Commitment | `PVTSSF_lAHOAu24Wc4Bkz2NzhjjE04` |
| Built-in Status | `PVTSSF_lAHOAu24Wc4Bkz2NzhjjEkM` |

Allowed repositories are `jimmie-potts/agent-device-hub`,
`jimmie-potts/codex-nanoleaf` and `jimmie-potts/divoom-app-upgrade`. Project access
does not authorize native issue edits or source changes in those repositories.
Read-only planning reports proposed changes without making them. Tracker-only
work changes only named items/fields. Normal authorized delivery includes routine
projection for its selected items under these rules; narrower user scope prevails.
No credentials, Project configuration, visibility, views or new fields are changed
by this procedure. Missing access remains a reported gap.

The owner chooses membership expansion, epic or standalone Phase, Commitment and
phase scope. A child's Phase derives from its native parent's approved Phase;
an authorized coordinator may repair that projection after reading the parent.
A standalone item stays blank until assigned. Shared work keeps one native parent
and links other consumers. Phase order creates no native prerequisite. Preserve
owner-selected Commitment even when work becomes blocked; readiness does not
select work. Read the current capacity and blocked-slot rules in the planning
decisions before proposing replenishment.

Discover option IDs by field ID on each run and verify their names against the
accepted planning decisions. An absent, renamed or conflicting field/option needs
reconciliation; do not silently create it or select a similar name. Phase and
Commitment are the only custom planning fields; do not invent Priority or Size.

## Checkpoints and decisions

At planning, add only authorized selected issues and project approved planning
values. At implementation and review, project verified native workflow. At
closeout, run [native tracker reconciliation](tracker-reconciliation.md) first
and project its verified results. Preserve its acceptance, owner-handoff and
unknown-evidence rules instead of reimplementing them here.

| Verified native state or owner decision | Project action |
| --- | --- |
| Open with exactly `status:backlog` | Status Backlog |
| Open with exactly `status:ready` | Status Ready; preserve Commitment, including blank for unselected work |
| Open with exactly `status:in-progress` | Status In progress |
| Open with exactly `status:review` | Status Review |
| Commitment Now and native blocker | Preserve Now and the workflow projection; retain the native blocker and account for the occupied slot under the accepted capacity rule |
| Closed completed, this issue's acceptance and native closeout readback verified | Status Done for that issue's stated acceptance only |
| Closed not planned | Clear Status; retain native closure reason, without a completion claim |
| PR merged, issue acceptance or main-CI gate pending | Preserve actual native workflow; do not infer Done from the merge |
| Open issue with missing/multiple workflow labels; closed issue with retained workflow labels; unknown closure reason or unavailable acceptance evidence | Leave projection pending; reconcile native state within its own authority |
| Owner-approved epic Phase change | Recompute each affected child's Phase from its native parent after fresh reads; preserve Commitment and prerequisites |
| Standalone/shared issue with no explicit Phase assignment | Keep Phase blank; do not infer assignment from a related link |
| Completed leaf, parent with unfinished acceptance | Leaf may be Done; parent retains its own verified state |
| Parent reconciliation or required policy unavailable | Report that native gap; Project success does not complete the parent |

The current Status field has no Not planned option. Blank Status preserves the
native distinction without inventing Done or changing the Project schema.

When capacity opens, propose triage/replenishment against the accepted rules;
the owner selects the next commitment. Material learning, owner selection changes
and phase entry/exit trigger an outcome review. Record an explicit
proceed/hold/revise/stop decision in existing issue evidence. Retain unfinished
source, installation and physical obligations, or link the owner's explicit scope
revision and its consequences. A phase move cannot erase them. Optional reminders
are not delivery timeboxes; this procedure starts no between-session automation.

## Read, compare, write and read back

One coordinator owns each affected update. Use existing GitHub CLI/API tools.
Record the exact issue URLs, repositories, Project, fields and task authority.
For an item or field with an active writer, obtain a field-specific handoff or
have that owner perform the update; a sent request is not acknowledgment.

1. Read the selected native issues, relevant parents, acceptance evidence and live
   Project fields/items. Complete relevant pagination, including nested label and
   field-value connections. Reject GraphQL responses containing errors even if
   they include partial data. Missing/inaccessible records are unknown, not absent.
2. Match membership by native issue node ID, never title or a draft copy. Confirm
   exactly one matching item. A complete read with no item permits an add only
   when membership was authorized. Duplicate or incompletely read membership
   stays pending.
3. Derive the intended values by field ID and compare them with current values.
   Equal values are a no-op, with no mutation, timestamp refresh or duplicate
   comment. Keep the intended field changes and preservation checks reviewable.
4. Immediately before writing, reread the native source, relevant parent, item
   and affected fields. If they changed, stop the affected write and reassess;
   preserve concurrent edits. Change one authorized field at a time and preserve
   other fields, native state, relationships, labels, assignees and configuration.
5. Read back the item identity, intended field, relevant source state and
   unrelated-field preservation. Recompute the comparison. Successful maintenance
   ends with zero remaining intended changes; report any unresolved discrepancy.

GitHub Project field mutations have no expected-value/version precondition.
These are optimistic coordination checks, not atomic compare-and-swap. A detected
race leaves the affected update pending and does not justify restoring a whole
saved item.

On timeout or a lost response, read authoritative state before retrying. If the
intended result is present and preservation checks pass, record verified success.
If the previous value remains, retry only after a fresh comparison confirms the
same authority and source. An unexpected value or unavailable read stays pending.
After an ambiguous add, enumerate membership by issue node ID before any retry;
reuse the unique item. Do not treat `clientMutationId` as an idempotency guarantee.
A reversal is a separately guarded change to the exact field, not a blind rollback.

Field writes use `updateProjectV2ItemFieldValue`; clearing uses
`clearProjectV2ItemFieldValue`; authorized membership uses `addProjectV2ItemById`.
Supply the verified Project, item and field IDs and the freshly discovered option
ID. For example, the following variables are explicit placeholders populated from
those reads; they are not existing item or option identities:

```graphql
mutation($project: ID!, $item: ID!, $field: ID!, $option: String!) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $project, itemId: $item, fieldId: $field,
    value: {singleSelectOptionId: $option}
  }) { projectV2Item { id } }
}
```

## Closeout receipt

In the existing task closeout, name updated or already-current items/fields,
authoritative readbacks, and pending discrepancies with their owner, reason and
next trigger. Preserve private snapshots under the main checkout's ignored
`.local/evidence/`; do not commit a Project inventory or a second status ledger.

Report native reconciliation, Project maintenance, source delivery, installation,
physical acceptance and guide publication separately. A failed Project update
does not erase verified source delivery. A correct Project does not establish
parent acceptance or a current published guide. Existing review, CI, merge,
installation and device gates remain in force.
