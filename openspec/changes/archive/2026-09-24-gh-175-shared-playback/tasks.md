## 1. Shared playback module

- [x] 1.1 Serve snapshots and source-bound commands from a non-Sony fake source through `createPlayback`. Evidence: `a non-Sony source uses the shared playback interface unchanged` in `apps/hub/tests/playback.test.mjs` failed with `ERR_MODULE_NOT_FOUND` for `dist/playback.js` before the module existed and passes after.
- [x] 1.2 Apply the freshness rules with a controlled clock. Evidence: `only successful Sony reads refresh freshness, which ages through stale to unavailable` failed at five seconds of age (actual `available`, expected `stale`) before the thresholds existed and passes after. The same test shows JSON-RPC errors, HTTP 500, malformed and mismatched replies, dropped connections and timeouts leave the observation time unchanged. `freshness follows the monotonic clock and receipts stay bounded` failed (a wall-clock step back kept the source available) before age used a monotonic clock, and passes after.

## 2. Sony source

- [x] 2.1 Poll `getPlayingContentInfo` and normalize AirPlay metadata, status, missing fields, other inputs and receiver errors. Evidence: `Sony AirPlay observations normalize metadata, status and controls` failed with `ERR_MODULE_NOT_FOUND` for `dist/sony.js` before the module existed and passes after.
- [x] 2.2 Bound reads with a timeout, prevent overlap and recover after failures. Evidence: the freshness test covers timeout and recovery; `Sony reads poll on a timer without overlapping` was added after the poller and shows a peak of one in-flight read and no reads after close.

## 3. Hub routes

- [x] 3.1 Validate `playback` configuration, compose the source and serve the snapshot and command routes. Evidence: before wiring, every route test timed out waiting for an available snapshot (the route returned 404) and the configuration test failed with `storage-unavailable` instead of `invalid-playback`; all pass after. Address-shaped source IDs failed the configuration test before they were rejected.
- [x] 3.2 Cover authentication, the configured target, unsupported controls, duplicate next, concurrent commands, uncertain and failed outcomes and staged rejection. Evidence: after wiring and before the command gates, `play` reached the receiver and a repeated uncertain request was resent (`pausePlayingContent` twice); the four AC3 route tests and the staged test pass after the gates.

## 4. Documentation and delivery

- [x] 4.1 Document configuration, routes, freshness and extension points in `apps/hub/README.md`; add playback validation to `docs/development.md`; correct Windows-first wording in ADR 0004, `docs/architecture.md` and the qualification delivery note; bump the hub package version. Evidence: the diff; hub 0.2.5.
- [x] 4.2 Run the hub, MCP, shared build/type, contract and workflow checks; sync and archive this change. Record exact results in the PR.
