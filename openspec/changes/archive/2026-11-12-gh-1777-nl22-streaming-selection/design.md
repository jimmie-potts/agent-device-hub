## Context

A live session (`modules/nanoleaf/src/music-session.ts`, #1272) asks one question in two places: does the light still show our stream? The once-a-second playing check asks it with `GET /effects`, then `GET /state` when the selection matches. The restoration guard (`restoreMusicBase` in `music-base.ts`) asks it the same way before each write. Both compared the selection with one constant, `*ExtControl*`, which #1598 observed on the installed Lines. #1272's design D1 already made the entry, port and datagram per kind (`StreamProtocol`); this selection was the one value left shared. See proposal.md for the failure it caused on the NL22.

## Protocol qualification (#41 AC3, revisited)

Sources relied on, read on 2026-11-12, with no device contacted:

1. **Nanoleaf, "Nanoleaf Light Panels Open API Documentation"**, Confluence page 2789310530 in space `nlapid`, read through its REST content view (`/wiki/rest/api/content/2789310530?expand=body.storage`). Sections used: 3.2.4 (effect commands: add, delete, request, requestAll, rename, display, displayTemp), 3.2.5 "Reserved Effect Names", 3.2.6 "Effect Types" with 3.2.6.2 "External Control (extControl)", 3.4 "Brightness", 3.5 "Events", 5.2 "Get All Panel Info", 5.3 "State", 5.4 "Effects" and 5.7 "External Control (Streaming)". This is the same primary source #1272 used.
2. **The observation on the installed NL22** recorded in #1777 (2026-11-12, owner present). It is evidence about the device, not documentation.
3. **The module's own code**: `stream.ts`, `music-session.ts`, `music-base.ts`, `scenes.ts`, `worker.ts`, `module/simulated.ts`.

What the documentation says:

- 3.2.5 reserves exactly three names "for indicating certain Panels modes": `*Static*` (panels hold static colours the user defined), `*Dynamic*` ("Temporary Dynamic Effect defined by user") and `*Solid*` (user-defined through Universal Color). `*ExtControl*` is not listed anywhere on the page.
- 3.2.6.2 and 5.7: external control is entered with a `display` write whose `animType` is `extControl`, and 3.2.6.2 says the mode "can only be activated in display mode". 3.2.4.6 describes `display` as a temporary display that is not saved as an effect. No section says what `GET /effects/select` or `GET /effects` returns while streaming.
- 5.4.1 `GET /effects/select` returns the selected name (example `*Solid*`). 5.4.2 lists the saved effects. 5.2's sample NL22 answer has `effects.select` and `effects.effectsList`, and `state` with `on`, `brightness`, `hue`, `sat`, `ct` and `colorMode` (`effect` in the sample). No documented GET returns an animation type, a streaming flag or anything else that names the mode the selection came from.
- 3.2.4.3 and 5.4.3: the animation type is readable only through `PUT /effects` with `{"write": {"command": "request", "animName": <name>}}`, documented for a named, saved effect. The page does not say what it returns for a reserved name such as `*Dynamic*`, or for the streaming mode. 3.2.4.4 `requestAll` returns the saved effects only.
- 3.5: `GET /events?id=…` keeps a connection open and sends Server-Sent Events. Effects events (id 3) are "sent out whenever the attributes covered under the /effects endpoint changes", with the selected name as the value. The page does not say whether a new pick with the same name sends an event.
- 5.7 says the Light Panels support stream control versions 1 and 2, with no firmware bound and with the answer body given only for version 1 ("Light Panels: { streamControlIpAddr … }"). Separately, 3.2.6.2 says the Light Panels use stream control version 1. Nothing says what a version 2 NL22 reports as its selection.

| Point | Lines (NL59) | NL22 Light Panels | Status |
|---|---|---|---|
| Selection while streaming | `*ExtControl*` | `*Dynamic*` | **Observed** on both installed lights: Lines #1598, NL22 #1777 (two sessions, both checks). Not documented for either. For the NL22 it is consistent with 3.2.5, since external control is entered by a temporary `display` write. |
| Selection of an unsaved dynamic effect | `*Dynamic*` | `*Dynamic*` | **Documented** (3.2.5). On the NL22 this is the same name as streaming. |
| Selection of an unsaved static display | `*Static*` | `*Static*` | **Documented** (3.2.5). |
| Selection of a plain colour | `*Solid*` | `*Solid*` | **Documented** (3.2.5, 5.4.1). |
| Selection of a saved scene | Its name | Its name | **Documented** (5.4.1, 5.4.2). |
| A GET that tells streaming from an unsaved dynamic effect | Not needed | None | **Documented absence.** `/effects`, `/effects/select`, `/state` and `GET /` name no mode or animation type. |
| `request` for the current effect's type | Not needed | A `PUT /effects` write, documented for saved names only | **Documented** as a write command; its answer for `*Dynamic*` or streaming is not documented. |
| Effects event on a same-name pick | Not needed | Unknown | **Not documented.** It would also need a new long-lived connection outside the device link's queue. |
| App scene leaves streaming | Yes | Yes | **Observed:** Lines #1598; NL22 #1777 (a scene picked in the app after the session ended appeared and stayed). |
| Datagrams ignored after an app pick | Yes for a scene | **Unknown** | **Observed on the Lines only**, for a scene (#1598). On the NL22 no app pick during a session has been observed. A pick the selection shows ends the session within about a second either way; after an unseen `*Dynamic*` pick the frames continue, so whether they paint over it is an installed-check step. |
| Colour state (`/state` `colorMode`, hue, sat, ct) while streaming | Not needed | **Unknown** | Not documented for streaming. Shown on the record as a read-only diagnostic (D8). |
| An unsaved app effect before the Start | Not observed | Read `*Static*` while the app showed "Dynamic" | **Observed** once (#1777). It suggests the app's own "Dynamic" label need not mean the `*Dynamic*` name, but one reading settles nothing. |
| Brightness and power while streaming | Unchanged | **Assumed** unchanged | The NL22 sessions ended at the first check before a brightness comparison mattered. |
| Restoration from streaming | Qualified on the Lines | **Assumed** | Not yet exercised on the NL22. |
| Version 2 on the NL22 | Not applicable | Documented as supported, without a selection or firmware bound | **Not used.** The module keeps version 1, which the NL22 accepted. |

## Goals / Non-Goals

**Goals:**
- A Panels session keeps playing while the light reports what the installed NL22 reports while streaming.
- Every place that asks "is our stream still showing" takes its light's own value from the stream protocol.
- A manual change that the selection can show still wins on both lights, and the case it cannot show is named, tested and returned to the owner.

**Non-Goals:**
- A new device request, a probing write, a new connection or a version change on either light.
- Changing the scene restorer (`scenes.ts`), which the recorded Python parity fixtures pin.
- Qualifying the NL22's physical behaviour (#1777 installed check, #725).

## Decisions

### D1. The streaming selection belongs to the stream protocol

`StreamProtocol` gains `streaming`: `*ExtControl*` for version 2 on the Lines and `*Dynamic*` for version 1 on the NL22. `playMusic` takes `shown` from the frozen layout's protocol, the same object that already supplies the entry, port and packet. The playing check and `restoreMusicBase` use `shown` unchanged. *Alternative:* accept both `*ExtControl*` and `*Dynamic*` on every light. Rejected: on the Lines `*Dynamic*` is only ever a manual effect, so accepting it there would weaken a check that works.

### D2. Manual change on the Panels: selection only, and the limit stated

On the NL22, a saved scene, `*Solid*` or `*Static*` is a manual change, and so are a changed brightness and the power off, as before. The NL22's own stream reports `*Dynamic*`, and so does anything else that reports `*Dynamic*`. The documentation offers no GET that separates them (see the table). So anything that leaves the NL22 on `*Dynamic*`, with brightness and power unchanged, is not seen:

- an unsaved dynamic effect picked in the Nanoleaf app;
- a scene, palette or effect that the app or an integration plays with a temporary `display` write rather than selecting a listed name, which to the owner can look like picking a scene (#1777 recorded the app's label not matching the API name);
- another external-control client that starts streaming to the Panels mid-session. Its frames and this session's may interleave on the same port, so this case is not one of frames being ignored. On the Lines, another client streaming with `*ExtControl*` is the existing equivalent.

The session keeps sending frames. The light ignoring datagrams after an app choice is observed on the Lines only (#1598); no app choice during an NL22 session has been observed. If the NL22 still applies frames after an unseen choice, they keep painting over it. The only bounds are Stop, an alert, source loss, a hub choice, a brightness or power change, or a module stop. The installed check therefore includes "an app dynamic effect picked during a Panels session: does it stay, or do the frames paint over it?".

The owner's options, also listed in the README and the PR:

1. Accept the limit as it stands.
2. Restore only on an explicit Stop on the Panels, not on an alert or source loss. This departs from #40's rule that an alert and source loss restore, and it narrows the limit without removing it.
3. Once a second, send `PUT /effects` with `{"write": {"command": "request", "animName": "*Dynamic*"}}` through the device link. It is a write-method command, its answer for a reserved name or for streaming is undocumented, and its effect on the stream is unknown.
4. Subscribe to effects events with `GET /events?id=3`. This is a long-lived connection outside the device link's queue, and the documentation does not say whether a pick with the same name sends an event.
5. Read the colour-state diagnostic (D8) during the installed check, which adds no request, and decide from that evidence whether the NL22's colour state tells its stream from an app choice.

None of options 2 to 4 is implemented here.

### D3. The restoration guard keeps the owner's policy

With the selection alone, the restoration guard after Stop, an alert or source loss finds `*Dynamic*`, an unchanged brightness and the power on. In the cases of D2 it then writes the scene or colour base over the unseen choice; tests name this limit on Stop, alert and source loss, over a scene and a colour base. One conservative alternative was considered: on the Panels, never restore when the only evidence is `*Dynamic*`. That evidence is all the Panels ever give, so Stop, an alert and source loss would never restore on the NL22. That contradicts the standing owner decision that those endings put the base back (#40 decision table, #1614) and the acceptance this change must keep. No other request-free signal separates the cases. `/state`'s `colorMode` is `effect` for an effect, and nothing documents a different value while streaming, so it cannot be relied on blind. D8 makes it visible as a diagnostic. Option 2 of D2 is the narrower variant of this alternative. So the guard is unchanged, and the limit is stated in the README, the spec and the Audio card.

### D4. A leftover NL22 stream at the next Start

`selectionRead` already classifies `*Dynamic*` as not saved and not a colour. The next Start therefore takes a leftover NL22 stream as an unnamed base with `restores: nothing`, and its record placeholder is `*Dynamic*`. The session plays on it, and its endings write nothing, as #1614 decided for every unnamed base. The Audio card's words for `*Dynamic*` now add "or, on the Light Panels, streamed frames such as those an earlier Music session left".

### D5. The simulated controllers model the observed selection

The simulated Panels report `*Dynamic*` while streaming. Whether a datagram applies now depends only on the controller's streaming state, which only the entry sets and every scene, colour or effect choice clears. Before, it also required the `*ExtControl*` selection, which on the Panels cannot tell streaming from an app effect. New app actions, `chooseColor` and `chooseEffect`, pick a colour or an unsaved static or dynamic effect as the Nanoleaf app would, and record `manualAtMs`. The Lines' simulated behaviour is the same as before.

### D6. Events, errors and logs (ADR 0012)

No message format, error shape, log event or polling path is added. The only record change is D8's optional fields on the module-owned `nanoleaf-wall` record's existing `selection` object. The session's device requests are the same: the entry write, one `/effects` read once a second, a `/state` read while the selection matches, and the guarded restoration reads and writes. Records still carry no scene name, address, port or token.

### D7. The scene restorer is unchanged

When a session takes the light, the worker marks it as the module's own presentation (`taken`): the restorer holds it as its own, with the last selection `*Dynamic*`. Several endings leave the last frame streaming with nothing written:

- `device` and `restart` endings, and a module stop;
- a Stop, alert or source loss over an unnamed base;
- a brightness or power `manual` ending;
- a skipped restoration.

After any of them, a later mode command that makes a new revision runs a pass, for example one that clears a power or brightness override. A plain Free-to-Free command writes nothing. That pass reads the selection and finds it unlisted. It writes power on, the brightness and the remembered scene, journaled under the mode command. With no remembered scene, or one no longer listed, it draws the fallback colour instead. The restorer exempts only `*ExtControl*` in Free, as someone else's choice. That covers a leftover Lines stream but not the NL22's `*Dynamic*`. On both lights the same applies to any unlisted selection the owner picks after a session.

This change does not make a leftover stream more likely. It newly lets an NL22 ending restore a colour, which leaves `*Solid*`, an unlisted selection, as on the Lines. The README states this. Changing the restorer would alter recorded parity behaviour and is not needed for this fix. It is returned for a separate issue.

### D8. A read-only colour-state diagnostic

The Start's base read already reads `GET /state`, and the playing check reads it once a second while the light reports its streaming value. What that read showed of the light's colour is now kept with the selection read beside it, on the module-owned `nanoleaf-wall` record's existing `selection` object, for both lights alike. These optional fields are `colorMode` (the light's own word, or `null` when absent or not a short plain word) and the whole `hue` (0 to 360), `sat` (0 to 100) and `ct` (0 to 65535) the light reports. The schema stays closed with the new fields optional.

They are stored in a new table, `nanoleaf_selection_colors`, keyed by device and the selection's read time. They are not new columns of `nanoleaf_selections`, because an older module inserts five positional values there and would fail on a sixth column. An older module ignores the new table. A colour row counts only beside the selection row of the same read time, so a stale one never shows. A selection read without a `/state` read beside it, such as a playing check that found another selection, keeps no colour state. The refresh follows the selection's once-a-minute rule, with one distinction (review R4). A changed `colorMode` is kept and published at once, as a changed selection is, because that is the signal worth seeing promptly. A change of only `hue`, `sat` or `ct` waits for the same one-minute refresh as an unchanged selection's read time. Otherwise a light whose numbers move between the once-a-second reads while it streams would rewrite the store and republish `nanoleaf-wall` every second, about one history row a second for the whole session. The published numbers may therefore be up to a minute old.

No request is added, nothing written to a light changes, and no session ends, guards or restores on these values. Whether the NL22's colour state tells its own stream from an app choice is unknown, and using it blind could end sessions early. The installed check reads it to inform option 5 of D2.

## Risks / Trade-offs

- **[Anything that leaves the NL22 on `*Dynamic*` during a session]** → It is not seen. Frames keep going. If the NL22 still applies them, or another client's frames interleave with them, they paint over the choice until Stop, an alert, source loss, a hub choice, a brightness or power change or a module stop. A later Stop, alert or source loss restores the base over it. This is stated in the README, the spec and the Audio card, and is pending the owner's decision (D2).
- **[A colour-state diagnostic that misleads]** → It decides nothing, and the installed check interprets it.
- **[The NL22 reports something else in another firmware or mode]** → Any other selection ends the session `manual` with no write, the same safe failure #1777 saw.
- **[Brightness or power behave differently while the NL22 streams]** → A change shows as `manual` with no write. The installed check under #1777 covers it.
- **[Restoration from streaming on the NL22]** → The guarded writes are unchanged and journaled. A lost answer is `uncertain` and never retried; the installed check qualifies it.

## Migration Plan

One additive store change: `nanoleaf_selection_colors` is created if absent. An older module ignores it, and reverting leaves a harmless unused table. No configuration changes. A session admitted before the upgrade cannot survive the module restart that installs it: it ends `restart` with no write. The way back is to revert the source change. Installed state needs no change, and reverting brings back the one-second ending, which writes nothing.
