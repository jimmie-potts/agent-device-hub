## Context

See proposal.md for why. `AssistantEngine.provider(profile)` returns the configured provider only for `bunny`; Reachy and MicroDuck fall back to a harness's `profileProviders` entry or the synthetic provider. The title seam does the same: only `bunny` gets `titleProvider`. The persona, the per-turn limits, prompt caching and the spend ledger already follow whichever provider a profile's task uses. `#speak` offers every profile's turn-ending message to the speech coordinator, and nothing stops MicroDuck's English text from reaching the voice once a real model writes it.

## Goals / Non-Goals

**Goals:** one configured provider and model for every profile; titles for every profile on a real title model; MicroDuck never spoken in English; no Demo label; the synthetic provider kept for tests and as a configuration choice.

**Non-Goals:** per-companion models, efforts or section keys; personality work; quack audio; device or catalog tools for the companions, which stay B.U.N.N.Y.'s (unchanged `permittedTools` gate); any wire, table or section change.

## Decisions

1. **One shared provider and model.** The issue's acceptance says the companions use "the configured provider and model" and that "the existing private provider section configures all profiles", so the section gains nothing and every profile reads the same `assistant` object. `provider(profile)` is now the harness's `profileProviders[profile]`, else the configured provider, else the synthetic one. Alternative: a `profiles` map in the section for separate models per companion; rejected because the issue settles one section and no new key.
2. **The harness override wins over the configured provider.** Tests that mix a synthetic companion with a paid B.U.N.N.Y. keep working by naming the companion in `profileProviders`; the private section never sets it, so production behavior has one provider.
3. **The configured title provider serves every profile.** `ConversationTitles` already decides per profile through its `provider` seam, and the #2075 triggers carry no profile rule, so the seam returns `titleProvider` (or the harness's `syntheticTitleProvider`) for every profile. Nothing else exempts the companions: the triggers, prompt, spend reservation and persona fallback are the same code.
4. **The quacks-only rule lives in the engine, from the persona.** `#speak` returns before the offer when the task's persona audio is not `speech`, and the `speak` control refuses such a message with `invalid-request` and fixed text. The rule is read from `PROFILES`, which already marks MicroDuck `quacks-only`, so no profile name is hard-coded in the engine. The page shows the note in place of Read aloud. Alternative: filtering in the speech coordinator; rejected because the coordinator sees replies without their profile.
5. **Demo labels are removed, not renamed.** With the shared model none of the three is synthetic in a configured installation, and on the synthetic provider all three are, which Details already states as the provider. The rail's `rail-tag` element and styles go, and the profile map keeps names only.
6. **What reaches the model.** The companions' prompts carry the same classes as B.U.N.N.Y.'s: the fixed instructions, the persona, the owner's active preferences, the task's own transcript and tool results, under the same 128 KiB context bound. The ADR 0011 amendment of 2026-10-05 allows these to be sent to Claude; no new class or destination is added.

## Risks / Trade-offs

- [More paid calls: each companion turn and its title checks] → every call is reserved before it is sent and counted in the shared $20 daily pacing, the local monthly estimate and the Anthropic workspace's monthly limit; a companion's new message is refused at a reached limit, as B.U.N.N.Y.'s is.
- [A companion task left unfinished by the synthetic provider continues on the real model] → its own transcript, the owner's text and the fixed synthetic question, is that task's context, the same classes as above; the owner can cancel it.
- [Reachy may propose the non-device commands the allowlist names, such as `set_mode`] → unchanged: the allowlist and the core's dispatcher already gate every profile, and each command still needs the owner's approval.

## Migration Plan

No migration. An installation whose section names only B.U.N.N.Y.'s model needs no change: after the upgrade the companions use that model. `apps/runtime/UPGRADE.md` records the behavior change and the return to the release before.
