## Context

The existing Audio workspace renders playback cards and room placement. Capture state belongs to the core, while bounded feature occurrences come from the fixed Music producer. The dashboard already has one authenticated SDK participant and retained command attempts. Browser timing and separate start/stop locks need design because an accepted command and a newly received old measurement are not evidence of active capture.

## Goals / Non-Goals

Expose the merged Music-only capture capability without changing playback, producer or device ownership. The new card is mounted only on Audio. It neither prepares effects nor implies that lights participate. Source acceptance uses synthetic observations and a disposable runtime; installation and physical acceptance remain separate.

## Decisions

- A narrow Audio scope on the existing connection owns one core state copy and one fixed feature subscription. A new participant or a generic frontend subscription API would expand this change unnecessarily. Unmount, connection loss and session end close or invalidate that scope. It retains one feature, no history, files or browser storage.
- Start and Stop use the existing tracked action route, current core revision and independent retained attempt keys. Stop remains possible while Start is pending or uncertain when the current core state permits it. Controls use the core's existing admission rules. Old uncertain outcomes stay uncertain; refresh never clears an attempt or resends it.
- The state copy supplies endpoint, generation and session status. Features require the exact producer source, matching endpoint/generation, active synced state, increasing sequence and source-window time. Gaps remain discontinuities. Missing or stale data is unavailable, while a measured zero remains zero.
- An actual core sync request's local send/receive interval brackets its completion timestamp. The browser extrapolates conservative lower/upper core-time bounds using its monotonic clock. An overly wide request interval, invalid time, local wall/monotonic drift, backward monotonic time or lost sync invalidates qualification. A timestamp alone or raw browser wall time cannot establish source freshness. Refresh performs one explicit sync, never a polling loop.
- The meter expires against the conservative upper core-time bound and rechecks on delivery and timer wakeup. It also clears immediately when core state ceases to be active. The visual scale ends at digital full scale; numeric RMS/peak preserve values above one and clipping uses the declared fraction. There is no smoothing or animated placeholder.
- The existing Quiet glass tokens, native buttons and labelled meter keep the card consistent and keyboard-accessible. Numeric changes are not an assertive live region. Source/session and operation evidence remain distinct. Fixed refusal text uses existing registry codes and existing action trace handling.

## Risks / Trade-offs

- Network delay may make the clock estimate too broad. Hide the measurement and offer explicit refresh instead of inventing freshness.
- The producer publishes before core admission. Match current core authority and enforce the same source freshness bounds; a received frame alone never makes capture active.
- An interrupted Start may remain uncertain after Stop settles. Preserve the tracked outcome and its conservative Start lock; do not infer historical success from current idle state.
- The new card cannot enable a missing producer or grant macOS permission. It reports unavailable input with a clear explanation.

## Migration Plan

No state migration, credential change or installation. The dashboard consumes existing contracts. Removing the card and its scoped consumer restores the prior UI without changing capture ownership or saved data.
