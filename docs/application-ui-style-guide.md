# B.U.N.N.Y. application UI style guide

Status: candidate for the owner's decision under
[Hub #181](https://github.com/jimmie-potts/agent-device-hub/issues/181).
The observed values below are source facts. The shared rules become binding
only when the owner accepts the revision that carries them; until then they are
proposals. Device exceptions stay with their owning repository either way.

Scope: the shared B.U.N.N.Y. application (the dashboard in `apps/dashboard`)
and the reusable UI foundation that future application pages adopt. The
Nanoleaf wall map keeps its own accepted visual decision. The cross-project
work guide and the system-design atlas are documentation, not application
screens; [Hub #85](https://github.com/jimmie-potts/agent-device-hub/issues/85)
gives them the same token vocabulary through `docs/skins/`, so the names mean
the same thing everywhere.

Verified source revisions for this revision of the guide:

| Source | Revision | What was read |
| --- | --- | --- |
| Hub `main` | `73166b2c6bc9b69a43650798684d73228483474d` | `apps/dashboard/src/style.css`, `apps/dashboard/src/main.tsx`, `apps/dashboard/src/client.ts`, `apps/dashboard/README.md`, `docs/architecture.md`, `docs/decisions/0004-local-first-personal-assistant.md` |
| Nanoleaf `main` | `9e2c41313de3c69c32b8ddf5259b30517c14588f` | `bridge/wall.html`, `docs/decisions/0004-wall-map-visual-direction.md` |

The documentation skin files `docs/skins/fixed.css` and
`docs/skins/neon-geometry-wars.css` are being delivered by Hub #85 and are not
on `main` at the revision above. Where this guide names them, it records the
agreed vocabulary and the current source values those files will carry, not an
existing file. Read the #85 delivery for their state.

The owner's draft of 2026-09-23 cited Hub `a76b22d` and Nanoleaf `2558df5`.
Those snapshots were inputs to this guide, not a claim about current source.
Section 13 lists the draft claims that current source contradicts.

Legend used throughout:

- **Observed**: a value or behavior read from the sources above, with its file.
- **Shared rule**: a convention for every B.U.N.N.Y. application page and skin.
- **Device exception**: a Nanoleaf or Pixoo behavior that stays device-specific
  and never becomes a generic component.

## 1. Name and spelling

- **Decision.** The shared application's user-facing name is **B.U.N.N.Y.**,
  selected by the owner on 2026-09-23 and recorded in
  [ADR 0004](decisions/0004-local-first-personal-assistant.md). The initials have
  no approved expansion, there is no logo, and no package name, path, service
  name or machine identifier changes because of the name.
- **Observed.** The dashboard shell currently renders the text `BUNNY` with a
  `◈` glyph and a `LOCAL INTEGRATION` sublabel (`apps/dashboard/src/main.tsx`),
  and status sentences such as "BUNNY can’t see the device" (`client.ts`).
  Repository documents use both spellings.
- **Shared rule.** New user-facing copy spells the name **B.U.N.N.Y.** Existing
  strings in the dashboard change only in their owning UI issue
  ([Hub #182](https://github.com/jimmie-potts/agent-device-hub/issues/182)),
  with the current candidate's approval. The older `BUNNY` spelling in the
  owner's draft and in current source is historical input, not a second name.
  Machine identifiers, package names and paths keep the unpunctuated form.

## 2. Sources of truth and precedence

| Concern | Owning source | Rule for an implementing agent |
| --- | --- | --- |
| Shared application shell and component pages | `apps/dashboard/src/main.tsx`, `style.css`, `README.md` | Extend the existing navigation and component views. Keep one shell across pages. |
| Application token layer | `apps/dashboard/src/style.css` `:root` custom properties | The future shared application seam (section 4). Today it holds `--muted`, `--edge`, `--panel` and `--accent`; Hub #182 widens it to the role names in section 4. |
| Nanoleaf wall map | `codex-nanoleaf/bridge/wall.html` and its [ADR 0004](https://github.com/jimmie-potts/codex-nanoleaf/blob/main/docs/decisions/0004-wall-map-visual-direction.md) | Preserve the wall material, status meaning and interaction distinctions. Wall-rendering tokens stay there. |
| Documentation skin | `docs/skins/fixed.css` and `docs/skins/neon-geometry-wars.css`, in delivery under Hub #85; today the values sit in `docs/work-guide/work/build_guide.py`, `work/guide_*.css` and `docs/system-design/assets/style.css` | The guide and atlas token files once #85 merges. Same role names, separate consumers. |
| Cross-project UI ownership | `docs/architecture.md`, "Unified UI and additional devices" | The shared frontend uses the approved Nanoleaf visual language; declared capability and permission decide which controls exist. |
| Behavior and validation | Each repository's `AGENTS.md`, app README and `docs/development.md` | Follow the owning repository's rules and checks for the page being changed. |

**Precedence when sources disagree.** Repository instructions and accepted
ADRs come first. An owner-approved UI candidate recorded on its PR comes next.
This guide's shared rules come after those, and the owner's draft, older
snapshots and this guide's observed tables come last, because they describe
rather than decide. When current source contradicts an observed value here,
the source is right and this guide needs a correction, not the source.

This guide grants no migration, installation or device-operation authority.
Until a source migration is delivered, the Nanoleaf repository remains the
wall map's source of truth.

## 3. Visual direction: Neon Geometry Wars

**Observed.** Nanoleaf ADR 0004 (accepted 2026-09-07, with the 2026-09-07
opening-assembly and 2026-09-09 Prism addenda) adopts a neon HUD: near-black
surfaces, a faint cyan grid, cyan accent and selection, magenta for pending
edits, Bahnschrift body text, Cascadia Mono readouts, translucent bordered
cards and a luminous wall. The dashboard carries the same language with a
quieter grid and no decorative motion (`style.css`: grid lines at
`rgba(34,211,238,.025)` against the wall map's `.055`).

**Shared rule.** The Nanoleaf wall map is the visual reference, and the
dashboard is the reference for adapting it to dense information and forms.
This direction is the **Neon Geometry Wars** skin, the initial and default skin
of the template in section 4. A page should read as a calm control surface:
grid as texture, cyan for the available primary action or the current
selection, magenta for a pending edit or attention that needs resolution, and
vivid physical-light colors reserved for actual device or task status. No glow
on every card, button or heading.

**Device exception.** Crystal tubes, hexagonal connectors, the two-second status
flow, the opening assembly and the `◈` glyph belong to their owning screens.
They are not generic components and no skin makes them mandatory.

## 4. Skin template

The template has three layers. Skins change only the third.

| Layer | Owns | Changes with a skin? |
| --- | --- | --- |
| Shared component and interaction rules (sections 6 to 9) | Shell structure, navigation, buttons, forms, panels, status cues, focus, pending, unavailable, stale, error and empty states, capability gating, reduced-motion behavior | No |
| Semantic roles (this section) | The names below and what each one means | No |
| Skin values, assets and decorative effects | Colors, typography, surfaces, artwork, glow, grid, opening and streak effects | Yes |

### 4.1 Semantic roles

Role names are shared with the documentation skin file that Hub #85 delivers
as `docs/skins/neon-geometry-wars.css`. Application code uses the same names, held in the application's own token
layer; there is no cross-repository CSS package.

| Role | Meaning | Neon Geometry Wars value (dark) | Dashboard today (`style.css`) |
| --- | --- | --- | --- |
| `--bg` | Page background, the darkest surface | `#05070d` | `#05070d` |
| `--panel` | Solid panel: sidebar, cards, menus | `#080c16` | `#080c16` (`--panel`) |
| `--panel-translucent` | Translucent panel over artwork or a canvas | `rgba(8,12,22,.82)` | not used |
| `--raised` | Hover or active fill | `rgba(34,211,238,.08)` | `#223048` (nav hover), `#103241` (selected) |
| `--inset` | Inputs, code, stage backgrounds | `#0d1420` | `#0d1420` (inputs) |
| `--text` | Body text and headings | `#d7e3ff` | `#d7e3ff` |
| `--muted` | Secondary text | `#7f93bd` | `#a6b4ca` (`--muted`, dense variant) |
| `--edge` | Quiet divider or card edge | `rgba(34,211,238,.2)` | `#34415a` (`--edge`, dense variant) |
| `--edge-strong` | Emphasized edge, selected outline | `rgba(34,211,238,.5)` | `#22d3ee` on the selected nav item |
| `--edge-faint` | Table row dividers | `rgba(34,211,238,.08)` | `#2a3549` (definition rows) |
| `--accent` | Primary action, selection, key readout | `#22d3ee` | `#22d3ee` (`--accent`) |
| `--accent-ink` | Text on an accent fill | `#04121a` | `#101724` (primary buttons) |
| `--link` | Inline links | `#22d3ee` | `#b6cdff` |
| `--focus` | Visible keyboard focus | `#ffffff` | `#fff` (final `outline-color` rule) |
| `--pending` | Pending edit or attention cue | `#e879f9` | `#e879f9` (`.switch`), `#f0abfc` (status text, `.warning`) |
| `--radius` | Corner radius | `2px` | `2px` |
| `--font` | UI face | `Bahnschrift, "Segoe UI", system-ui, sans-serif` | same |
| `--mono` | Readouts, labels, identifiers | `"Cascadia Mono", Consolas, ui-monospace, monospace` | `"Cascadia Mono", Consolas, monospace` |
| `--glow`, `--grid-image`, `--grid-size` | Decoration | skin-defined | grid only, `32px` |
| `--type-body`, `--type-small`, `--type-label` | Type scale | skin-defined | `1rem`, `.78rem`, `.68rem` |
| `--space-xs` to `--space-xl` | Spacing steps | skin-defined | raw pixel values |

The Neon column lists the application reference values, taken from the wall
map. The documentation skin file keeps its own dark values where long reading
text needs them (for example the guide's muted text `#93a6cc`); the role names
and meanings are the same.

**Dense-page variants.** The dashboard's lighter muted text (`#a6b4ca`) and
slate borders (`#34415a`) are deliberate variants for dense information and
forms. They are named `--muted-dense` and `--edge-dense` in the application
token layer. A page uses either the base pair or the dense pair, consistently,
and says which in its owning issue. Do not replace values on an already
approved screen without a reviewed candidate.

### 4.2 Fixed-meaning tokens that skins never override

| Token | Meaning | Value |
| --- | --- | --- |
| `--repo-hub`, `--repo-nanoleaf`, `--repo-pixoo` | Repository identity in documentation | cyan `#22d3ee`, magenta `#e879f9`, lime `#b5ed86` |
| `--status-open`, `--status-active`, `--status-blocked`, `--status-completed`, `--status-closed` | Issue status in documentation | `#a8bbd5`, `#f5ce83`, `#ffa3a6`, `#8ee0b6`, `#b9afce` today in `docs/work-guide/work/guide_reading.css`; #85 moves them to `docs/skins/fixed.css` |
| `--edge-observe`, `--edge-feed`, `--edge-command`, `--edge-other` | Diagram edge meaning | `#34d399`, `#a78bfa`, `#fb7185`, `#94a3b8` today in `docs/system-design/assets/style.css` (`.map-key`); #85 moves them to `docs/skins/fixed.css` |
| Nanoleaf `--wall-*` and `--chip-*` | Task status on the physical wall and its chips | working `#00ff00` / chip `#2bff63`, question `#ffff00` / `#ffe600`, blocked `#ff0000` / `#ff4a4a`, unread `#193cff` / `#5b9bff` (device exception, owned by `wall.html`) |

A fixed-meaning token may take a different shade per color scheme so it stays
readable, but no skin changes what it means or swaps two meanings.

### 4.3 What a skin may and may not change

A skin may change colors, typography, surfaces, artwork, glow, grid, opening
and streak effects, and print colors. A skin may not change capability or
permission gating, the definition of any state (selected, pending, unavailable,
stale, error, empty), task or project identity, physical device colors, layout
semantics, keyboard order, text cues, or which control is primary.

### 4.4 Adding a skin

1. Copy the skin file (`docs/skins/neon-geometry-wars.css` for documentation
   once Hub #85 delivers it; the application skin file that #182 introduces
   for the dashboard) to a new name and change values only. Every role in 4.1 needs a dark and a light
   value; the fixed set in 4.2 is not copied.
2. Scope decorative rules under the new `data-skin` value. Decoration is CSS
   only, sits on borders and artwork, never on text or meaning-carrying edges,
   respects `prefers-reduced-motion` and the pause control, and prints as
   nothing.
3. Run the owning checks: the token check rejects color literals outside the
   token files, and the browser checks verify motion off and readability.
4. Selecting a skin at runtime, saving that preference and a second shipped
   skin are deferred to a later issue. V1 ships Neon Geometry Wars only.

### 4.5 Ownership of the layers

- The application token layer in `apps/dashboard/src/style.css` is the future
  shared application seam. New application pages read tokens from it and add
  none of their own raw colors.
- Wall-rendering and device-specific tokens stay in the Nanoleaf domain
  (`wall.html` `@layer tokens`: canvas, halo, connector, pulse and chip values).
- Documentation tokens belong in `docs/skins/`, which Hub #85 delivers, and
  are consumed by the guide and the atlas generators.
- Pixoo keeps its media, player and display rendering.

## 5. Color

### 5.1 Observed values

| Role | Dashboard (`style.css`) | Wall map (`wall.html` `@layer tokens`) |
| --- | --- | --- |
| Page background | `#05070d` | `--bg: #05070d` |
| Solid panel | `#080c16` | `--panel-solid: #080c16`; header, rails and inspector use the translucent `--panel: rgba(8,12,22,.82)` |
| Primary text | `#d7e3ff` | `--text: #d7e3ff` |
| Muted text | `#a6b4ca` | `--muted: #7f93bd` |
| Accent | `#22d3ee` | `--accent: #22d3ee` |
| Text on accent | `#101724` | `--accent-ink: #04121a` |
| Pending | `#e879f9` (switch rule), `#f0abfc` (status text) | `--pending: #e879f9` |
| Focus | `#fff`, 3 px outline, 4 px offset | `--focus: #ffffff`, 2 px outline, 2 px offset |
| Border | `#34415a`; inputs and secondary buttons `#526482` | `--edge: rgba(34,211,238,.2)`, `--edge-strong: rgba(34,211,238,.5)` |
| Input surface | `#0d1420` | select on `--panel-solid` |
| Link | `#b6cdff` | accent |
| Grid | `rgba(34,211,238,.025)` lines, 32 px | `rgba(34,211,238,.055)` lines, 32 px, plus vignette and scanlines on the canvas |

Hover and secondary values in the dashboard: primary hover `#67e8f9`;
secondary button text `#c7d8fc`, border `#526482`, hover `#1a2a3d` /
`#f2f6ff` / `#7b93b8`; labels `#bac8de`; badge `#c6d8f9` on `#1b2940` with a
`#476086` edge; warning badge `#28172e` with a `#9f5baa` edge; stats gradient
`#0d202b` to `#100d22`; notice rule `#5977a7`; empty state dashed `#40516b`.

### 5.2 Shared rules

- Use role names in new code. Raw values live only in a skin file.
- Start a new page from the base pair (`--muted`, `--edge`). Use the dense
  pair only for dense information and forms, consistently, and record why.
- Keep dashboard grid texture at or below its current strength. The fuller
  treatment (vignette, scanlines) belongs to the wall canvas.
- Cyan means an available primary action or the current selection. Magenta
  means a pending edit or attention that needs resolution. Neither implies a
  successful physical result.
- Device and task status colors are semantic, come with a text cue, and are not
  decoration. Green never means "the command reached the lights" unless that
  result was observed.

### 5.3 Contrast

Ratios are computed from the hex values with the WCAG 2.x relative-luminance
formula; the owner can recompute them with any contrast tool. They validate the
opaque pairs listed and nothing else: translucent panels, hover states, image
overlays and user-chosen project colors must be checked in the rendered page.
The AA minimum is 4.5:1 for ordinary text and 3:1 for large text and UI
component boundaries.

| Pair | Ratio | Use and verdict |
| --- | --- | --- |
| `#d7e3ff` text on `#05070d` | 15.65:1 | Body text, passes AA |
| `#7f93bd` wall muted on `#05070d` | 6.53:1 | Secondary text, passes AA |
| `#a6b4ca` dashboard muted on `#05070d` | 9.59:1 | Dense-page secondary text, passes AA |
| `#a6b4ca` on `#080c16` panel | 9.31:1 | Secondary text on a solid panel, passes AA |
| `#22d3ee` accent on `#05070d` | 11.14:1 | Accent text and readouts, passes AA |
| `#04121a` on `#22d3ee` | 10.50:1 | Wall map text on a cyan fill, passes AA |
| `#101724` on `#22d3ee` | 9.93:1 | Dashboard primary button text, passes AA |
| `#e879f9` pending on `#05070d` | 8.18:1 | Pending cue as text, passes AA |
| `#f0abfc` status text on `#05070d` | 11.45:1 | Dashboard status sentences, passes AA |
| `#ffffff` focus on `#05070d` | 20.14:1 | Focus outline, passes the 3:1 component minimum |
| `#b6cdff` link on `#05070d` | 12.63:1 | Dashboard links, passes AA |
| `#bac8de` label on `#05070d` | 11.90:1 | Form labels, passes AA |
| `#bdc9df` nav text on `#080c16` | 11.71:1 | Navigation items, passes AA |
| `#c6d8f9` on `#1b2940` | 10.15:1 | Badge text, passes AA |
| `#2bff63`, `#ffe600`, `#ff4a4a`, `#5b9bff` chips on `#05070d` | 14.95, 15.89, 6.07, 7.27 | Task status chips, all pass AA; the text label still carries the meaning |
| `#0e7490` on `#ffffff` and on `#f3f7fb` | 5.36:1, 4.98:1 | Light-scheme accent text, passes AA |
| `#a21caf` on `#ffffff` | 6.32:1 | Light-scheme pending text, passes AA |
| `#10202e` on `#f3f7fb` | 15.38:1 | Light-scheme body text, passes AA |
| `#4a5b6e` on `#ffffff` and on `#f3f7fb` | 6.97:1, 6.48:1 | Light-scheme secondary text, passes AA |
| `#145565`, `#7b2c8a`, `#1b6872` on `#ffffff` | 8.34, 8.17, 6.42 | Existing print palette, passes AA |
| `#22d3ee` and `#e879f9` on `#ffffff` | 1.81:1, 2.46:1 | Fail. A light scheme must not use the dark-scheme cyan or magenta as text on white; it uses the darker shades above |

## 6. Typography and hierarchy

**Observed.**

| Role | Dashboard | Wall map |
| --- | --- | --- |
| Body and headings | `Bahnschrift, "Segoe UI", system-ui, sans-serif` | same (`--font-ui`, `--font-head`) |
| Technical labels and readouts | `"Cascadia Mono", Consolas, monospace` on `.top`, `.eyebrow`, `.brand small`, `.nav-label` | `"Cascadia Mono", Consolas, ui-monospace, monospace` (`--font-num`) for labels, numbers and the brand |
| Body size | browser default (`1rem`), paragraphs at line-height `1.6` | `14px / 1.45` |
| Labels | `.68rem`, letter-spacing `.17em`, weight 650 | `10.5px`, uppercase, `.14em`; brand `.18em` |
| Page heading | `clamp(2rem, 3.8vw, 3.2rem)`, weight 550, line-height 1.12, letter-spacing `-.045em` | `600 14px/1.3` section headings |
| Section heading | `1.7rem`, `-.025em`; compact card headings `1rem` | |

**Shared rule.** One page title with a short explanation, section headings for
groups, compact card headings, then subdued labels and metadata. Mono for short
system labels, identifiers, timestamps and numbers; prose in the UI face; no
long text in uppercase or mono.

**Device exception.** The wall map's server sends a Content-Security-Policy
that allows no web or data-URI fonts, so it uses the local Windows and Linux
fallbacks. The dashboard uses the same family without a remote font, so visual
consistency needs no web font anywhere.

## 7. Shape, space and composition

**Observed.**

- Shape: 2 px radius on buttons, fields, cards and badges in both apps; flat
  surfaces separated by 1 px borders; the wall map's selected cards add cyan
  corner brackets (`.card.selection::before/after`).
- Dashboard shell: `232px` sidebar and a main column with `max-width: 1500px`
  and `42px` side padding; session cards `24px` padding with `20px` gaps. At
  `900px` the sidebar narrows to `180px` and main padding to `22px`. At `680px`
  the shell becomes a single column, navigation becomes a wrapping row, dense
  forms and definition lists become one column, and main padding is `18px`.
- Wall map: on wide screens a three-column grid of `240px` projects rail,
  `minmax(320px, 1fr)` canvas and `440px` inspector; cards use `14px` padding
  and `12px` gaps. Below `1050px` (`max-width: 1049.98px`) the inspector
  moves below the canvas. At `680px` the three regions stack, with the
  projects rail second and the inspector third. Between `1050px` and `1500px`
  the toolbar hides its captions for sighted users only.

**Shared rule.** Keep a stable shell, consistent left alignment, clear groups
and room around the main content. Use the dashboard's quieter spacing for
forms and data; keep the wall map's denser composition where the live wall
needs the area. Do not force one page's column widths onto the other.

## 8. Components and states

| Component | Observed pattern | Shared rule |
| --- | --- | --- |
| Primary button | Cyan fill, dark text, weight 650, 2 px radius; hover `#67e8f9`; disabled at `.52` opacity (`style.css`). The wall map's Assign action has the same role. | One primary action per decision group, labelled with the action's verb. |
| Secondary button | Transparent surface, pale text, slate border. | Inspection, cancel, alternate and low-priority actions. |
| Selected navigation | `aria-current="page"` on the nav button with a cyan border, an inset cyan bar and a filled background (`main.tsx`, `style.css`). | Mark the current location with `aria-current`. Selection stays visible without animation. |
| Pending | Dashboard: status text in magenta while a command is queued; the mode switch block has a magenta left rule. Wall map: dashed magenta outline on pending Lines and the busy notice. | Say what is pending in text. The same cue never means success, failure or focus. |
| Card or panel | Dark surface, thin border, compact heading, supporting text; definition lists with muted labels. | Related facts and controls together. Glow only for an active selection. |
| Form field | Dark input, pale text, visible label, white focus outline. | Labels stay visible; show the current or unknown value honestly; keep drafts and selection across a refresh. |
| Badge or status | Text plus a small colored cue (`.badge`, `.badge.warning`); feed state reads "Feed connected", "Reconnecting" or "Connection stale". | Status in words, not color alone. Attention, stale observation and pending command stay distinct. |
| Unavailable control | The control renders disabled with a named reason: "Unavailable: Power is not declared by this controller", "Settings unavailable: this component has no supported integration extension". | Explain what is absent or why. Missing data never implies a broken device. |
| Uncertain result | "Result unknown: this may have reached the device (…). Check the device, then reload current values before trying again." The group locks until an explicit reload. | Keep the lock and the reload button; never retry automatically. |
| Error | Typed rejections read "Not applied: … Nothing changed."; a controller that cannot be read shows "controller-unavailable. Last evidence is retained. Other components remain independent." | Name the cause; keep other components usable. |
| Empty | Dashed border and an explanation ("No matching sessions"). | Explain what is absent. |

**Observed behavior to preserve when restyling.** A control may be unavailable
because of capability, scope, mode, stale evidence or another owner, and the
UI explains which. A submitted control keeps or restores focus, uncertain
actions stay locked until an explicit reload, and reads issue no device
commands (`apps/dashboard/README.md`). The wall map keeps selection,
Work/Quiet/Free meaning and pending edits distinct.

Rendered examples of these states at 1440 px and 390 px were captured for the
Hub #181 delivery from the fake-controller fixture, so they show no physical
result. They are kept outside Git under `.local/evidence/gh-181-ui-foundation/`
in the owner's checkout; the delivery PR lists the frames, and the owner
reviews them directly.

## 9. Accessibility, motion and responsiveness

**Observed.** Both UIs honor `prefers-reduced-motion`: the dashboard removes
every animation and transition; the wall map stops its wall animations while
keeping Work, Quiet and Free distinguishable. Focus is a white outline in both.

**Shared rules and inspection checklist.**

- Every status has a text or icon cue in addition to color.
- Keyboard focus is visible on every interactive element; tab order follows
  reading order; a modal returns focus to its opener.
- Body text meets 4.5:1 on its actual rendered surface. Check translucent
  panels, hover states and overlays in the browser, not from the token table.
- Selection (cyan), pending (magenta) and device or task status (physical
  hues) stay visually and textually distinct in every skin.
- Under reduced motion or the pause control, decorative motion stops and no
  meaning is lost; skins may not encode a state in motion alone.
- Check wide desktop, the widths near each layout change and a 390 px phone:
  no horizontal overflow, no clipped controls, long labels wrap.
- Small, short transitions only where they clarify state; the dashboard stays
  still by default.

## 10. Brand and imagery

**Observed.** The dashboard shell shows the `◈` glyph, the `BUNNY` wordmark and
`LOCAL INTEGRATION`; the login page reads "BUNNY / LOCAL INTEGRATION". The wall
map reads "Codex × Nanoleaf" and "Wall map". The wall visualization, drawn as
inline SVG by the Prism material scripts (with reference exports under
`bridge/assets/prism/`, not a served route), is Nanoleaf's imagery. No shared
finished logo exists.

**Shared rule.** The text wordmark and glyph are the interim mark of the
shared shell; a dedicated logo needs its own asset and design decision. Identify
Nanoleaf inside its component view or advanced editor, and keep the wall map's
own title while it remains a separate application. Do not copy the `◈` glyph
onto every device screen.

## 11. Component glossary

The 2026-09-24 architecture discussion proposed animal-body terms for the parts
of B.U.N.N.Y. The dispositions below are the coordinator's proposal for the
owner's decision; the owner's answer on the delivery PR is the record. Every
term maps to an existing responsibility in `docs/architecture.md`; none changes
ownership, renames a package, path or API identifier, or adds a UI label. Using
an accepted term in UI copy belongs to the owning UI issue.

| Term | Proposed disposition | Plain meaning | Technical responsibility | Owner | Intended use |
| --- | --- | --- | --- | --- | --- |
| Brain | Accept | What B.U.N.N.Y. knows: the one place that decides what each agent session is doing | The shared agent-state core: reducer, immutable snapshots, consumer queues, export and import | `packages/agent-state`, hosted by `apps/hub` (standalone) or by Pixoo's embedded owner during migration | Documentation and atlas labels for the state owner; a future dashboard label for the active owner |
| Ears | Accept | What B.U.N.N.Y. hears from agents | Provider observation: the fail-open lifecycle hooks and emitters, and the Codex Desktop read-state reader | `packages/agent-state/src/providers.ts`, `packages/agent-state/bin/hook.mjs`, the hub's Desktop reader | Documentation; provider qualification records |
| Eyes | Accept, provisional | What B.U.N.N.Y. last saw of a device | Device observation read back through the controller contract: snapshots, observation age, last outcome, external control | Each controller's snapshot route; the hub reads, never infers | Documentation now; a candidate label for freshness in the dashboard once #182 shows it. Revisit if the word confuses observation with display |
| Nerves | Accept | How a request reaches a device | The controller contract and hub command routing: request tickets, configuration revisions, generations, per-device queues, typed outcomes | `packages/contracts`, `apps/hub` controller client; MCP tools and the Face are its clients | Documentation and atlas labels; never a UI control name |
| Paws | Accept | What actually touches each device | The designated physical writer per device | Nanoleaf's Python worker, Pixoo's serialized writer and player, Tidbyt's display writer, LIFX's per-bulb queues | Documentation; the rule "one Paw per device" restates one writer per physical device |
| Face | Accept | Where the owner meets B.U.N.N.Y. | The central UI: `apps/dashboard` activity, component and connection views, plus the launcher-opened session | `apps/dashboard`, served by `apps/hub` | Documentation; the shell's own name in future copy |
| Burrow | Accept | Where B.U.N.N.Y. lives | The local installation: the standalone hub service, its private store and configuration on the Linux filesystem, loopback ports, credentials outside Git | `apps/hub` setup and installation records | Documentation and setup guides |
| Glow | Defer | The lights and displays B.U.N.N.Y. drives | Would name the physical outputs as a category | Each device keeps its product name | Deferred because "glow" already names a decorative effect in this skin vocabulary; using it for hardware would blur the two. Revisit if a shared outputs label is needed in the Face |

Rule for future integrations: a new device keeps its product name for its
output, gets exactly one Paw (designated writer), reports through the Eyes
(observed state and freshness), receives commands through the Nerves, and joins
the Face's component navigation with declared capabilities. No new animal term
is added per device. State interpretation (Brain), device-specific rendering
(the device's own renderer) and the designated writer (Paw) stay distinct.

## 12. New-page checklist and handoff

An implementing agent uses this guide with a specific UI issue:

1. Read the current `AGENTS.md`, the app README and the sources in section 2.
   Confirm their revisions and look for a newer UI decision or approval.
2. Keep observed facts, shared rules and device exceptions distinct. A
   departure from the selected direction needs a new design decision, not a
   quiet override.
3. Inventory the page's colors, type, spacing and components. Map repeated raw
   values to the role names in section 4 without changing any status meaning.
   Keep Nanoleaf wall-rendering tokens local to the wall map.
4. Implement in the owning application. Extend the dashboard's navigation and
   control patterns; do not migrate Nanoleaf source or alter controller
   behavior as part of a styling task.
5. Compare wide and narrow screenshots with the reference. Inspect normal,
   hover, focus, selected, pending, disabled or unavailable, stale, uncertain,
   error and empty states, with long labels and small screens.
6. Run the owning repository's UI checks (dashboard and browser checks here;
   Python and browser checks for the wall map) and record which ran.
7. Obtain the current candidate's human UI approval before merging any
   application UI change. An earlier approval of another page or revision does
   not cover a changed candidate.

Acceptance checklist for each new or restyled page:

- [ ] Uses the shared shell and the page's local identity; no invented logo.
- [ ] Uses role tokens, the font stacks and the 2 px shape language; no raw
      colors outside the skin file.
- [ ] Has one clear title, a section hierarchy, readable body text and visible
      field labels.
- [ ] Coherent at desktop, intermediate and 390 px widths without clipped
      controls or horizontal overflow.
- [ ] Shows keyboard focus and states selected, pending, unavailable, stale,
      uncertain, error and empty in text as well as color.
- [ ] Preserves meaning under reduced motion and the pause control.
- [ ] Keeps inspection separate from commands and preserves capability and
      permission gating.
- [ ] Includes current-candidate screenshots or browser evidence and the
      required human UI approval before merge.

A new design decision is required when a page needs a role that section 4
does not define, a state the shared rules do not cover, a second skin, a logo,
a change to a fixed-meaning token, or a departure from the dense-page variant
rule on an approved screen.

## 13. Draft corrections and change triggers

Draft claims that current source contradicts:

| Draft claim | Current source | Correction |
| --- | --- | --- |
| Wall map columns: 264 px projects rail, flexible canvas, 320 px inspector | `wall.html` `main{grid-template-columns:240px minmax(320px,1fr) 440px}` | 240 px rail, `minmax(320px, 1fr)` canvas, 440 px inspector (section 7) |
| Inspector moves "below about 1050 px" | `@media (max-width: 1049.98px)`; a separate `1050px` to `1499.98px` rule hides toolbar captions | Exact breakpoints recorded in section 7 |
| "Local Prism SVG assets" are the Nanoleaf imagery | The wall is drawn as inline SVG by `bridge/prism.js`; `bridge/assets/prism/*.svg` are reference exports, not a served route | Section 10 names the inline material and its reference exports |
| ADR 0004 records the name as undecided | True at the draft's snapshot; this delivery amends the ADR | Section 1 and the amended ADR |
| Token starter uses `--ui-` prefixed names | The wall map uses unprefixed role names, and Hub #85 adopts the same for `docs/skins/` | Section 4 adopts the unprefixed names so all three consumers match |
| Snapshots Hub `a76b22d` and Nanoleaf `2558df5` | Hub gained the accepted-tone status color rule (`data-tone="accepted"`); Nanoleaf reduced the default wall map controls and repeated status text (commit `49f0425`) | Every other cited value reproduces at the verified revisions |

Change triggers:

- The Nanoleaf values are the default for new pages. Restyling the existing
  dashboard to match them exactly requires a reviewed UI candidate (#182).
- The `BUNNY` text and `◈` glyph are the interim mark; a dedicated logo needs a
  separate asset and decision.
- If the Nanoleaf source moves into the Hub, review the resulting page in its
  new shell; the move does not approve changes to the wall visualization or
  its status meaning.
- A second skin, a skin picker and saved skin preferences are deferred to a
  later issue.
