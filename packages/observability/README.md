# B.U.N.N.Y. observability contract

This private artifact defines canonical diagnostics for TypeScript, Python and
browser producers. It does not start an exporter or instrument a component.
Read `CONTRACT.md` in the archive (source: `docs/observability-contract.md`)
before integrating it. Source tests
prove the contract; they do not prove ingestion, installation or device behavior.

Node 24 consumers import the pure API from `@jimmie-potts/bunny-observability`
and the explicit Pino/context adapter from `@jimmie-potts/bunny-observability/node`.
Browser applications bundle only the pure entrypoint. Validation is compiled at
build time and works without `unsafe-eval`. Python 3.12/3.14 consumers add the
artifact's `python` directory to their module path and install the pinned
`requirements-contracts.txt` in their own environment.

`createRecord` / `create_record` selects registered fields before serialization.
`validateRecord` / `validate_record` strictly rejects unknown fields.
`toOtlp` / `to_otlp` converts a valid record to an OTLP JSON logs request.
`projectRecord` / `project_record` explicitly targets a supported schema profile.
Invalid input returns a fixed failure code or no output; never log rejected input.
Both languages expose a no-op emitter. Executable hosts explicitly create a sink;
libraries accept an injected emitter and default to no-op.

`createPinoEmitter(callback)` and Python `BoundedEmitter(callback)` accept canonical
records, apply the INFO minimum, bound their output queue and drop newest when
full. Call `close()` at shutdown (await it in Node). The callback receives one
canonical NDJSON line. It must be a bounded transport, not a device command.
Python uses one daemon thread per explicitly constructed emitter. Node callbacks
must return promptly; asynchronous transport work returns a promise. Neither
adapter can cancel arbitrary host callback code. Hosts own transport cancellation
and must not create repeated emitters to escape a stalled sink.

`DiagnosticContext` stores only validated IDs and flags. Capture explicitly at
owned queue boundaries and restore around each work item. Python context does
not cross threads or processes automatically. Authenticate and establish boundary
ownership before `parseTraceparent` / `parse_traceparent`; absent or malformed
context creates no parent. `traceHeaders` / `trace_headers` emits only qualified
`traceparent`, never baggage or tracestate.

## Immutable distribution

Build from the reviewed source revision with `npm run package:observability`.
The archive and `.sha256` sidecar are written under `artifacts/`. The archive
contains a manifest hashing every contract/helper/fixture file. Publish the
versioned archive once using the repository's private release convention; never
replace bytes under an existing version. Record the release URL, source revision,
archive SHA-256 and manifest SHA-256 in the consumer's dependency receipt.

Before extraction or installation, verify the archive SHA-256 against that
reviewed receipt. A downloaded sidecar alone is not an independent trust anchor.
Then verify manifest file hashes. Install Node consumers from that exact archive
with scripts disabled; preserve the package lock. Python copied consumers must
preserve the artifact layout (`python/` beside `src/`) and the receipt. Do not copy
only the Python module. No public registry publication is required.

`npm run test:observability:package` builds the archive twice, compares bytes,
installs it in an isolated consumer, checks hashes, and runs Node/Python/query
checks against the installed bytes. Browser verification has its own command,
`npm run test:observability:browser`; the package test also bundles the installed
pure entrypoint to verify it has no Node-only dependencies.
