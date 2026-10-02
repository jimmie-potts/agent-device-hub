# Source validation

The shared receipt corpus has 80 cases in both languages; the full TypeScript contract suite passes 410 tests, including the unchanged controller corpus and existing regressions. Focused red evidence first showed the missing validator; additional red cases caught year-zero and contradictory recovery claims during finalization. Both languages now reject them.

Build, typecheck, contracts (TypeScript/Python), extracted contract package, MCP tools/protocol/package, lifecycle TypeScript/Python/package, Tidbyt TypeScript/Python, LIFX, local-controller host, Hub/service/MCP/package, setup and workflow checks passed. The Tidbyt Python dependency was provisioned in an isolated environment after its missing-Pillow failure. Hub package validation caught the workspace-versus-published pin mismatch; packaging now retains the verified published dependency and its tests pass. The canonical private evidence retains both failed and successful attempts.

The contract ownership map was inspected against service entrypoints and Nanoleaf's copied runtime file set. Both adoption orders and interruption boundaries are documented; execution of those fake-service scenarios belongs to consumer commands. Historical receipt mapping names every gh417/gh355 field without private values. Static declaration branches cover source-only, ordinary delivery, install and rollback. No fresh agent-host session, live upgrade, service restart or device test is claimed.

The specification is synchronized before archive. PR review, hosted CI, merged-main CI, owner publication approval, release asset publication/download verification and issue closure remain external delivery gates; this source archive does not claim them.
