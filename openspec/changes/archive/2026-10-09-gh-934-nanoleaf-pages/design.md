## Context

See [proposal.md](proposal.md) for the outcome. The implementation base contains the accepted SDK API 1.3 frontend contract, a React shell and Pixoo's use of its authenticated API and shared Command component. Nanoleaf already owns wall edits, one device writer, saved geometry and the `nanoleaf-wall`/`device` read models. Its manifest still uses API 1.1 and declares no page.

The source editor at codex-nanoleaf `c711e1812d6871952562e9070e20bdebe120db3a` is an imperative controller in `bridge/wall.html`, with the request-free Prism renderer and two helpers. Its server mixes reads with geometry discovery and metadata refresh. This port reuses the editor and renderer, while reads come from the existing runtime owner. The planning configuration's older Python/embedded-core prose is superseded by ADR 0012 and the accepted React direction.

Design is required by the schema: this change crosses the browser/module boundary and adapts authentication, command outcomes and editor lifecycle.

## Goals / Non-Goals

**Goals:** retain the current editor interactions and artwork; make shell navigation and authentication authoritative; keep cached state honest across disconnects; preserve the one Nanoleaf writer and machine-edit ownership.

**Non-Goals:** a full React wall feature module, a generic editor host or iframe bridge, another connection, geometric discovery or enrollment, legacy import, new scene-restoration commands, animation tools, a new scheduler, and new performance, pilot or soak infrastructure. Installed and physical checks remain separate from this source delivery.

## Decisions

### Small React host, retained imperative editor

Declare `{id: 'wall', title: 'Wall', presentation: 'react'}` under API 1.3 and export a browser-only `frontend` contribution. The host consumes `FrontendContext` and mounts a module-local `mountWall(root, ports)` adapter. The adapter returns `update(view, editable)` and `dispose()`; callbacks use the shell API and shared `context.ui.Command`. React owns connection and command lifetime, while the reused editor owns its DOM, selection and Prism animation.

The coordinator selected this routine integration within the owner's React default and existing-editor migration allowance. A separately scripted frame would need another connection or parent messaging to receive tracking; a full React rewrite would add work explicitly deferred to #761. Neither is needed here. No SDK, gateway or shared shell contract change is proposed.

Extract the static markup and scoped CSS, remove the old standalone header/service link and polling footer, and replace globals with module imports. Root-scope selectors, style variables and mode attributes. Keep every dynamic name, title and label in text nodes. Cancel ResizeObserver, event listeners, timers and animation callbacks on disposal, and call Prism's existing destroy method. Preserve reduced motion and local assembly preferences. Reference SVG exports remain provenance/art assets; the live renderer uses its own factories and needs no arbitrary file route.

The TypeScript host and adapter boundary follow the strict profile. Retained imperative source is reviewed as a port with exact provenance; no lint suppression, runtime loader or arbitrary code execution is added. The package exports the source TSX browser entry and emitted declarations, following the fixed frontend build convention. Esbuild compiles its CSS and retained JavaScript directly; TypeScript uses a narrow declaration for the controller boundary. No shared build or lint exception is needed.

### Owned records and one bounded geometry read

Sync `nanoleaf-wall` and `device` from the Nanoleaf owner through `context.api.sync`. Close the copy on exit. Retain the last view on a failed sync, mark it stale, disable mutations and provide explicit read retry using the same shell participant. Device selection is local and chooses only a configured record; no fallback silently targets another device.

Translate current field names for the existing controller: `elements` to `lines`, `element` to a task's `line`, `manualProject` to `manual`, `startedAtMs` to the old seconds display, and camel-case orientation/mode fields to the adapter's local shape. A current `pendingEdit` renders a pending indication without inventing details the owner does not publish. Use the current `held`, `failing`, `source` and task `statusEvidence` facts.

Declare module content `editor-layout`, taking exactly one valid `device` routing ID. The runtime method checks configured membership and reads `connectorLayout(savedLayout(directory, device))`. Return a closed JSON document `nanoleaf-editor-layout/2.0` with device identity and sanitized geometry, bounded to the existing 300-Line/600-node graph and the existing content response cap. The gateway's API 1.3 path supplies read authorization, deadline, cancellation, secret scanning and fixed safe-error handling. Return `invalid-request` for query shape, `not-found` for an unknown device and `invalid-state` for missing unusable geometry. A stopped module remains `unavailable` through its host. No caller path, address, token or unchecked saved object is returned.

Fetch geometry on device selection and explicit refresh, not a timer. Device-switch and disposal guards discard late reads. A missing connector graph retains the existing standard-outline fallback and an explanatory notice when outlines exist; missing outlines remain unavailable. Fresh runtime setup supplies saved geometry through its supported path. Opening the editor never invokes discovery, enrollment or migration.

### Preserve the existing safe Codex link

The old `wall_server.py` builds `codex://threads/<UUID>` only from qualified Codex Desktop identity. The current wall view omits that field. Add optional `codexUrl` to a wall task and its closed schema, deriving it from the same in-memory qualified session identity already used for eviction tokens. Validate the exact UUID form and provider/client pair. Never read another file, derive a target from a hashed task ID, or treat a title as a URL. This is a module-local read addition with the same read audience as existing task metadata; favorites remain outside this page and its requested families.

### Existing command and diagnostic boundaries

| Entry point | Existing command |
| --- | --- |
| Layout, coverage, rotation, flips, palette | `nanoleaf-wall-edit`, `settings` |
| Element reservation or signature | `nanoleaf-wall-edit`, `assign` |
| Project color or task project | `nanoleaf-wall-edit`, `project-color` or `task-project` |
| Locate or device-only eviction | `nanoleaf-wall-edit`, `locate` or `evict` with current eviction token |
| Work, Quiet or Free | `device-mode-set` |

Pass one explicit action through shared Command with the selected target and fresh request identity. Preserve its no-resend/uncertain lock, tracked completion and authenticated API. The module's admission owns domain refusals and durable outcomes; the editor does not substitute machine-edit commands or acknowledge unread tasks on selection. Read-only and disconnected states disable mutations, with the gateway remaining authoritative.

ADR 0012 and the diagnostic contract govern these unchanged boundaries: rejection proves no effect; acceptance does not imply completion; failed/expired/uncertain results retain evidence. Reads may retry explicitly; commands never retry automatically. Reuse the shell/gateway/dispatcher trace chain and existing decision records, without another logging surface. A read failure reports only a registry code and fixed text, never exception text or a local path.

## Risks / Trade-offs

- Imported document-wide selectors or timers can affect another page. Scope them to the mount and verify disposal and re-entry with a focused browser check.
- Geometry and synced state can arrive for different devices. Validate identity and guard late reads before combining them; preserve stale/unavailable state instead of drawing a guessed wall.
- The old editor assumes a successful HTTP call completed a write. Replace that assumption with shared Command status and owner-confirmed state; test one actual tracked interaction and no resend on reload.
- New navigation data could turn arbitrary input into a URL. Constrain it at projection, schema and rendering to the existing qualified UUID rule and include malformed synthetic cases.
- Reuse preserves imperative complexity. Keep the extraction bounded and defer a full React editor to #761; focused controls, keyboard, accessibility and renderer lifecycle checks cover this port without copying the entire old browser campaign.

## Migration Plan

No data or configuration migration is performed. Deliver source through the existing reviews, focused disposable Acceptance and CI. The established runtime remains unchanged until owner-present #840. A source revision can be replaced before cutover without modifying the installed Nanoleaf service, private stores or devices.
