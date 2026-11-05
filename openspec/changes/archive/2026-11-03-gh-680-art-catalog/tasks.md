## 1. Contracts

- [x] 1.1 Add the `art/2.0` state family and `artContentRef` in `packages/event-contracts/src/v2/art-state.ts`, with its schema and tests
- [x] 1.2 Add diagnostic profile 1.8 with the `bunny.art.call` span, in the catalog, schema, helpers and fixtures' tests, and move the runtime to it

## 2. Ledger and providers

- [x] 2.1 Add the price table and the ledger, with per-provider limits and one loop guard
- [x] 2.2 Add the provider interface, `OpenAiImages` and `AnthropicIdeas` over a fetch transport seam, with the case table's faults
- [x] 2.3 Correct the qualification record's limits and traces for separate provider limits

## 3. Catalog and images

- [x] 3.1 Add the store: jobs, artworks, compositions, blobs, stages, feedback
- [x] 3.2 Add GIF decoding and validation, local reduction, GIF assembly, local motion and procedural art for the fallback
- [x] 3.3 Add retention, favorites, feedback and reference-respecting deletion
- [x] 3.4 Add prompt context limited to the owner's text, imagination, time, season and weather condition words

## 4. Module

- [x] 4.1 Add durable admission with a `succeeded`, `observed` outcome in one transaction
- [x] 4.2 Add job running, recovery after restart, cancellation and the deadline
- [x] 4.3 Wire `v2/art` and `weather-state`, add `art-catalog-edit`, and stage, offer and set the ambient tile through them
- [x] 4.4 Add the `art` state, sync and content references
- [x] 4.5 Test every trace in the record, including sender refusal at the responder, on top of #679's gateway and tracker tests

## 5. Delivery

- [x] 5.1 Register the module in the build, typecheck, workspace, runtime and CI, and admit its store in the upgrade inventory and preflight
- [x] 5.2 Add the module README and the development guide's commands
- [x] 5.3 Run the validation commands, on Linux for runtime tests that need it
