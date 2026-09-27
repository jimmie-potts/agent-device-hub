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
   service stops the unit. `extend` replaces the timer. Cleanup names units,
   never ports, process names or remembered PIDs.
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
- **One-time launch code (`cli.js open`) for the preview.** Rejected: the code
  would sit in the printed URL. Trusted loopback is already the owner's
  accepted posture on this PC and the run holds nothing real.
- **Proof under the worktree or `/tmp`.** Rejected: worktree removal deletes
  ignored files and `/tmp` is a small RAM disk shared by every agent.

## Consequences

- A run lives at most as long as the user manager `user@<uid>.service`. With
  linger off that manager follows the WSL distribution's implicit login
  session, so ADR 0008's keep-alive trial and its linger item decide how long
  that is with no terminal open. Survival past an actual session end is
  pending evidence for the Hub adapter's tests.
- Without a user systemd instance, `start` refuses; there is no degraded mode.
- Adapters test lifecycle behavior against real transient units with short
  leases, so their checks need a Linux host with `systemd --user`. Depot's
  Ubuntu runners must be verified for this before #494 relies on CI for it;
  otherwise those checks run locally and CI covers the rest. Verified on
  2026-09-27 (PR #552): the runner is not booted with systemd, so lifecycle
  tests skip there with a printed reason and CI runs the capture rules
  without a supervisor.
- Windows browser access is proven for HTTP by `curl.exe` only. The owner's
  click in a real browser is [#497](https://github.com/jimmie-potts/agent-device-hub/issues/497)'s evidence.
