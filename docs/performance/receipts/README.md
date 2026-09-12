# Benchmark receipts

Start here and in [the methodology](../../performance-baseline.md) for ordinary
review. Inspect selected raw fields when checking a result or investigating an
outlier; printing whole receipts adds thousands of repetitive lines.

| Receipt | Warm calls | Boundary and status |
| --- | ---: | --- |
| [Linux hook](2026-09-10-linux-hook.json.gz) | 9,000 | Principal baseline candidate: real hook launch through return, including worker spawn; excludes controller/device work. Nine passing profiles. |
| [Linux validators](2026-09-10-linux-validators.json.gz) | 19,800 | Supporting released Python/Node validator observations, not full-hook qualification. |
| [Earlier WSL admission](archive/2026-09-08-wsl-admission.json.gz) | 18,300 | Historical database admission only; actual worker launch excluded and source pin differs. |
| [Earlier WSL validators](archive/2026-09-08-wsl-validators.json.gz) | 19,800 | Historical released-validator observations; not pooled with the refreshed run. |
| [Linux smoke](archive/2026-09-10-linux-smoke.json.gz) | 150 | Preliminary earlier-tool run, excluded from budgets. |
| [Interrupted Linux run](archive/2026-09-10-linux-interrupted.json.gz) | 2,000 | Two completed profiles before interruption; excluded from budgets. |

WSL identifies the Linux measurement environment, not a native Windows comparison.
The [attempt index](2026-09-10-linux-attempts.json) preserves exclusion reasons,
including the later interruption that produced no receipt. Archived observations
remain evidence, not current acceptance. Overall #30 still requires integrated
qualification; merge/CI acceptance of the baseline remains separate.

## Main results

Worst per-repeat Linux hook tails, each from 1,000 warm calls:

| Concurrent sessions | p95 | p99 |
| ---: | ---: | ---: |
| 1 | 62.250 ms | 64.431 ms |
| 10 | 81.814 ms | 86.447 ms |
| 50 | 376.194 ms | 395.201 ms |

Each concurrency level has three repetitions. Warm calls still start fresh hook
processes against existing synthetic state. Ambient load and OS caches were not
controlled. First calls, CPU, largest-child RSS, failures and cleanup are recorded
separately. These results do not measure installed-agent delay, total service
memory or optical response. See the methodology for resource windows and caveats.
[Budget definitions](../linux-budgets.json) retain the reviewed candidate limits.

## Inspect and verify

Run from the repository root. This prints summaries only:

```bash
python3 - <<'PY'
import gzip, json
from pathlib import Path
root = Path('docs/performance/receipts')
with gzip.open(root / '2026-09-10-linux-hook.json.gz', 'rt') as stream:
    receipt = json.load(stream)
for profile in receipt['profiles']:
    print(profile['tasks'], profile['summary'])
print('One call:', receipt['profiles'][0]['raw'][0])
PY
```

[index.json](index.json) records paths, roles, original filenames, byte counts
and SHA-256 hashes for all six archives. Existing budget and attempt hashes refer
to **decompressed original bytes**, not the compressed file. Raw JSON content was
not reformatted. Compression uses gzip level 9, timestamp zero and no embedded
filename. Verify all stored files without executing benchmark inputs:

```bash
python3 - <<'PY'
import gzip, hashlib, json
from pathlib import Path
root = Path('docs/performance/receipts')
for entry in json.loads((root / 'index.json').read_text())['receipts']:
    compressed = (root / entry['path']).read_bytes()
    raw = gzip.decompress(compressed)
    assert len(compressed) == entry['compressedBytes']
    assert len(raw) == entry['uncompressedBytes']
    assert hashlib.sha256(compressed).hexdigest() == entry['compressedSha256']
    assert hashlib.sha256(raw).hexdigest() == entry['uncompressedSha256']
    json.loads(raw)
    print('Verified:', entry['path'])
PY
```

The consumer package and lock files stay uncompressed at their existing paths;
the validator correctness check reads them. Measurement tools still emit ordinary
JSON into a new user-selected output directory. Keep future exploratory runs
outside tracked files unless deliberately retained as evidence; compress retained
runs and update the index and summary. This storage change adds no CI job or
benchmark execution. Older uncompressed versions remain in Git history.
