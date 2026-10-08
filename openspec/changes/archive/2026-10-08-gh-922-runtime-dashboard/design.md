## Context

See proposal.md, "Why". The schema's criteria for a design apply: the change crosses component boundaries (a browser page, the gateway, the SDK edge and the core), adds a remote part's transport mode and fixes how a consumer derives a finished turn. ADR 0012's "Consumers and recovery", "Inbox and history", "Errors, effects and outcomes" and "Observability" govern it; #835's design sets the gateway and its sign-in.

## Goals / Non-Goals

**Goals:** the copied shell, routes and skin on the runtime; sign-in on the gateway's cookie session; the sessions through SDK sync with no polling and no replay; the finished turn from the record; the approved home's panels; tier 1 and tier 2 checks.

**Non-Goals:** device cards, controls and music (the second slice), module pages, the run preview and the running build identity on Connections (the third), the inbox's items and the timeline (#923), the Hub mode selector (#924), automation pages (#925), the Wispr page (#927), the module pages themselves (#932, #934), the session label command and its control (#1006), the clear-everywhere operator tool (#1009), and the launcher's command-line opener.

## Decisions

- **Copy per slice.** Each slice copies the files it converts, in a commit of its own, so review reads the conversion as a diff. Copying all of `apps/dashboard` at once would leave 1.x code in the runtime that no build or lint could check.
- **The copy lives in the runtime, under the strict profile.** `src/` type-checks for the browser and `tests/` for Node, which runs the tests' TypeScript as it is; the browser bundle is built into the runtime's `dist/dashboard/`.
- **One shared cookie session.** A reload or a second tab uses the live session (`GET /api/v2/authority?scope=read`), on both load and a sign-in click. If a fresh session is created, the gateway ends the old cookie's session and streams before replacing it. The old page logged its own session out on unload; with one cookie for every tab that would sign the others out, so the copy does not.
- **The SDK client in the browser.** The page uses the SDK's own remote transport, not a client of its own. Its graph drops Node built-ins: Web Crypto for IDs, `process.getBuiltinModule` for Node's async context, and the error body in a module that reads no file. A test bundles it for a browser.
- **Ended sessions.** A remote client keeps reconnecting with backoff and says nothing per attempt. A browser needs to know when the runtime refuses its session, so the client reports `remote.refused` once per code; the page then stops and offers one sign-in.
- **The finished turn's rule.** The dashboard ranks attention and work first, then a finished turn until the session record carries positive read evidence, any consumer acknowledgment or a later known turn. Unknown evidence never clears it. There is no row acknowledge button (owner decision, 2026-10-08). Each device keeps its own clearing policy; this does not change the shared status helper.
- **Places on a run.** The links document always carries `places`, so a run cannot be told by its presence. The page treats any port but B.U.N.N.Y.'s own place port as a preview, and shows only the Local places the runtime names.

### Boundaries and outcomes

- **Entry points and hand-offs.** The page loads from `GET /` and signs in through `POST /api/v2/browser/{session,launch,logout}` and `GET /api/v2/authority`; it reads `GET /api/v2/links` once and syncs `session` through `/api/sdk/v1/*` as `bunny/parts/dashboard`; this slice sends no session or device command.
- **Refusals and outcomes.** The page's checks refuse with `forbidden`, `not-found` and `invalid-request` before anything is served. A sync changes nothing. An `unauthenticated` or `forbidden` sync answer ends the link; other refusals keep the records stale and retry.
- **Codes and retries.** Registry codes only. Only reconnection (the SDK's backoff, 100 ms to 5 s) and sync (the page's, 1 s to 30 s) repeat by themselves, each with one owner and a cap. Slice 2 owns command refusal text: a page-side refusal says nothing was sent, a core refusal says refused with nothing changed. It also owns uncertain-action locking and its negative control.
- **Records and traces.** The browser writes no log. Its five non-edge sign-in/read operations carry fresh W3C context from the SDK's browser-safe `childOf` helper. The gateway adopts valid context only after authentication, ownership and input checks, and records bounded server spans through the runtime's existing recorder: `bunny.command.request` for the three session mutations and `bunny.feed.read` for authority and Places. Missing or malformed context starts a root; a logout without a live cookie also starts a root. A failure after admission keeps the span's context in the fixed refusal record, without cookie, code, body or exception text. Refusal summaries have no fabricated shared parent. SDK `remote.*` decisions stay in the page. Other gateway routes are unchanged; slice 2 commands use SDK trace context.
- **Fault cases.** A lost stream reconnects and resyncs; a session the runtime ends stops the page with its last records; a refused or failed sync is tried again with backoff, records kept and marked stale; a dashboard that is not built answers `not-found`; a sign-in that fails shows an alert.

## Risks / Trade-offs

- A browser's synchronous async-context stand-in detects a handler's own close only before its first await. The page never closes a subscription from a handler.
- The preview rule reads the page's port: a runtime installed on another port would hide its unnamed Local places until its edge names them.
- The core has no `session-label-set` command yet, which the route map gives #1006. The label control waits for that story, outside this slice.
