## Context

See proposal.md. The current admission schema already pins actual release archives, format inventories, source reviews and private four-phase receipts. Fixed optional-owner combinations cover ONN, paired BB-8 and always-shipped companions. The production Roborock store shares one transaction with SDK Outbox; its accepted source exports no command execution.

## Goals / Non-Goals

**Goals:** admit a complete fixed Roborock owner while preserving current refusal, private filesystem and latest-state guarantees. Reuse production store and outbox code without altering its public interface.

**Non-Goals:** generic module registries, new retention or map features, vacuum controls, account discovery, configuration activation or installed operations. Source evidence cannot establish cross-release or exact-firmware compatibility.

## Decisions

- Extend each existing exact coverage set with one optional `roborock` owner. A dynamic registry would add discovery and policy surfaces without benefiting this fixed shipped module.
- Extend metadata inventory and require a primary regular private `roborock.sqlite` whenever configuration or retained entries identify ownership. Apply the existing UID, mode, hard-link, symlink and entry checks; never open live state for inventory. A directory or sidecar alone cannot establish the recoverable archive.
- Require fixed package and compiled store-reader entries in all selected artifact inventories when this owner is active or retained. The verified artifact closure binds bytes; the coordinator still needs actual compatible-reader execution against latest candidate state. A caller assertion or archive hash alone is insufficient.
- Preserve the health absence exception only when Roborock is unconfigured. Covered configured health follows ordinary running/healthy/null-reason checks in both preflight and post-start verification.
- Four separate fixture processes use production RoborockStore, normalizer/state drafts and SDK Outbox in synthetic private storage. Each boot captures durable rows before writes or publication; candidate adds distinct newer data. Recovery/reupgrade compare candidate data, then use genuine outbox republish and confirm original identities. Restoring stopped baseline data is a required failing negative control. These same-build source fixtures prove persistence only; exact previous/target/recovery artifact qualification remains private and separate.

## Risks / Trade-offs

- [Source restart proof mistaken for compatibility] → explicitly require exact selected artifact qualification for installed admission and label source evidence limits.
- [Private map or credential leakage] → synthetic fixtures only; keep account/session, owner observations, plans and admission receipts outside Git/GitHub.
- [Owner activation affects another planned upgrade] → qualify before activating; coordinate only the installed operation with its current owner. Separate worktrees permit source work now.
- [Recovery loses newer data or republishes invented envelopes] → compare boot snapshots and candidate markers before recovery effects; retain original outbox IDs and negative-control evidence.

## Migration Plan

No format migration or installed effect is selected. Deliver additive admission support through source checks, independent review, hosted CI and guarded merge. Before any later installed step, qualify exact releases and latest private state, build the owning UPGRADE.md plan and bind private evidence. Preserve accepted #1037 initial adoption and other coordinators' operations. No live recovery rehearsal is required solely to complete this source proof.
