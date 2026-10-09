# Reader provenance

The source port starts at Hub main `bf11587c1a2c575c0da155725a386a209836eed9` for [Hub #927](https://github.com/jimmie-potts/agent-device-hub/issues/927).

| Module file | Original source | Adaptation |
| --- | --- | --- |
| `src/wispr-query.ts` | `apps/hub/src/wispr-query.ts` | Retains filters, calculations, presets, exports and bounds; adopts strict null checks and registry refusals. |
| `src/wispr-worker.ts` | `apps/hub/src/wispr-worker.ts` | Retains file qualification, closed producer schemas, refresh and final observation fences; adopts module-local configuration/errors and typed worker messages. |
| `src/wispr.ts` | `apps/hub/src/wispr.ts` | Retains lazy worker, timeout, capacity and persistent identity fence; adds cancellation and privacy/stop epochs before reply delivery. |
| `src/configuration.ts` | Configuration validation in `apps/hub/src/wispr.ts` | Moves manual path/flag validation into manifest configuration with a safe settings projection. |
| `tests/reader.test.ts` | Cases in `apps/hub/tests/wispr.test.mjs` | Runs numeric/text/file/fence behavior directly against fresh synthetic files; authenticated HTTP checks belong to coordinator integration. |

`@jimmie-potts/wispr-contracts` is reused unchanged. Collector schema `1.0`, algorithms, Windows collector code and its publication files are unchanged. Runtime JSON adds the `wispr-analytics/2.0` document wrapper and shared ErrorBody; this does not change the producer format.

The collector file handoff is the owner-approved exception to ADR 0012's usual state ownership rule. Only manually selected published files are read. No database sharing, service, scheduler, migration, source discovery, MCP analytics or analytics broadcast is introduced.
