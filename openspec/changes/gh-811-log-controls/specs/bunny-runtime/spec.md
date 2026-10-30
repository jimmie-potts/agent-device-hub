## MODIFIED Requirements

### Requirement: Module configuration

With `--config <file>` (`RuntimeOptions.configFile`), the runtime SHALL read one private configuration file, as "Private runtime state" requires, before it serves health: `{"schema": "runtime-config/1.0", "modules": {<module name>: <section>}, "edge"?: <edge section>, "diagnostics"?: <diagnostics section>}` (see "Edge credentials and their reload" for the edge section and "Log floors" for the diagnostics section). It SHALL refuse to start, with a `RuntimeError` whose `error.code` the `runtime.failed` record carries, a file that is not private (`config-relative`, `config-mount`, `config-missing`, `config-link`, `config-checkout`, `config-not-file`, `config-not-private`, `config-too-large`) or that is not JSON, names another schema, lacks an object `modules`, has a member other than `schema`, `modules`, `edge` and `diagnostics`, or has a malformed `edge` or `diagnostics` section (`config-invalid`), and no refusal SHALL quote the file. A section for a module the runtime does not host SHALL be ignored, and a lookup SHALL find only the file's own members.

Before it starts the modules, the runtime SHALL admit each module whose manifest it accepted, in list order, with `checkConfiguration` against that module's own section only. It SHALL refuse a module, give it no participant and never start it, while the others start, when the module declares `configure` and has no section (`not-found`); when its section is not a JSON object or its `secrets` member is malformed (`invalid-request`); when its `configure` refuses, with the refusal's code and detail, or throws (`internal`); when it names a device that is not a routing ID or that a module before it already named (`invalid-request`); or when a secret file its section names is missing (`not-found`), is not private (`forbidden`), or is over 64 KiB or not UTF-8 text (`invalid-request`). Health SHALL show it `refused` with that code and a fixed detail, and its `runtime.module.refused` record SHALL carry `bunny.code`, `bunny.phase` `manifest` and, for a `configure` that threw, the error's type, never the detail or what it threw. Without a configuration file, a module that declares `configure` SHALL be refused with `not-found`. A refused core SHALL end the runtime as a failed core does (Hub #831).

`secrets.read(name)` SHALL read, anew on each call, only a file that the module's own section names, and SHALL resolve with its UTF-8 text without trailing line breaks. It SHALL reject with an `SdkError` with a registry code and fixed text: `not-found` for a name the section does not name or a missing file, `forbidden` for a file that is not private, `invalid-request` for one that is too large or not UTF-8 text, and `invalid-state` once the module's stop has begun. No secret SHALL reach a message the runtime sends, a log record, health or an error body: the runtime SHALL never log the configuration file or a secret, and the log writer SHALL drop, and count, any record whose attribute holds a secret a module has read, as text or as a number's digits. The service process's own writer SHALL share that registry: its `runtime.failed` record, and the runtime's records of a module's refusal, failure or stop problem, SHALL leave out an error attribute that holds such a secret and still be written. A span a module records SHALL leave out such an attribute too, and keep the span for its children.

#### Scenario: A missing or invalid section
- **WHEN** one module declaring `configure` has no section, another's section is an array, a module without `configure` has a `secrets` member that is not an object, a fourth's `configure` refuses with `invalid-request` and a detail, a fifth's `configure` throws, and a sixth takes its section
- **THEN** the first five are `refused` with `not-found`, `invalid-request`, `invalid-request`, `invalid-request` with that detail, and `internal`, none of them started, health is `degraded`, the sixth runs, and the refusal records carry their codes and the `manifest` phase without the thrown error's message

#### Scenario: No configuration file
- **WHEN** the runtime runs without `--config` with a module that declares `configure` and one that does not
- **THEN** the first is `refused` with `not-found`, the second runs with an undefined configuration, and its `secrets.read` is `not-found`

#### Scenario: Two modules name one device
- **WHEN** a module names devices `sign-1` and `sign-2`, the next names `sign-2`, and a third names `sign-3`
- **THEN** the second is `refused` with `invalid-request` and the other two run

