## 1. Package and commands

- [x] 1.1 Add the `controllers/tidbyt` workspace package, root build/typecheck entries and `test:tidbyt`/`test:tidbyt:built`/`test:tidbyt:python` scripts. Verify that `npm run build` and `npm run typecheck` pass.
- [x] 1.2 Add the two new steps to both contracts/state CI jobs, update the workflow test's suite list and built-payload map, and pin Pillow in `requirements-contracts.txt`. Verify that `npm run test:workflow` passes.

## 2. Renderer

- [x] 2.1 Write failing renderer tests for valid and invalid frames and the import boundary, then implement `render.ts` and `webp.ts` until they pass.
- [x] 2.2 Commit golden WebP fixtures with their expected RGB data. Verify with the Pillow decoder in `test:tidbyt:python` and with a byte-equality TypeScript test.

## 3. Connection and credentials

- [x] 3.1 Write failing connection tests against a fake fetch covering request shape, success, 401/403/UID-500, 404, 400, 429 with seconds, date and missing `Retry-After`, 5xx, timeout, refused connection and secret redaction. Then implement `connection.ts`.
- [x] 3.2 Write failing credential-file tests for permissions, missing values, invalid installation IDs and redaction. Then implement `credentials.ts`.

## 4. Controller queue and evidence

- [x] 4.1 Write failing controller tests for target validation, bounded admission, duplicate/conflict/join, FIFO overlap, cancellation, uncertain sends with no replay, v1 unsupported commands, authentication and rate-limit holds, reconfigure, close, reconnect refresh and stale evidence. Then implement `controller.ts`.
- [x] 4.2 Validate every emitted receipt and embedded snapshot against controller v1 `validate()` in the tests.

## 5. Documentation and delivery

- [x] 5.1 Update the Tidbyt README and `docs/development.md` with the package, commands, profile, evidence limits and the remaining #19/#21/#23/#24 work. Verify by inspection.
- [x] 5.2 Run the shared build, type, controller-contract, lifecycle, agent-state, hub, MCP, dashboard and workflow checks plus the new Tidbyt checks. Then synchronize the spec delta and archive this change. Independent reviews, current-head CI, guarded merge and merged-main readback remain SDLC gates after archive.
