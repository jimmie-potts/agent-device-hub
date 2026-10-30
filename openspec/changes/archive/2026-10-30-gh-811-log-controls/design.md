## Context

`LogWriter` (`apps/runtime/src/log.ts`) has one floor, `#minimum`, set from `RuntimeOptions.logLevel`, which the
process entry takes from `--log-level` (`info` by default). Every logger the writer hands out, the runtime's own and
each module's (`host.ts`, `options.logs.logger(MODULE_SCOPE, {'bunny.module': name})`), filters at that floor. The
configuration file (`state.ts`, `readRuntimeConfig`) admits `schema`, `modules` and `edge` only. The container entry
point passes no `--log-level`, so the installed Mac runtime has no supported floor control.

## Goals / Non-Goals

**Goals:**
- INFO and above by default, DEBUG selectable per module, through the one private configuration file.
- One floor for every sink: the journal today, the OTLP export #813 adds.
- Invalid settings refused through the existing `config-invalid` path, quoting nothing.

**Non-Goals:**
- A second logger, a new aggregate record dialect or a catalog change.
- Reloading the floor without a restart (SIGHUP reloads credentials only).
- Demoting records without evidence of repetition; see "Noise treatment".

## Decisions

- **Where the control lives.** The configuration file, not the command line or the environment: it is the operator's
  one private input to the installed runtime, the container profiles admit it without a code change (they inspect
  `modules` and `edge` only), and the documented one-shot replacement already edits it. `--log-level` stays as the
  process default for development and the verification run.
- **Shape.** `{"level"?: <level>, "modules"?: {<name>: <level>}}` with `debug`, `info`, `warn` or `error`; `fatal`
  is the process's own failure and never a floor. `level` is the runtime's floor and the default for every module;
  a module's entry wins for that module, lower or higher. Rejected: a list of debug modules, which cannot raise one
  module's floor; a floor per scope, which the operator does not think in.
- **Validation in two places.** `checkDiagnosticsSection` refuses the shape, the levels, a name that is not a module
  name, another member and more than 32 entries, as `checkEdgeSection` does, with `config-invalid` and no quoted
  value. `startRuntime` refuses a name that is not one of its hosted modules, since only the runtime knows that list;
  a typo therefore fails the start rather than silently doing nothing. Rejected: ignoring an unhosted name as an
  unhosted module's section is ignored, because a level that does nothing is an operator mistake with no other signal.
- **The writer's seam.** `LogWriter.logger(scope, base, minimum?)` takes the logger's own floor; the writer's floor
  stays the default. The module host passes `options.levels?.[name]`. The record below a floor is not counted as
  dropped: dropping is the contract refusing a record, not the operator declining one.
- **Startup order.** The writer is now created after the configuration is read, so the file's level can be its floor.
  Nothing between the two logged before, and the process's own writer still records a failed start at `--log-level`.
- **Noise treatment.** Counts only: the installed Mac runtime wrote 74 INFO records in the hour before pickup, 62
  lifecycle intakes and 12 companion status messages, each an accepted piece of work ADR 0012 records once at INFO. A
  simulated run of every shipped module at the DEBUG floor for 180 s wrote 70 records: 15 `runtime.sync.served`, 10
  `runtime.sync.refused` (WARN, modules syncing before the core served, at startup only), one start, one stop and one
  outbox record per module, four `feed.changed`/`outbox` records and 12 DEBUG `runtime.module.starting` records; no
  event repeated after startup. The repeat helpers (`DeviceAvailability`, the edge's and the gateway's refusal
  summaries, the delivery-drop window) already summarize at DEBUG or once a minute. No routine read is demoted
  without a demonstrated repetition; the per-module floor is the control for a module that turns out chatty.

## Risks / Trade-offs

- **A restart to change a floor.** The owner accepted downtime; a reload would need a second code path through SIGHUP.
- **DEBUG volume.** A module at DEBUG writes every bounded retry and duplicate observation; the floor is per module so
  the operator pays only for the module under diagnosis, and the writer's queues stay bounded.
