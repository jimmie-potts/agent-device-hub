# Session retirement compatibility

[Hub #218](https://github.com/jimmie-potts/agent-device-hub/issues/218) owns the
Codex Desktop retirement change and its acceptance; [Hub #241](https://github.com/jimmie-potts/agent-device-hub/issues/241)
extends the same owner rule to Codex CLI and Claude Code. This document describes
the source contract; revision-specific checks and delivery status belong in the PRs.

| Component | Contract and reconciliation |
| --- | --- |
| Agent State 3.2.0 | One durable replacement removes an ended record and known descendants on every supported path. The normal revision feed announces removal. A new admission gets a new generation. Opening an older store settles records holding an accepted end. |
| Hub 0.3.4 | Default sessions remain snapshot 1.0. `snapshotVersion=1.1` includes generations, with the outer monitoring envelope still 1.0. Unknown versions fail explicitly. |
| Dashboard | Requests 1.1 and includes generation in task form identity. A missed retirement discards old task drafts; ordinary reconnect preserves them. No device command is implied. Ending one path leaves the other paths' rows in place. |
| Nanoleaf companion | Requires 1.1. Validates generations and projects the remaining fields through its unchanged pinned 1.0 Python validator. Saved generations distinguish recreation across restart and missed absence. Task rows are reset inside the existing transaction; global project definitions and reservations survive. It applies no provider-specific end filter. |
| Pixoo at the existing source pin | Continues reading 1.0. Its pager derives current rows from each snapshot; authoritative absence removes rows and recreation uses current labels and notices. Feed loss retains uncertain evidence. No source change is needed for retirement on any path. |
| Tidbyt | Continues reading 1.0. Its existing publisher derives status and idle from the latest healthy snapshot. Empty reconnect follows installation removal through its existing queue/cadence; unavailable input does not establish empty state. |

The focused harness uses the revisions in
`apps/hub/fixtures/pixoo-source.json` and
`apps/hub/fixtures/retirement-nanoleaf-source.json`. It feeds real owner snapshots
and the shared fixture corpus into the candidate consumers without launching a
physical writer, once per supported path through `RETIREMENT_PATH`. Existing
dashboard and Tidbyt suites cover their own browser and publisher paths on every
path. These are candidate source checks, not release or installed compatibility
claims.

## Durable state and rollback

Durable format 2.0 stores generation and bounded retirement evidence. Opening a
format 1.0 store performs a guarded replacement, preserves evidence clocks and
existing state, and assigns imported sessions generation zero. Consumers must
retain the selected owner's revision lineage; resetting a store is not a
supported way to reset generations.

Retirement guards retain at most 128 identities for 24 hours, with at most 256
known turns, deduplication keys and ordering epochs per identity. They are
independent of active-session capacity and the shorter journal. Recognizable
old events cannot recreate a retired task or remove its fresh replacement.
Unknown identity/order evidence and evicted guards cannot prove which
incarnation an event belongs to. Positive archive evidence is an additional
admission safeguard for Codex Desktop conversations only, not a second
retirement authority.

Install the compatible Hub before activating the upgraded Nanoleaf reader. A
1.0-only host cannot meet that reader's generation requirement. Older consumers
can still read the default 1.0 endpoint but cannot detect missed retirement from
generation metadata. Owners before 3.0.0 cannot read format 2.0. Agent State
3.2.0 keeps format 2.0 but writes Claude Code and Codex CLI retirement guards,
which the 3.0 and 3.1 validators reject regardless of age: those owners fail
closed with `invalid-storage` (internally `invalid-state` on open or
`invalid-import` on import) on any store or export holding such a guard. A
guard expires 24 hours after its retirement, but only a running or reopened
3.2.0 owner prunes it from the store; a stopped store keeps it indefinitely.
To roll back to 3.0 or 3.1, keep the 3.2.0 owner running, or reopen it once,
at least 24 hours after the last Claude or CLI retirement so that it prunes
the guards, and only then stop it and hand off. Otherwise export through the
3.2.0 owner after that point and use an explicitly reconciled export. An older
owner would again retain Claude and CLI ends until expiry. Do not point an
older binary at the newer store or silently discard retirement evidence.

## Upgrade treatment of retained records

Owners before Agent State 3.2.0 retired only Codex Desktop records. A Claude
Code or Codex CLI end they accepted was reduced into the record instead. With
qualified ordering, or while activity was still unknown, the record holds
activity `ended`. The packaged hooks supply no ordering, so an end delivered
after a turn on an active or idle record left activity `unknown` with ambiguous
activity evidence; the bounded diagnostic journal also kept a `runtime.ended`
row for that session for up to 24 hours.

Opening such a store with the new owner settles it once, at startup. Every
record with activity `ended`, and each known descendant, is retired in one
durable replacement with the same bounded guards as a live end. When nothing
else is due, that replacement is also the format 1.0 migration; when expiry is
also due, expiry commits first in its own revision. Nothing is acknowledged, no
read state is written, no evidence clock is reset, no journal row is added and
no old effect is replayed. Every other record, including the hook-shaped
`unknown` ones and idle, waiting and interrupted ones, is retained unchanged
with its own 24-hour expiry fallback. The journal row is deliberately not used
as retirement authority: the specification keeps diagnostic history bounded and
non-authoritative, and the affected records expire within 24 hours of their
last evidence. A hook-produced Claude or CLI end accepted by an older owner
therefore keeps its record until that expiry; ends accepted by the new owner
retire immediately. The owner never infers an old end from idle or unknown
activity and never scans transcripts. A delayed old event for a settled record,
including its original start, is guarded like any other retirement, and an
eligible new start creates a fresh record with a new generation. The legacy-state
fixture in the owner tests covers the `ended`, hook-shaped `unknown`, idle,
waiting and unknown cases for an already-stored format 2.0 store and an imported
format 1.0 store, and a settlement whose commit fails leaves the store unchanged
for the next open. The reducer no longer produces `ended`; the value remains in
the schemas only for stores that predate this rule.

## Acceptance boundary

Source work changes no installed owner, hook, Codex state or physical device.
The separately authorized archive trial established owner retirement, dashboard
removal and visible Nanoleaf Line release for Codex Desktop. Installed read-task
retention and device-local eviction were also observed. Displays retain their
existing polling and write cadence; current-candidate UI approval remains a
separate delivery gate.

The selected Desktop task did not reliably emit a non-archive end during the
installed idle/shutdown trials. [Hub #253](https://github.com/jimmie-potts/agent-device-hub/issues/253)
owns that native emission investigation and subsequent reopen-without-prompt and
live-resume qualification, under the user-approved scope split. The Codex CLI and
Claude Code paths adopted by #241 were observed on the installed Hub 0.3.7 for
[Hub #312](https://github.com/jimmie-potts/agent-device-hub/issues/312).
[Provider qualification](provider-qualification.md#installed-cli-and-claude-observation)
records the emitted events and the owner's removal and recreation for normal
exit, `/clear` and resume.
Codex CLI 0.156.0 ended a cleared session only when the CLI exited, in one run
whose emission was inferred from the owner. An accepted end retires its known
session tree; quitting a client does not establish that every record received an end. No new thirty-minute timer or global clear is
provided. The existing twenty-four-hour evidence expiry remains the fallback.
Native mode automation remains owned by Nanoleaf #110.

Nanoleaf's existing policy suppresses completion comets and waves whenever its poll skips owner revisions. [Nanoleaf #115](https://github.com/jimmie-potts/codex-nanoleaf/issues/115) owns that limitation. This companion preserves that policy while preventing a retired task's effects from returning.
