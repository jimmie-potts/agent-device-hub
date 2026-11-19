## Context

#1865 (archived as `2026-11-19-gh-1865-flat-session-state`) gave the core one aging table (design decision 4): active work became unconfirmed, reason `deadline`, five minutes after its private progress time, and a restart made running work unconfirmed, reason `restart`. Design decision 5 kept every instant out of a record's meaning, so a busy session's `lastEvidenceAtMs` was published only with other changes. Design decision 10 allowed approval recovery while work was unconfirmed for either reason. The owner's decision on #1947 (2026-11-19T18:29:17Z) drops the five-minute timer and asks the dashboard to show each session's evidence age.

## Goals and non-goals

Goals: silence never changes a claim; the restart marking and the 24-hour expiry stay; the dashboard shows a truthful evidence age without polling or a new read path; the extra revisions and history rows are bounded and measured.

Non-goals: an operator command to forget a session; recovery without the unconfirmed condition; Codex Mac approvals and subagents (#1867).

## Decisions

### 1. The aging table

| Claim | Silence | Restart |
| --- | --- | --- |
| Work, active | no change | `unconfirmed` (reason `restart`) at start |
| Work, idle or interrupted | no change | no change |
| Attention | no change | no change |
| Outcome | no change | no change |
| Relationships | follow each child's work claim | follow each child's work claim |
| Whole session | removed as `expired` after 24 hours without lifecycle evidence | kept |

`workDeadlineMs`, the stored `deadlineUnconfirmed` and `progressAtMs`, the `deadline` transition input, `workDeadlineOf`/`deadlineOf` and the store's due-deadline commit go. The transition's next-due instant is the next expiry (`expiryOf`), renamed `dueMs`. `confirm` keeps only the restart marking. A store written by a source build between #1865 step 9 and this change may hold the two removed private fields; the core no longer reads them and drops them the next time it writes that session. No installed store holds them, because the `session/3.0` switch (`0aca95af`) is not installed (#1869 is open).

### 2. The `deadline` enum value is removed

The issue's rule: remove the value unless a released package or an installed consumer pins it. Evidence, read on 2026-11-19:

- `@jimmie-potts/event-contracts` is `private: true` at version `1.0.0` and has never been released: no tag or GitHub release names it. The newest release tags are from 2026-10-02 (`controller-contracts-v1.2.0`, `bunny-observability-v1.0.0`), before `session/3.0` existed (added by `6adad7e7`, #1865 group 1). Every dependent is a workspace of this repository at the same unpublished `1.0.0`.
- No installed producer emits `session/3.0`. The core switched to it at `0aca95af` (#1865 group 9), which is not installed; #1869 is open and blocked. The installed `3f847cc1` batch carries readers that accept `session/3.0` with the old enum, so the narrower schema stays readable by them.
- Host-installed read helpers were not repointed (#1869 comment of 2026-11-19), so no installed helper reads `session/3.0`.

So the enum drops `deadline` and `maxItems` goes from 4 to 3. A record carrying it is refused; the contracts suite pins that.

### 3. Approval recovery

`recover-approval` is allowed only while `restartUnconfirmed` is set: a core restart left the session's running work unconfirmed. Silence alone never allows it. The schema description, the MCP tool description, the core's comments and the runtime README say so.

### 4. The published evidence time

`meaningChanged(published, next)` is true when any member but the revision and instants changed, as before, or when `next.lastEvidenceAtMs - published.lastEvidenceAtMs >= SESSION_LIMITS.evidenceResolutionMs`, one named constant set to 60,000 ms. A busy session therefore publishes for its evidence alone at most once per resolution, the published evidence time lags the stored one by less than a resolution, and a silent session publishes nothing. The comparison is against the published record, not a wall-aligned bucket, so two evidence-only publications are always at least one resolution apart.

Measured on the manual clock (`core-session-progress.test.ts`, the last test), one working session for one hour:

| Evidence every | Observations | Revisions | History rows |
| --- | --- | --- | --- |
| 1 s | 3,600 | 60 | 60 |
| 5 s | 720 | 60 | 60 |
| 30 s | 120 | 60 | 60 |
| 59 s | 61 | 30 | 30 |
| 61 s | 59 | 59 | 59 |
| 90 s | 40 | 40 | 40 |
| 5 min | 12 | 12 | 12 |
| silent | 0 | 0 | 0 |

Before this change the same busy session published one revision for the hour. Session times stay history rows (owner decision 6 on #1768), so each publication is one history row and one Timeline entry titled "Agent updated". Other effects of the extra revisions:

- Bindings that compare a session's exact revision see it change at most once a minute while that session works: the companions' coding suggestion (`suggestion-model.ts`), an opportunity without a known turn or attention ID (`presentation-policy.ts`), and the dashboard's notice override and label editor (`expectedRevision`), which already refuse a stale revision with `revision-conflict`.
- The Tronbyt tile and Habitat order by `lastEvidenceAtMs`, which is now closer to real evidence.

The resolution is the owner's to change: it is the one constant, and the measurement test derives its expectations from it. Alternatives the owner may choose instead: a coarser resolution (five minutes gives at most 12 revisions an hour, with an age up to five minutes stale), or a separate history rule that keeps evidence-only changes as span confirmations, which would revisit #1768 decision 6.

### 5. The dashboard's evidence age

The row already carries `lastEvidenceAtMs`. The card face shows "Heard {age} ago" and the disclosure "Last heard: {age} ago, to the minute.", both from `heardAge(now - lastEvidenceAtMs)` on the shell's existing one-second clock: `<1m`, then whole minutes, then hours and minutes. Whole minutes match the published resolution: the shown age overstates the real one by less than a minute. The page sends nothing and reads nothing new. The Home idle check treats the face's age like the disclosure's, as the shell clock's own text.

## Boundaries and outcomes (ADR 0012)

No new component boundary: no new message family, command, reply, error code, retry or diagnostic record. Publication stays the core's existing state publication through its outbox; the dashboard reads its existing synced copy. The removed `deadline` input had no diagnostic record of its own; the expiry retry keeps its existing backoff and storage records.

## Risks and trade-offs

- A stuck session now shows "working" until a restart, its end or its expiry; the evidence age is the only cue. This is the owner's choice.
- Up to 60 extra revisions and history rows per busy session-hour (decision 4).
- The restart marking is now the only reason for unconfirmed work without explicit evidence, so approval recovery after a lost approval needs a restart.

## Validation

The validation table is in the pull request.
