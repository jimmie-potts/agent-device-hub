## 1. Guarded owner recovery

- [x] 1.1 Reproduce and implement exact-session, exact-turn recovery of one uncertain unknown-ID approval with a current revision. Evidence: core test failed before implementation and now covers fresh rejection, conflict, durable journal and unrelated state retention.
- [x] 1.2 Add authenticated monitor and MCP control operations with request replay protection. Evidence: focused HTTP and MCP tests failed before implementation and pass afterward.

## 2. Delivery

- [x] 2.1 Run relevant core, Hub, package and workflow checks; validate and archive the change. Record exact results in the PR.
