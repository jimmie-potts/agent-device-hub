# ADR 0009: Disposable app runs are transient user units with a lease timer

Status: Accepted for the Hub pilot under
[hub #493](https://github.com/jimmie-potts/agent-device-hub/issues/493),
2026-09-27. Items marked *proposed* are the author's; the owner can change
them before the adapters ([#494](https://github.com/jimmie-potts/agent-device-hub/issues/494),
[codex-nanoleaf#193](https://github.com/jimmie-potts/codex-nanoleaf/issues/193),
[divoom-app-upgrade#118](https://github.com/jimmie-potts/divoom-app-upgrade/issues/118))
build on them. Nothing here is installed.

## Context

[#488](https://github.com/jimmie-potts/agent-device-hub/issues/488) accepted
that an agent starts the real Hub, Nanoleaf or Pixoo application with
synthetic data and simulated transports, verifies a change, keeps clickable
proof and leaves a preview the owner can open in the Windows browser on the
same PC, under a two-hour lease with extend and stop. The open mechanics were
Windows-to-WSL reachability, how a preview outlives the agent session, how
capture works here, and how a failed or expired run is cleaned without
touching anything else. The [contract](../app-verification.md) records the
probes run on 2026-09-27 and the operations, receipt and failure behavior.

## Decision

1. **One transient systemd user unit per run**, `app-verify-<run-id>.service`,
   created with `systemd-run --user --collect` and `KillMode=control-group`.
   Its **lease is a transient timer**, `app-verify-<run-id>-lease.timer`, whose
   service stops the unit. Hub #494 made it a realtime timer
   (`--on-calendar=@<expiresAt>`, `AccuracySec=1s`) whose next elapse is read
   back against the receipt, so the recorded expiry is verified and holds
   across host sleep. `extend` starts the next timer
   (`-lease-<k>`) before stopping the old one. Cleanup names units, never
   ports, process names or remembered PIDs.
2. **Two storage roots.** Proof goes under the owning canonical checkout's
   ignored `.local/evidence/verify/<run-id>/`; handoff moves the captures
   taken so far into a `verified/` set frozen with a checksum manifest and
   read-only permissions, while the live receipt and later captures stay
   outside it. Runtime state goes under
   `~/.local/state/app-verify/<run-id>/`, outside every Git checkout and off
   the `/tmp` tmpfs, and is deleted by `stop`.
3. **Ephemeral loopback ports.** Every run binds `127.0.0.1:0` and reports the
   port it got. Installed ports are never used.
4. **Candidate identity uses the names the install contract (#465)
   proposes**: `build.sourceRevision`, `build.version`, plus `build.dirty`
   and `build.artifactDigest`. Dirty and
   unknown builds run, labelled; they cannot serve as a merge candidate's proof.
5. **Hub previews sign in through `browserAccess: "trusted-loopback"`** on the
   disposable run, so no token appears in a URL, card, log or receipt. Agent
   API assertions use a run-generated credential kept in the runtime directory.
6. *Proposed:* the preview link identifies its run only through the card and
   `doctor`; a stopped run's port refuses connections, which is the staleness
   signal. An in-page banner waits for an adapter that owns a page.

7. **One shared lifecycle core** (owner decision, 2026-09-27). The run
   lifecycle is implemented once, app-agnostic, in the Hub package
   `@jimmie-potts/app-verify`, published as a release archive. The Hub,
   Nanoleaf and Pixoo adapters each supply only a plug-in (build identity,
   scenarios, launch, readiness, components, capture steps, boundary checks)
   and their own wrapper command.
8. **Run inputs and extra endpoints** (`app-verify` 1.1, for
   [#495](https://github.com/jimmie-potts/agent-device-hub/issues/495)). A
   composed preview starts one run per application and points one at
   another. Rather than a multi-unit run, each run stays one unit and takes
   declared, non-secret `--input` values, which the receipt records and
   every relaunch reuses; its ready line may name extra loopback endpoints,
   which keep their ports across a relaunch. Secret-like input names are
   refused because inputs are recorded. The receipt stays
   `app-verification/1`, since both fields are optional and readers ignore
   unknown fields.
9. **A composed preview is three runs stitched by a Hub-owned orchestrator**
   (addendum for [#495](https://github.com/jimmie-potts/agent-device-hub/issues/495),
   2026-09-27). `apps/hub/verify/compose.mjs` starts the wall, Pixoo and Hub
   runs, each through its own repository's wrapper, from checkouts pinned to
   exact commits in `apps/hub/verify/compose.json`. A pin mismatch fails
   before anything is created, and `--unpinned` runs are labelled
   non-citable. The pairing follows a fixed order:
   1. Every run starts standalone.
   2. The orchestrator writes run-generated feed and controller credentials,
      0600, into the runtime directories.
   3. The consumers reseed `hub-paired`, and the Hub reseeds `integrated`,
      the real hub CLI as the only agent-state owner.

   An aggregate `composition.json` under the Hub's proof root records each
   run and stops only recorded runs, owner first. Consumer loss uses
   `systemctl --user freeze` and `thaw` on the recorded unit, driven by the
   orchestrator. A capture step requests it through the Hub run's runtime
   directory. A Hub on a preview configures its own Places destinations
   (`placeLinks`), so no preview link leads to an installed service.

## Alternatives considered

- **`nohup`/`setsid` with a PID file.** Rejected: the E4 probe showed a
  process-group kill leaving a `setsid` grandchild alive, PIDs are reused, and
  such a process may still die with the session's control group.
- **`RuntimeMaxSec` on the unit as the lease.** Rejected: systemd 259 refuses
  to change it on a running unit, so the lease could not be extended without a
  restart. A replaceable timer keeps the run untouched.
- **A long-running preview supervisor service or Docker.** Rejected by #488's
  scope; a transient unit gives the same lifetime without a new installed
  service.
- **Three independent adapters, one per repository.** Rejected by the owner
  on 2026-09-27 in favour of the shared core: the lifecycle, lease and proof
  rules are identical, and three copies would drift.
- **One-time launch code (`cli.js open`) for the preview.** Rejected: the code
  would sit in the printed URL. Trusted loopback is already the owner's
  accepted posture on this PC and the run holds nothing real.
- **Proof under the worktree or `/tmp`.** Rejected: worktree removal deletes
  ignored files and `/tmp` is a small RAM disk shared by every agent.
- **One multi-unit run for the composed preview, or a container compose
  file.** Rejected for #495. One run per application keeps each repository's
  adapter, receipt and cleanup rules intact, and it needs no new installed
  service. A multi-unit run would move three toolchains under one plug-in.
- **Stopping and restarting the consumer to simulate its loss.** Rejected in
  favour of freeze and thaw, which the 2026-09-27 probe showed working under
  WSL cgroup v2. A restart reseeds the consumer, so it could not show
  recovery of the same process or catch a command held across the loss.
- **Starting a paired run directly in `hub-paired` or `integrated`.**
  Impossible by design: the pairing credentials go into the runtime
  directory, which exists only after `start`. The same reason makes the
  core's `restart` of a paired run fail at seed.

## Consequences

- A run lives at most as long as the user manager `user@<uid>.service`. With
  linger off that manager follows the WSL distribution's implicit login
  session, so ADR 0008's keep-alive trial and its linger item decide how long
  that is with no terminal open. Survival past an actual session end is
  pending evidence for the Hub adapter's tests.
- Without a user systemd instance, `start` refuses and creates nothing; there
  is no fallback without systemd. A manager whose state is `degraded` (for
  example, after an unrelated failed unit) still runs units and counts as
  available.
- Adapters test lifecycle behavior against real transient units with short
  leases, so their checks need a Linux host with `systemd --user`. Depot's
  Ubuntu runners must be verified for this before #494 relies on CI for it;
  otherwise those checks run locally and CI covers the rest. Verified on
  2026-09-27 (PR #552): the runner is not booted with systemd. CI runs the
  receipt, supervisor-refusal and unsupervised capture tests; the lifecycle
  tests skip there with a printed reason and run on a host with a user
  manager.
- A composed preview proves simulated cross-service behavior only. Its
  consumer-loss evidence allows one late delivery of a command sent during
  the freeze, because the frozen process's kernel still accepts the
  connection; it records whether that happened. Restarting a composition
  means stopping it and starting a new one.
- Windows browser access is proven for HTTP by `curl.exe` only. The owner's
  click in a real browser is [#497](https://github.com/jimmie-potts/agent-device-hub/issues/497)'s evidence.
