## Why

The runtime's log has one floor, the process's `--log-level`, and the Mac container passes none, so the operator
cannot read one module's DEBUG records without turning DEBUG on for everything, and cannot set any floor without
changing the container's command line. The owner's October 30 decisions for
[epic #810](https://github.com/jimmie-potts/agent-device-hub/issues/810) keep INFO and above as the ordinary floor and
make DEBUG selectable per module ([#811](https://github.com/jimmie-potts/agent-device-hub/issues/811)); the export
#813 wires must honor the same floor.

## What Changes

- **A `diagnostics` section** in the private configuration file: `level`, the floor of the runtime's records and of
  every module without an entry, and `modules`, one floor per module by name. The file's level takes precedence over
  `--log-level`; a module's entry applies to that module's records only. An invalid section refuses the file with
  `config-invalid`, as the edge section does; a module this runtime does not host is refused at startup.
- **The log writer** gives each logger its own floor, so the module host passes a module's configured level with its
  logger. A record below a floor is not written and not counted as dropped.
- **Noise treatment by evidence.** The installed Mac runtime's last hour held 74 records, all INFO and all meaningful
  (lifecycle intakes and companion status messages), and a simulated run of every shipped module shows the same
  shape; no record is demoted. The per-module floor is the supported control for a repetitive module.

## Capabilities

### Modified Capabilities

- `bunny-runtime`: the configuration file's `diagnostics` section and the log's floors.

## Impact

- **Code:** `apps/runtime/src/state.ts` (`checkDiagnosticsSection`, `DiagnosticsConfig`), `log.ts` (a logger's own
  floor), `host.ts` (a module's level), `runtime.ts` (the file's level, hosted-module check) and the runtime's exports.
- **Unchanged:** every record's content and level, the SDK's level table, the catalog, module behavior and results.
- **Delivery:** source now; the installed check is batched with #813's Mac installation, where the private
  `runtime.json` gains the section through the documented one-shot replacement.
