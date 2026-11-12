## 1. Waits for real work

- [x] 1.1 Reproduce on main 97f5a91b: the reader's stream delayed 30 or 100 ms per chunk, its reconnect delayed 500 or 3000 ms, an action's answer delayed 1000 ms and the reader's resync after a restart delayed 1000 or 3000 ms each fail `scenario-end-to-end` on virtual time; 0 and 20 ms per chunk and 50 and 200 ms per reconnect pass; on the real clock every one passes.
- [x] 1.2 On virtual time a wait ends only once what the run published has reached the reader, within 15 s of real time. Evidence: the gated adapter test, which fails without the wait.
- [x] 1.3 On virtual time an expectation past its bound waits, without moving the run's time, while real work is in flight. Evidence: the two gated adapter tests (a held reconnect, a held answer), which fail without overtime.
- [x] 1.4 A restart's resync holds the run's time once the reader's stream is back. Evidence: the gated adapter test, which fails without it, as on main.

## 2. Documents and delivery

- [x] 2.1 Describe the waits for real work in `apps/runtime/verify/README.md` and in the requirement "A disposable run on virtual time".
- [x] 2.2 Run the reproductions again, the adapter test file 10 times normally and 20 times under the slow reproductions, `clock.test`, the captures that drop a part, crash, restart or run a stopped hook, build, typecheck, lint, the workflow checks and the whole verification suite once, and record them in the pull request.
- [x] 2.3 Sync and archive this change on the delivery branch. Independent review and merge follow outside this change.
