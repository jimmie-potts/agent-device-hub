## Context

A live Lines Music session (`modules/nanoleaf/src/music-session.ts`) reads its Free base as the work command's first device call: `GET /effects` for the selection and saved list, then `GET /state` for power and brightness. `readFreeBase` (`moments.ts`) accepts only a listed scene, so every other selection refuses the Start. Restoration (`restoreFreeBase`) writes brightness, then selects the scene by name, each write guarded before and after for a newer choice.

The Nanoleaf API selects again only a scene saved on the light. Its `/state` also reports `colorMode` (`hs`, `ct` or `effect`), `hue`, `sat` and `ct`; a hue and saturation or a colour temperature written to `/state` shows a plain colour, which the light reports as `*Solid*`. The colour behaviour is the API's documented behaviour; #725 qualifies it on the installed Lines.

## Goals / Non-Goals

**Goals:**
- A Start succeeds over a saved scene, a plain colour and any other readable selection, including `*ExtControl*` frames from an earlier session.
- Each ending reports truthfully what it put back, and no scene is guessed.
- The light's record exposes the last read selection with no extra device request and no scene name.

**Non-Goals:**
- Bounded moments keep the named-scene rule (owner decision, 2026-11-10).
- Panels (NL22) live sessions (#1272), timeline admission (#1273) and the installed check (#1614 AC4).
- Re-reading the light only to refresh the record.

## Decisions

### D1. The base has three kinds

`readMusicBase` (`music-base.ts`) reads the same two endpoints and returns one of:
- `scene`: a listed selection not starting with `*`, as before.
- `color`: `*Solid*` with `colorMode` `hs` and an integer hue (0–360) and saturation (0–100), or `ct` and an integer temperature, each within the bounds the light reports.
- `unnamed`: anything else, including `*Solid*` whose colour is unreadable. Its selection is kept so the streaming entry can check it.

A light that is off, or reports no selection or brightness, still refuses `invalid-state`. Alternative considered: also accept a light that is off. That would start Music on a dark light, and no decision covers it.

### D2. Restoration by kind, with the same guards

`restoreMusicBase` keeps `restoreFreeBase`'s order and guards: the light must still report `*ExtControl*`, be on at the base brightness, and show nothing newer before each write. A scene base must still be listed. Its writes are brightness, then the scene by name or the colour in one `/state` write (`{hue, sat}` or `{ct}`). The colour goes in one write so that a hue can never land without its saturation. An unnamed base returns `none` before any read or write, so Stop completes `succeeded`/`observed`. Moments keep `restoreFreeBase` unchanged.

### D3. The streaming entry checks the base's selection

The entry's `/effects/select` read must report the base's selection, the scene's name or the kept selection. Any other selection is a newer manual choice, as before. A colour picked in the app keeps `*Solid*`, so a colour base also reads `/state` there and ends the session `manual`, with no write, when the colour or colour mode differs. That is the only request added before streaming; scene and unnamed bases keep exactly their earlier requests, and nothing is added during play. A colour picked between that read and the entry write is replaced by the entry, as the existing known limit already says for a scene chosen in the gap.

### D4. The selection lives in the module's `nanoleaf-wall` record

The general `device` record is shared by every module, and `music-lighting-device` is an event-contract family the core consumes; neither carries Nanoleaf-only facts without a contract change. The module-owned `nanoleaf-wall` record already carries per-light status (`mode`, `failing`, `held`), and the dashboard shell already syncs it. It gains `selection` and `musicBase`. Scene names never leave the module, as for the scene list: a saved scene shows as its opaque `scene-…` ID, a known placeholder (`*Solid*`, `*Static*`, `*Dynamic*`, `*ExtControl*`) by its own name, and anything else as unsaved.

The selection comes from the Start's read and the playing check's `/effects` read. It is kept in a new private table `nanoleaf_selections`, created if missing. An unchanged selection keeps its read time for up to a minute, so the once-per-second check does not republish the record every second.

### D5. Refusals name the selection

The refusal detail names the selection in the record's words: `saved scene scene-…`, a placeholder, or `a selection not saved on the light`. A scene name is never sent.

### D6. The card explains each case

Before Start, the card uses the last read selection, unless the base was put back after it was read. In that case, and before any read, it gives the general rule. During a session, and after its ending, it uses `musicBase` when the generation matches. An ending with restoration `none` over an unnamed base says that nothing was put back, and why.

## Risks / Trade-offs

- **Colour restoration is unqualified on the device.** The fake light and simulated controller follow the API documentation. AC4 on the installed Lines confirms that a colour written in one `/state` request shows again. Way back: revert this change; the table stays and is ignored.
- **The unnamed ending leaves streaming frames.** The light keeps the last frame until it times out or a scene is chosen, as a `device` or `restart` ending already does. This is the owner's chosen ending.
- **The record's selection can be old.** It is only as fresh as the last Start or playing check, and the record says when it was read.

## Migration Plan

No migration is needed. The table is created on start if missing, and a rollback leaves it unused. Queued Starts never survive a module start, so no journaled Start of the earlier shape runs. A session row from before this change still publishes its base as a scene.
