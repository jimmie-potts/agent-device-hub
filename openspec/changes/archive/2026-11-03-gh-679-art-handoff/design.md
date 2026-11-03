## Context

[The qualification record](../../../../docs/art-generation-qualification.md#exact-artwork-handoff) selects the handoff: a shape like `companion-part.ts`, families in `packages/event-contracts`, and three protections for tracker size, the inbox and direct access. It leaves field names, bounds and refusal codes to this story. Modules and device responders come later, under #680, #1288, #681 and #684, so they need stable contracts now.

## Goals / Non-Goals

**Goals:** contracts that #680, #1288, #681 and #684 can adopt; a core boundary that cannot be bypassed; no art bytes in durable core records.

**Non-Goals:** `modules/art`, device responders, the `art` state record, the Show dispatch, installation and device contact.

## Decisions

- **`art-dispatch` nests the forwarded payload.** `{requestId, family, target, data}` follows `assistant-dispatch`. `data` is the forwarded family's `$defs/content`, closed with `unevaluatedProperties`, so a stage's fields have one definition. The alternative, flat fields as in `reachy-dispatch`, would repeat them in a second schema.
- **`lifetimeMs` is relative, from one minute to thirty days.** The device counts it from its own admission, so a clock difference cannot shorten a copy, and staging again renews it. An instant would need the two clocks to agree.
- **Stage bounds.** Dimensions up to 512 and frames up to 256 hold every display profile the record names, and tightening a device's own limit stays with its responder. `sha256` is the rendition's hash; `compositionId` may hash a sprite sheet, so the validator does not compare them.
- **Refusal codes.** An unknown or lapsed copy is `not-found`, and the detail says a lapsed copy must be staged again. `expired` would be false: the tracker, device controls and timeline read it as a command that never reached its owner. The same ID with other bytes is `duplicate-conflict`.
- **`art-auto` only starts, has no `text`, and allows an owner label.** The owner cancels any job with `art-request`, so it has no cancel. Nothing typed reaches an automatic job. The record's trace needs an owner label to validate and stay automatic, so its `origin` and `purpose` have `art-request`'s full ranges.
- **`DeviceCommand` is unchanged.** `apps/runtime/dashboard/src/devices.ts` switches over that union exhaustively, and a stage is not a general device control, so `artStageSupported` is its own function.
- **One private key for every omitted payload.** Each family keeps its own digest domain, so ONN's stored digests stay valid. The fence that forbids a replacement key now counts any omitted payload, because a lost key would otherwise turn an art retry into a false conflict. It runs only when no key is pinned, so routine stages do not scan `core_operations`.
- **A stage's whole payload is omitted, not only `base64`.** The stored `data` exists only for resending, and a stage cannot be resent. The `operation` record and history steps already carry no payload.

- **Sender rule at the responder.** The in-process bus checks no sender, so a module could address a display's key directly. Each art responder refuses any source but `bunny/core`, through `artCommandRefusal`, as companions does.
- **Inbox send-again refuses a moment naming art.** A resend would skip arbitration, as MicroDuck's would skip its controls. The fresh path belongs to #684.

## Risks / Trade-offs

- A failed or uncertain automatic job no longer holds an inbox item, so it can pass unnoticed until #680's `art` state shows it. Its `operation` record can also be retired after 256 settled records, which leaves the tracker row and history as the durable evidence. ADR 0012's 2026-11-03 amendment records this.
- Hashing up to 160 KiB in each validation costs little, but a stage is hashed and digested more than once on its way through the core. Stage traffic is low, and the worst automatic rate is bounded by #680's loop guard.
- `weather` accepts any lowercase words, so a pattern cannot prove that no place name appears. #680 builds it from condition words only.

## Migration Plan

No stored data changes. Existing operations and digests stay valid. Older code that reads a stage's operation sees the same `payload` marker it already handles. Modules adopt `device/2.2` and `moment-play/2.1` under their own stories.
