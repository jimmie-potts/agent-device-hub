# Desktop retirement compatibility

[Hub #218](https://github.com/jimmie-potts/agent-device-hub/issues/218) owns the
retirement change and its acceptance. This document describes the source
contract; revision-specific checks and delivery status belong in the PRs.

| Component | Contract and reconciliation |
| --- | --- |
| Agent State 3.0.0 | One durable replacement removes an ended Desktop record and known descendants. The normal revision feed announces removal. A new admission gets a new generation. |
| Hub 0.3.0 | Default sessions remain snapshot 1.0. `snapshotVersion=1.1` includes generations, with the outer monitoring envelope still 1.0. Unknown versions fail explicitly. |
| Dashboard | Requests 1.1 and includes generation in task form identity. A missed retirement discards old task drafts; ordinary reconnect preserves them. No device command is implied. |
| Nanoleaf companion | Requires 1.1. Validates generations and projects the remaining fields through its unchanged pinned 1.0 Python validator. Saved generations distinguish recreation across restart and missed absence. Task rows are reset inside the existing transaction; global project definitions and reservations survive. |
| Pixoo at the existing source pin | Continues reading 1.0. Its pager derives current rows from each snapshot; authoritative absence removes rows and recreation uses current labels and notices. Feed loss retains uncertain evidence. No source change is needed for retirement. |
| Tidbyt | Continues reading 1.0. Its existing publisher derives status and idle from the latest healthy snapshot. Empty reconnect follows installation removal through its existing queue/cadence; unavailable input does not establish empty state. |

The focused harness uses the revisions in
`apps/hub/fixtures/pixoo-source.json` and
`apps/hub/fixtures/retirement-nanoleaf-source.json`. It feeds real owner snapshots
and the shared fixture corpus into the candidate consumers without launching a
physical writer. Existing dashboard and Tidbyt suites cover their own browser
and publisher paths. These are candidate source checks, not release or installed
compatibility claims.

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
admission safeguard, not a second retirement authority.

Install the compatible Hub before activating the upgraded Nanoleaf reader. A
1.0-only host cannot meet that reader's generation requirement. Older consumers
can still read the default 1.0 endpoint but cannot detect missed retirement from
generation metadata. Older owners cannot read format 2.0. Rolling back an owner
therefore requires a compatible owner and reconciled handoff; do not point an
older binary at the newer store or silently discard retirement evidence.

## Acceptance boundary

Source work changes no installed owner, hook, Codex state or physical device.
The issue retains separate authorization and acceptance for a throwaway archive
end, a non-archive end and resume, including dashboard removal, visible Nanoleaf
Line release, fresh monitoring and measured timing. Displays retain their
existing polling and write cadence. The dashboard draft reset also requires
human approval of the current candidate. Native mode automation remains owned
by Nanoleaf #110.

Nanoleaf's existing policy suppresses completion comets and waves whenever its poll skips owner revisions. [Nanoleaf #115](https://github.com/jimmie-potts/codex-nanoleaf/issues/115) owns that limitation. This companion preserves that policy while preventing a retired task's effects from returning.
