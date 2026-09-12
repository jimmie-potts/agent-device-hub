# Pinned legacy measurement inputs

The nanoleaf directory contains byte-identical bridge.py and project_map.py
from jimmie-potts/codex-nanoleaf revision
`ea3b95661352f927aceaf92b62d74660978c201f`. Admission tooling verifies their
SHA-256 before import. These files are upstream-owned measurement inputs;
do not edit them or use them as Hub provider implementations.

The selected call uses synthetic metadata and a disposable native database,
with worker launch explicitly excluded. No installed bridge is invoked.

The adjacent lifecycle archive is the released
`@jimmie-potts/agent-lifecycle-contracts` 1.0.0 asset from Hub PR #74, source
`855bd3787803dad7245f29e88c758659f6e4eda4`, release
https://github.com/jimmie-potts/agent-device-hub/releases/tag/agent-lifecycle-contracts-v1.0.0.
Its SHA-256 is `669c8e3d8b2bac5255ea613eae96134c324515b4e7a767887e86fa59b87fef85`.
The validator tool pins the published manifest and fixture hashes as well.
Do not rebuild or modify this measurement input.


`nanoleaf-linux/bridge.py` and `project_map.py` are byte-identical source from
Nanoleaf PR #57 merge `2558df5a2fc543247b0c75898ef0260ba3ea264b`, originally under
`bridge/`. `linux_hook.py` pins their SHA-256 values. They are the complete local
import set for the hook and spawned worker when the existing notification owner
lock is held. The actual worker starts and exits on SQLite lock contention before
configuration, metadata readers or controller imports. They are measurement
inputs, not installed Hub providers. Their legacy Windows branches remain
historical upstream source; the isolated Linux path cannot select forwarding.
The original `nanoleaf/` pins and receipts remain unchanged.
