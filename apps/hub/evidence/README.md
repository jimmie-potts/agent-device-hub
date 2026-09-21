# Candidate evidence

The September 21 synthetic API receipt retains all 9,000 samples across three repetitions at 1, 10 and 50 session identities. Each sample ingests an observation and reads its current snapshot from a separate disposable Linux process. It uses the shared core and real private SQLite adapter, without installed hooks, controllers or devices.

All samples completed, with per-repetition p95 between 6.19 and 12.20 ms. Peak host RSS reached 164.82 MiB, exceeding the frozen 128 MiB service limit in `docs/performance/linux-budgets.json`. The measurement command exited 1. This candidate has not passed performance acceptance. No limit was changed and no repetition was discarded.

The compressed JSON contains samples, failures, runtime details and SHA-256 hashes of the measured source files. Its latency scope differs from the legacy full-hook benchmark, so those timings cannot satisfy that benchmark or integrated #30 acceptance. The script can reproduce the same workload after building:

```sh
node scripts/measure-hub.mjs /tmp/new-hub-measurement.json
```

Migration activation and the actual Pixoo selected-source cutover/rollback remain unimplemented. Nanoleaf request compatibility is pinned, but full owning-service adapter acceptance is still pending. Pixoo integration settings await its #33 API. These remain incomplete acceptance criteria under the original issue, not a reduced delivery scope.
