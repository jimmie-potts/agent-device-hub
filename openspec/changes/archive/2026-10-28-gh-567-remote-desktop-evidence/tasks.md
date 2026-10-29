## 1. Contract and edge

- [x] 1.1 Add the `desktop-metadata` family, schema, fixtures and parity, with invalid cases for a wrong subject, a `local` client, oversize sets, duplicate IDs and a user title; `npm run test:events:built` and `npm run test:events:python` pass.
- [x] 1.2 Grant the `ingest` scope the family on its keys and bind a snapshot's feed to the credential's derived source on every entry; tests prove a hook credential, another feed and a read credential are refused `forbidden` and the core takes no session change from a snapshot.

## 2. Module and collector

- [x] 2.1 Add the `sources` section, the remote feed transport and per-source runs; module tests prove read, archive and title evidence from snapshots, freshness and recovery, refused snapshots, two sources with the same thread ID and the released section unchanged.
- [x] 2.2 Add the collector with its bounds, heartbeat, records and signals; tests prove bounds, refusals of non-private or wrong files, and a real runtime taking its snapshots through the edge.
- [x] 2.3 Prove the real core takes a remote source's evidence through the edge, refuses an archived conversation's late hook and a forged feed, and that the container profile admits a remote-only section and refuses a local one.

## 3. Delivery evidence

- [x] 3.1 Document the `sources` section, the remote feed, the collector, the container admission and the disposable `codex-desktop-remote` run; run build, typecheck, lint, the module, runtime, events, SDK, container and workflow checks and record them in the PR.
- [x] 3.2 Keep independent review, CI, guarded merge, Mac core installation and PC collector installation as separate gates; record the Mac `local` gap as an owner decision.
