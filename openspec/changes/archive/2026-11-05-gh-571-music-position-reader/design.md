## Context

The private #41 probe demonstrated state and position reads through direct AppleEvents. `modules/playback` remains the authoritative playback owner; its current source interface timestamps successful polls and cannot safely refresh from a remote cache. This increment supplies only a local read component. Design is required because process identity, nonprompting permissions, timing and child supervision affect correctness.

## Goals / Non-Goals

Give an explicitly calling component one bounded state/position read with independent property intervals and truthful partial availability. Preserve capture helper behavior and permissions. Playback selection, track identity, output observations, controls, a polling scheduler, SDK publication and installation remain outside this increment; #571 retains them.

## Decisions

- A distinct `music-position` executable and bundle identity isolate AppleEvents from `music-capture`. Only `--read-existing-music` sends events; `--clock` and `--self-test` remain harmless. Direct PID-addressed getter descriptors avoid shell scripts and implicit app launches.
- Select exactly one running `com.apple.Music` instance with a nonmissing launch date. Recheck PID, bundle and launch identity before and after each reply. Any mismatch discards the entire cycle. Emit an opaque process-instance digest, never a PID or track identity.
- Nonprompting permission preflight precedes reads. Every send uses no-interaction/no-consent-prompt flags and a two-second deadline. Read state and then position once each; state read failure prevents the dependent position read. Position failure preserves the valid earlier state with an explicit unavailable position.
- Local schema `music-position-read/1.0` contains a cycle interval and separately bounded state/position intervals in `mach_continuous_time` milliseconds. Numeric descriptors and the five declared player-state enum codes are allowlisted. Unknown fields, nonfinite/negative/out-of-range positions, invalid intervals and unknown errors are refused.
- `MusicPositionReader.read({signal})` launches one helper, waits for one complete record and confirmed exit, and permits no overlapping child. It has a five-second whole-cycle limit, then bounded signal escalation. Cancellation fences output immediately. Unconfirmed child exit blocks replacement. The read result carries an instance-based epoch and per-reader sequence; an old completion cannot update a later generation.
- Native times must fit inside the actual parent monotonic request interval. Wall time is not used to make an old reply fresh. Property intervals describe observation work, not atomicity, track continuity or audible output timing.
- The supervisor retains no history and writes no logs or files. Its caller owns selected private observation retention. Fake/native tests and child-pipe acceptance use synthetic data only. Registered fixed error details replace raw AppleEvent/OS text.

## Risks / Trade-offs

- A property may change between reads. Separate intervals preserve that uncertainty; no combined atomic-snapshot claim is made.
- A process epoch is not a recording ID. Seek, repeat and track-change interpretation remain unqualified.
- A hung permission check or send may ignore cooperative stop. The parent bounds the wait and retains ownership until exit is observed.
- Each explicit read starts a child. This keeps lifecycle simple at the cost of startup overhead; no continuous timing or polling-rate claim follows from source tests.
- Packaging changes the responsible permission identity. The helper embeds its usage description, while signing, consent and installed access remain separate qualification.

## Migration Plan

No stored data, credential, runtime state or installed process changes. Existing native scripts compile and fake-test both executables. Removing the new reader files restores the previous source behavior without a data migration.
