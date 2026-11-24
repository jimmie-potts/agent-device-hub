## Context

`permittedTools` took a `devices` flag that the engine set from `profile === 'bunny'`, and Details showed `state.tools`, the section's allowlist. The page note tested `profile === 'microduck'`, while the engine read the persona's audio.

## Goals / Non-Goals

**Goals:** one scope for the engine and Details; persona-driven speech rule on both sides; the restriction stated in the spec.

**Non-Goals:** giving the companions any device or catalog tool; changing the public assistant state, which keeps the allowlist.

## Decisions

1. **A browser-safe scope module.** `tool-scope.ts` holds the device tool names, `offeredTo(name, profile)` and `profileTools(allowed, profile)`. It imports only `catalog-tools.ts`, so the page can import it; `tools.ts` imports the contract registry, which needs Node. `tools.ts` re-exports the names, and a test checks that `deviceToolOwner` names exactly the shared device tools. Alternative: publishing each profile's tools in `assistant-state`; rejected because it changes a wire contract for a value the page can derive.
2. **Details names the withheld tools.** A companion's drawer lists its offered tools under Allowed tools and the rest of the allowlist under "B.U.N.N.Y. only", so the owner sees why a listed tool is missing.
3. **The speech rule lives with the personas.** `spokenAloud(id)` in `knowledge/model.ts` reads the persona's audio and is false for an unknown profile. The engine's offer and Speak paths and the page note use it, and the refusal text names no profile.

## Risks / Trade-offs

- [The scope module duplicates the device tool names] → `tools.ts` imports them from it, and a test ties `deviceToolOwner` to the list.
