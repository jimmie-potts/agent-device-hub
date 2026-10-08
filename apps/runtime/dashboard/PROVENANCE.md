# Provenance of the runtime dashboard

Hub #922 copies the B.U.N.N.Y. dashboard into the runtime instead of moving it,
so the old Hub keeps serving `apps/dashboard` and its tests keep passing until
the retirement story (#839). Each story slice copies the files it converts. The
copy commit holds the files exactly as they were; the commits after it convert
them, so `git diff <copy commit> -- apps/runtime/dashboard` shows every change.

All files come from `jimmie-potts/agent-device-hub` at main
`5abbae9557b0a2db761625d5513ffec78d44024c`.

| Runtime file | Copied from |
| --- | --- |
| `README.md` | `apps/dashboard/README.md` |
| `src/main.tsx` | `apps/dashboard/src/main.tsx` |
| `src/routes.ts` | `apps/dashboard/src/routes.ts` |
| `src/widgets.ts` | `apps/dashboard/src/widgets.ts` |
| `src/style.css` | `apps/dashboard/src/style.css` |
| `src/skins/neon-geometry-wars.css` | `apps/dashboard/src/skins/neon-geometry-wars.css` |
| `tests/routes.test.ts` | `apps/dashboard/tests/routes.test.mjs` |
| `tests/widgets.test.ts` | `apps/dashboard/tests/widgets.test.mjs` |
| `tests/style.test.ts` | `apps/dashboard/tests/style.test.mjs` |
| `tests/layout.ts` | `apps/dashboard/tests/layout.mjs` |
| `tests/browser.ts` | `apps/dashboard/tests/browser.mjs` |
| `tests/trusted.ts` | `apps/dashboard/tests/trusted.mjs` |
| `tests/smoke.ts` | `apps/dashboard/tests/smoke.mjs` |

The tests keep their content under `.ts` names, which their conversion needs.

## What changed

The first slice converts the copies to the runtime and its strict profile, and
leaves out what other slices and stories bring back.

| Runtime file | Change |
| --- | --- |
| `README.md` | Rewritten for the runtime copy: what it has now, sync, sign-in, Places and checks. |
| `src/main.tsx` | The shell, Places, sessions and sign-in, rewritten from the 1.x snapshot, polling and bearer tokens onto the SDK's sync and the gateway's cookie session. The device views, music, Wispr page, moments, Pixoo media, device art and the running Hub's build are left out: the second slice brings the devices and music back, #927 the Wispr page, #925 the moments and #932 and #934 the module pages. Slice 3 restores the running build identity on Connections. The session row has no acknowledge button by owner decision; #1009 owns the operator clear-everywhere tool on Connections. |
| `src/routes.ts` | Strict TypeScript; the Wispr route waits for #927. |
| `src/widgets.ts` | Widgets name the families they sync; the home follows the approved mockup, with the Hub mode (#924) and inbox (#923) slots. |
| `src/style.css` | The home's two columns, and the session dot, chip and notice status. Approval/input use the blocked token; continuing questions use the question token. |
| `src/skins/neon-geometry-wars.css` | Unchanged. |
| `tests/routes.test.ts`, `tests/widgets.test.ts`, `tests/style.test.ts`, `tests/layout.ts` | Strict TypeScript that Node runs as it is, for the converted modules. |
| `tests/browser.ts`, `tests/trusted.ts`, `tests/smoke.ts` | Rewritten against the built runtime with the core and a synthetic hook, in place of the old Hub's fixture. |

New files, written for the runtime: `src/connection.ts` (the SDK participant
and the sessions copy), `src/sessions.ts` (what each session row shows),
`src/signin.ts` (the gateway's sign-in), `src/ui.tsx` (badges, facts, the tip
adapted from `apps/dashboard/src/controls.tsx` and
`main.tsx`), `build.mjs`, both `tsconfig.json` files, `tests/harness.ts`,
`tests/sessions.test.ts`, `tests/connection.test.ts`, `tests/signin.test.ts` (HTTP trace context) and `tests/hook.ts`
(synthetic lifecycle observations for acceptance runs).

## General controls and navigation

`src/device-controls.tsx` adapts the existing `PowerCard`, `ModeCard`,
`BrightnessCard`, `MediaCard`, `SceneCard`, zone and manual-moment patterns from
`apps/dashboard/src/controls.tsx` and `moments.tsx` to the runtime device and
operation records. It reuses the copied card CSS and Neon tokens; the old Hub
files are unchanged. `src/devices.ts` replaces controller-v1 admission with the
2.0 capabilities and guards. The generic `sendAction` helper from #1006 remains
the write transport. Module navigation uses the existing hash router and
gateway manifest paths; build identity uses the existing build step.