#### Scenario: A secret file that changes after admission
- **WHEN** an admitted module reads its token, then the file becomes readable by group, is removed, and is replaced by bytes that are not UTF-8
- **THEN** the reads resolve with the token, then reject with `forbidden`, `not-found` and `invalid-request`; and after the runtime stops, `invalid-state`

#### Scenario: No secret in a record, health or an error body
- **WHEN** a module reads its synthetic token, logs it in a registered attribute, logs another record and throws an error quoting it from its start, another module's token file is readable by group, and a third module's reads of an unnamed secret and of a file made readable by group fail
- **THEN** the writer drops exactly the record holding the token, the module's other record arrives, the first module is `failed` with "start failed", the second is `refused` with `forbidden`, and no log record, health body or error body holds the token

#### Scenario: A failure record whose error code holds a secret
- **WHEN** a module's handler throws an error whose code is the token it read
- **THEN** the module is `failed` and `runtime.module.failed` is written with its code, phase and error type, without the error code

#### Scenario: A refused core
- **WHEN** the configuration file has a malformed section for the core, which declares no `configure` and needs no section
- **THEN** the core is `refused`, and the runtime hears of it as of a failed core, so the service process exits for the service manager to restart it

#### Scenario: A secret in a module's span
- **WHEN** a module records a span with its token in one registered attribute and a device ID in another
- **THEN** the recorded span keeps the device ID, and no span holds the token

#### Scenario: A secret in an error that escapes every module
- **WHEN** an error whose code is a module's token escapes every module's flow and ends the process
- **THEN** `runtime.failed` is written with the error's type and without the code, and no record holds the token

#### Scenario: The shipped process with a configuration file
- **WHEN** the shipped entry point runs with `--config` naming a relative path, a missing file, a file with mode 644, a file that is not JSON, a link, and a valid file
- **THEN** each of the first five exits 1 with no ready line and a `runtime.failed` record carrying `RuntimeError` and `config-relative`, `config-missing`, `config-not-private`, `config-invalid` or `config-link`, and the last serves health `ok` and exits 0 on SIGTERM

#### Scenario: A malformed diagnostics section
- **WHEN** the file's diagnostics section has `fatal` as its level, a member other than `level` and `modules`, or a level for a module this runtime does not host
- **THEN** the runtime refuses to start with `config-invalid`, before any module starts, and the refusal quotes nothing

## ADDED Requirements

### Requirement: Log floors

The log SHALL keep INFO and above by default. The configuration file's optional `diagnostics` section, `{"level"?: "debug"|"info"|"warn"|"error", "modules"?: {<module name>: <level>}}`, SHALL set the floors: `level` SHALL be the floor of the runtime's own records and of every module without an entry of its own, taking precedence over `--log-level`, which SHALL remain the process's default; a module's entry SHALL raise or lower the floor of that module's records only. A record below its floor SHALL not be written and SHALL not be counted as dropped. Every sink the runtime writes to, the journal and any export, SHALL see the same floor. The section SHALL be refused with `config-invalid` for a member other than `level` and `modules`, a level outside the four, a name that is not a module name, more than 32 module entries, or a module this runtime does not host. A floor SHALL change no result, outcome, retry, queue or permission, and lowering a floor SHALL affect only the records written after the runtime reads the file.

#### Scenario: INFO and above by default
- **WHEN** two modules each write a DEBUG, an INFO and a WARN record and the file has no diagnostics section
- **THEN** each module's INFO and WARN records are written and neither DEBUG record is, and the writer counts no dropped record

#### Scenario: DEBUG for one module
- **WHEN** the section gives one module `debug` and the other module nothing
- **THEN** the first module's DEBUG, INFO and WARN records are written, the second module's INFO and WARN records only, and no DEBUG record of the runtime's own scope

#### Scenario: A raised floor with one module below it
- **WHEN** the section sets `level` to `warn` and gives one module `debug`, and the process was started with `--log-level info`
- **THEN** the runtime's INFO records, `runtime.module.started` and `runtime.stopped` among them, are not written, the other module writes WARN only, the named module writes DEBUG, INFO and WARN, and health is `ok`

#### Scenario: The file's level over the command line
- **WHEN** the process was started with `--log-level warn` and the section sets `level` to `debug`
- **THEN** a module's DEBUG records are written
