# Candidate evidence

The September 21 synthetic API receipt retains all 9,000 samples across three repetitions at 1, 10 and 50 session identities. Each sample ingests an observation and reads its current snapshot from a separate disposable Linux process. It uses the shared core and real private SQLite adapter, without installed hooks, controllers or devices.

All samples completed, with per-repetition p95 between 6.19 and 12.20 ms. Peak host RSS reached 164.82 MiB, exceeding the frozen 128 MiB service limit in `docs/performance/linux-budgets.json`. The measurement command exited 1. At that measurement, the candidate had not passed the 128 MiB memory check. No limit was changed during that run and no repetition was discarded.

The compressed JSON contains samples, failures, runtime details and SHA-256 hashes of the measured source files. Its latency scope differs from the legacy full-hook benchmark, so those timings cannot satisfy that benchmark or integrated #30 acceptance. The script can reproduce the same workload after building:

```sh
node scripts/measure-hub.mjs /tmp/new-hub-measurement.json
```

At the original measurement, migration activation, actual Pixoo cutover/rollback and owning-service adapter acceptance were incomplete. The final source checks below now cover those criteria.

Four additional diagnostic receipts retain another 36,000 samples. A 64 MiB old-generation heap limit, SQLite statement reuse, a durable-state cache, and a 1 MiB semi-space experiment all exceeded 128 MiB. The heap settings and durable-state cache were not adopted. Statement reuse remains because it bounds prepared-statement handles to the lease lifetime. These trials are diagnostic comparisons, not qualification receipts; each JSON names its variant. The original failing receipt remains the source-hashed baseline.


## Owner-approved budget change

On September 21, 2026, the owner explicitly doubled the service RSS budget to
256 MiB. The original five receipts above remain unchanged and retain their
failed results against 128 MiB. [Hub #123](https://github.com/jimmie-potts/agent-device-hub/issues/123)
is the non-blocking backlog follow-up for budget review and memory improvements.
This is a budget change, not a memory optimization or full integrated qualification.

A fresh run with the revised budget completed all 9,000 samples, peaked at 164.64 MiB RSS and exited 0. `2026-09-21-api-budget256.json.gz` records 256 MiB for each repetition and hashes the source, script and budget file. This passes the synthetic workload memory check only; the receipt still sets `qualified: false` for full integrated qualification.


## Integration candidate

`2026-09-21-api-integration.json.gz` retains a new 9,000-sample run with zero failures, per-repetition p95 from 6.51 to 12.04 ms and peak host RSS 165.44 MiB against 256 MiB. The command exited zero; `qualified: false` still excludes full #30 qualification. Source hashes identify the measured product files, independent of later documentation edits.

`2026-09-21-owning-services.json` records successful checks against immutable Pixoo and Nanoleaf source revisions. Pixoo ran its real simulator application and selected-source facade through fenced cutover, producer ingestion, browser label/acknowledgment operations, renderer revision and rollback after new writes. Nanoleaf ran its owning controller HTTP fixture through queued settings, application and replay. Neither check contacted devices or an installed service. Reproduce them with the prepared-source commands in `docs/development.md`.

The host tests also exercise dead-coordinator recovery, file-sync failure after rename, interrupted intent initialization, single-use import, runtime staging validation and cleanup of a startup child that ignores graceful termination. These are process/filesystem failure injections, not power-loss or installed-client qualification.
