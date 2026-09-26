## Context

See proposal.md. The previous grid puts small status cards beside tall device controls and always exposes diagnostic facts. This UI design resolves layout and input-access choices without changing the shared data contract.

## Goals / Non-Goals

Make session identity and useful controls easy to scan. Retain evidence distinctions, command guards and all existing editing/acknowledgment actions. No progress estimate, new lifecycle inference, controller queue or installation.

## Decisions

- Use independent device/session columns instead of equal-height grid rows, so the sessions start alongside the first device. Narrow layouts prioritize sessions.
- Preserve the existing mode/power components and their shared command lifecycle. Compact presentation removes duplicate headings and known-state sentences, while unknown state, disabled reasons and command outcomes stay visible.
- Use named status indicators with symbols; do not rely on color alone. Show brightness as a bounded meter only when known. Do not invent agent completion percentages.
- Put session diagnostics and label editing in native Details. Retained notices and attention stay visible. Connections retains collector diagnostics.
- Use short noninteractive tooltips for hover/focus, clickable on touch, and dismissible with Escape or lost focus. Tooltips contain no actions; Details holds actions. Full titles wrap instead of depending on hover to reveal identity.

## Risks / Trade-offs

- Folded facts require another action → retain meaningful activity, stale warnings and attention outside disclosures.
- Compact controls could hide a failed command → reuse the complete status/lock/reload treatment and run the full browser matrix.
- Tooltip overlays may obscure text → constrain width, use an opaque panel and support Escape; test pointer, keyboard and touch.

## Migration Plan

No runtime migration. Review synthetic desktop/mobile candidates and obtain explicit owner approval before merging the revised PR. Existing source-only and installed-acceptance boundaries remain in force.
