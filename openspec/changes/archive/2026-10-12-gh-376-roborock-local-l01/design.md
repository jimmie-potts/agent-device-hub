## Context

See proposal.md. This security-sensitive change needs a design artifact. The existing final RPC encoder, reader queue and socket cleanup own the read boundary. The same supported a97 account family can use a different local socket version. Pinned MIT ioBroker source already contains both crypto primitives; independent Python/OpenSSL-style vectors verify their adaptation.

## Goals / Non-Goals

**Goals:** One explicit local choice, authenticated bounded replies and preservation of the five local read operations and one cloud map operation.

**Non-Goals:** Negotiation, discovery, initialization RPC, another provider, commands, new collection sources, retention changes or live-device tests in source qualification.

## Decisions

- Add an optional closed target field, with omission preserving old input/output shape. Reject unknown values and additional fields before connection. Do not change session API protocol or vendor map framing.
- Reuse the existing codec and local socket lifecycle. For L01, derive the AES-256-GCM key from the timestamp/local key/salt using SHA256, the IV from sequence/random/timestamp, and AAD from sequence/client nonce/ack nonce/random/timestamp. Each socket gets a fresh client nonce; do not retain it across retries.
- Send one L01 HELLO, then the allowlisted RPC only after a successful acknowledgment. Use its wire version for acknowledgment controls. Keep existing correlation, payload bounds, cancellation and safe registry errors.
- Use explicit selection rather than automatic probing because the owner already selected and qualified the target; probing would add device traffic and failure semantics.

## Risks / Trade-offs

- Incorrect encryption or stale nonces could accept invalid observations → independent byte vectors and corrupted-tag/wrong-nonce loopback failures.
- Legacy readers reject the new field → absent field preserves existing targets; selected installed recovery must support the selected input. Do not claim compatibility with an older reader that lacks L01.
- Synthetic success does not establish installed behavior → retain #376's separate authorized installed and observed-run comparison.

## Migration Plan

No private store or shared contract migration. Existing targets need no edit. Prepare the selected private target change only for an authorized activation whose candidate and recovery readers support it; preserve private originals. Source work neither edits the installed configuration nor restarts its owner.
