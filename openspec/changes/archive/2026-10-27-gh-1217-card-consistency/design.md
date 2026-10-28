## Context

See proposal.md for motivation and issue #1217 for acceptance. The runtime already imports a semantic Quiet glass skin and shared shell geometry, while each reusable card has scoped styles. Raw card styles use 20/22/24px padding and different phone breakpoints, but the first rendered comparison shows that the shell already aligns desktop frames at 24px with a 26px radius. Preserve that existing frame. The remaining differences are title hierarchy, responsive padding, tab shapes/type and footer targets. Module-owned styles must remain independently owned and browser-safe.

## Goals / Non-Goals

**Goals:** one runtime presentation seam for the parts that should match, with browser evidence from real cards at supported widths. Preserve content, ownership and native semantics.

**Non-Goals:** replacing the React components, making all cards the same height, resizing device artwork, editing module backends, adding a theme picker, rewriting state/outcome evidence or activating optional sources.

## Decisions

- Put shared visual values in the existing skin and apply a small runtime-only card stylesheet after shell styles. Existing card selectors expose the required seams; a new React factory or per-module dependency would add no useful behavior. Module-owned CSS continues to supply domain geometry and artwork. Legacy dashboards are unaffected.
- Share outer padding/radius, header type, tab track/selection, actionable status targets and footer-link sizing. Keep nested agent tiles distinct, their attention surfaces untouched, and large Music/run/state values separate from card titles.
- Honor the existing selected Home slot width. The rendered comparison found Music and Wemo capped at 430px inside a 588px slot. Remove that cap only inside Home; feature-page width limits, device artwork and the supported size choices remain unchanged.
- Match the existing quiet command presentation: omit Music's initial no-command placeholder while preserving its live region and every actual progress/error/result. Filter only the neutral initial message with no request identity; leave the shared command owner and other consumers untouched.
- Extend the hosted smoke entry with one synthetic real-runtime comparison. Fixture-only setup can select optional empty cards and a room; opening or inspecting them sends no product command. Existing owning journeys retain the command/fault checks. Baseline comparisons fail before the shared style is added.
- This creates no communication, error, logging, trace or storage boundary. Current refusals, uncertain outcomes, retries and diagnostics are inherited without changes. No migration is needed. Existing flows and fixtures are the appropriate checks; a new backend or protocol test is unnecessary.

## Risks / Trade-offs

- Shared selectors could override an intentional domain rule → target named card/frame/control seams, preserve content dimensions and run the owning/full browser suites.
- Narrow layouts or selected/focus contrast could regress → inspect 320/390px and desktop in both themes, retain keyboard and accessibility checks, and honor reduced motion.
- Equalizing outer styling could erase attention → preserve the existing attention selectors and explicitly verify their distinct treatment.
- A screenshot could expose personal data → use synthetic sources for publication and keep installed evidence private under ADR 0011.

## Migration Plan

Deliver through the normal independent reviews and PR/main CI. Use the qualified routine WSL upgrade with stopped-writer backup and passive installed browser checks, preserving configuration and saved layouts. Recovery remains separately assessed by that procedure; a CSS change supplies no downgrade or physical-device claim.
