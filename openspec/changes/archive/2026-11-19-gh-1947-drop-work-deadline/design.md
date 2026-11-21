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

| Evidence every | Observations | Revisions | Span confirmations (no history row, decision 6) |
| --- | --- | --- | --- |
| 1 s | 3,600 | 60 | 60 |
| 5 s | 720 | 60 | 60 |
| 30 s | 120 | 60 | 60 |
| 59 s | 61 | 30 | 30 |
| 61 s | 59 | 59 | 59 |
| 90 s | 40 | 40 | 40 |
| 5 min | 12 | 12 | 12 |
| silent | 0 | 0 | 0 |

Before this change the same busy session published one revision for the hour. Each publication confirms the session's history span and writes no row (decision 6). Other effects of the extra revisions:

- Bindings that compare a session's exact revision see it change at most once a minute while that session works: the companions' coding suggestion (`suggestion-model.ts`), an opportunity without a known turn or attention ID (`presentation-policy.ts`), and the dashboard's notice override and label editor (`expectedRevision`), which already refuse a stale revision with `revision-conflict`.
- The Tronbyt tile and Habitat order by `lastEvidenceAtMs`, which is now closer to real evidence.

The owner chose one-minute steps after this measurement (2026-11-19T19:08:28Z, recorded on #1947). Review of the pull request then found that every evidence-only publication also wrote a history row that the dashboard Timeline showed as "Agent updated", so a few busy sessions pushed other entries out of its 200-row window. The owner decided on 2026-11-21 (recorded on #1947, #1768 and the pull request) that such a publication writes no history row and confirms the entity's open span, revising #1768 decision 6 for session evidence instants only (decision 6 below). The resolution stays one constant, and the measurement test derives its expectations from it, so a later change is one edit. The alternatives considered were a coarser resolution (five minutes gives at most 12 revisions an hour, with an age up to five minutes stale) and a separate history rule that keeps evidence-only changes as span confirmations, which would revisit #1768 decision 6.

### 5. The dashboard's evidence age

The row already carries `lastEvidenceAtMs`. The card face shows "Heard {age} ago" on its first line, beside the client (a closed Home tile drops the word "Heard" so the client keeps room), and the disclosure "Last heard: {age} ago, to the minute.", both from `heardAge(now - lastEvidenceAtMs)` on the shell's existing one-second clock: `<1m`, then whole minutes, then hours and minutes. Whole minutes match the published resolution: the shown age overstates the real one by less than a minute. The page sends nothing and reads nothing new. The Home idle check treats the face's age like the disclosure's, as the shell clock's own text.

### 6. History keeps evidence-only publications as span confirmations

History's `#change` compares a state with the record of its entity's last row by `sameState`, setting aside the family's bookkeeping members. For `session` it also sets aside `SESSION_EVIDENCE_INSTANTS`: `/observedAtMs`, `/lastEvidenceAtMs`, `/work/evidenceAtMs`, `/attention/evidenceAtMs` and `/outcome/evidenceAtMs`. This is a history-internal rule (option B2), not a bookkeeping declaration (B1). B1 would break the message profile's bookkeeping requirement: a pointer must hold a number in every registered version of the family, and `session/2.0` and `2.1` have no claims, and that requirement says `session` declares none.

- An evidence-only publication writes no row and confirms the span: the span holds the published revision, message ID and type, and the commit's instant, which for such a publication equals the record's `lastEvidenceAtMs`.
- At a confirmation the record rebuilt from the rows equals the published record but for its revision and those instants, which keep the last row's values. The next change row carries every instant that moved and the span it closes, so the rebuild equals the published record there.
- A removal closes a span with confirmations beyond its row first, as for any family; the closing row carries the last row's revision, so the rebuild at it equals the record published at that revision.
- The rows stay append-only and the fact log gapless; nothing is updated or deleted.
- The Timeline shows the entity's last change with its open span's note ("Unchanged since …, last reading at …, N readings"), so a busy session reads as one entry.

Measured on the manual clock, a busy session-hour now adds no history row and as many span confirmations as revisions: 60, 60, 60, 30, 59, 40 and 12 at evidence every 1 s, 5 s, 30 s, 59 s, 61 s, 90 s and 5 min.

## Boundaries and outcomes (ADR 0012)

No new component boundary: no new message family, command, reply, error code, retry or diagnostic record. Publication stays the core's existing state publication through its outbox; the dashboard reads its existing synced copy. The removed `deadline` input had no diagnostic record of its own; the expiry retry keeps its existing backoff and storage records.

## Risks and trade-offs

- A stuck session now shows "working" until a restart, its end or its expiry; the evidence age is the only cue. This is the owner's choice.
- Up to 60 extra revisions per busy session-hour (decision 4), kept in history as span confirmations, not rows (decision 6).
- The restart marking is now the only reason for unconfirmed work without explicit evidence, so approval recovery after a lost approval needs a restart.

## Validation

The validation table is in the pull request.
