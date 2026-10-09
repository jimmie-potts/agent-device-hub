# Legacy Hub walkthrough

This retained example describes the old Hub adapter, not the current runtime.
[The common caller guide](../../../docs/app-verification.md#caller-walkthrough)
owns the operating sequence; this page preserves the adapter-specific example
and its failure/recovery details.

## Legacy Hub caller walkthrough

The commands below use the Hub adapter's wrapper,
[`npm run -s verify --`](README.md); `-s` keeps npm's banner
off stdout, so it carries only the JSON result line. Each caller sees only
documented entrypoints.

### Agent: verify, retain proof, hand off

1. `npm run -s verify -- start --scenario lifecycle-basic` prints
   `{"runId":"hub-…","state":"running","port":41705,"build":{"dirty":false,…}}`.
2. `npm run -s verify -- capture hub-… task-appears` drives the page, asserts the
   session card and writes `capture-1/after.png` and
   `capture-1/interaction.webm`, which handoff later moves under `verified/`.
   A failed assertion returns non-zero and the PNG of the failure.
3. `npm run -s verify -- capture hub-… command-reaches-fake` asserts the fake
   controller received exactly one command and read-only browsing sent none.
4. `npm run -s verify -- handoff hub-… --reset lifecycle-basic` freezes
   `.local/evidence/verify/hub-…/verified/`, reseeds the run and prints the card:

   ```text
   Preview   http://127.0.0.1:41705/   run hub-20260927T060259Z-3f9a1c
   Candidate 4adfbf48 (clean)   scenario lifecycle-basic
   Expires   2026-09-27 08:02:59Z (in 1 h 58 min)
   Extend    npm run -s verify -- extend hub-20260927T060259Z-3f9a1c
   Stop      npm run -s verify -- stop hub-20260927T060259Z-3f9a1c
   Proof     task-appears verified/capture-1/after.png http://127.0.0.1:41705/__app-verify/proof/hub-20260927T060259Z-3f9a1c/capture-1/after.png
   Proof     task-appears verified/capture-1/interaction.webm http://127.0.0.1:41705/__app-verify/proof/hub-20260927T060259Z-3f9a1c/capture-1/interaction.webm
   ```

5. Link the screenshot and video URLs from the handoff's `proofUrls`, include
   the preview card, and attach those same frozen files when the chat client
   supports attachments. Do not rely on a filesystem or `file://` link alone:
   some chat clients cannot open it. State whether attachments were actually
   included. The HTTP links use the preview's existing loopback origin and
   work only while its lease is active; the user manager keeps the preview
   running after the agent session ends. Stop or expiry closes both preview
   and proof access. Also name the retained `verified/capture-<n>/` paths for
   later use: those files survive stop with their checksums unchanged.

The Hub opts into app-verify 1.2 proof serving. Only passed frozen captures
are exposed; private state, live receipts, failed captures and later captures
have no proof URL. PNG/JPEG and WebM/MP4 display in the browser; other allowed
attachments download. Reads refuse tampering and symlinks, with a 128 MiB
artifact limit. No directory index or separate proof service is created.
Adapters pinned to earlier versions retain their existing handoff: attach
their frozen files where supported and state that HTTP proof links are not
available for that adapter.

### Human: explore, extend, let it expire or stop

1. Open the card's URL in the Windows browser. The page signs in on load.
2. Explore. Nothing the human does writes under the proof directory.
3. `npm run -s verify -- extend hub-…` adds two more hours and prints the new
   expiry; `npm run -s verify -- doctor` lists the run with its remaining time.
4. After expiry the tab fails to reload. `npm run -s verify -- doctor hub-…`
   answers `expired` with the expiry time; `npm run -s verify -- stop hub-…`
   removes the runtime directory and records `cleanup.result: clean`.

### Restart later

`npm run -s verify -- restart hub-…` records the old run id in the new receipt,
reseeds the same scenario and prints a new card. If the working tree changed
since the first run, the card says `dirty` or shows the new revision; it never
claims to be the same candidate.

### Failed start

After `npm ci`, if the Hub wrapper's verification core has not been built,
`npm run -s verify -- start` prints one JSON result with `state: unavailable`
and `error: core-build-missing`, then exits 3. Its detail tells the caller to
run `npm run build` from the repository root. No preview is created. A
composition says the same in its own 1.x line, without `state`, and exits 3:

```json
{"operation":"start","error":"core-build-missing","detail":"The verification core is not built; run npm run build from the repository root."}
```

`start` on a checkout whose build is broken reports
`{"state":"failed","cause":"readiness-timeout","cleanup":{"result":"clean"}}`.
The unit is gone, no timer exists, and the runtime directory was removed even
when seeding had already happened. The proof directory stays with the `failed`
receipt and `events.jsonl`, so `doctor` lists the run as `failed` with its
cause; that record is the useful outcome of a failed start.
