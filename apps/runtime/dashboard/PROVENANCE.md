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
