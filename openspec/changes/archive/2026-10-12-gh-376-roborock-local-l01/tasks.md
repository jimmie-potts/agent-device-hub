## 1. Private selection and framing

- [x] 1.1 Add a focused failing private-target selection regression; implement the optional closed selection and verify legacy inputs remain unchanged.
- [x] 1.2 Add independent synthetic L01 vectors; implement authenticated framing and verify roundtrip, corrupt-tag, wrong-nonce and wire-version refusals.

## 2. Existing socket integration

- [x] 2.1 Integrate selected HELLO, nonce-bound RPC and acknowledgment in the existing socket; verify loopback reads, fragmented controls, cancellation, correlation and prohibited-call refusal with no negotiation.
- [x] 2.2 Update protocol/private-setup guidance and exercise transport/module consumers plus required build/type/lint/shared/runtime/workflow checks; keep actual device data private.

## 3. Source acceptance

- [x] 3.1 Validate, synchronize and archive this change after source evidence; independent review, PR/main CI and installed acceptance remain external delivery receipts.
