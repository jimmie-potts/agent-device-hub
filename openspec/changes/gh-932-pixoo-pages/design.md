## Context

See `proposal.md` for scope and the owning issue. At `bf11587c`, module API 1.2 requires a renderer for every page; gateway policy and the shell iframe forbid scripts. The dashboard already uses React, TypeScript and esbuild. The fixed module registry already collects package declarations at build time. Pixoo has revision-checked commands and tracked outcomes, while its old views use legacy REST routes.

Design is required because this change crosses SDK, gateway and browser contracts and changes executable-content policy. The coordinator owns that contract and all shared-file integration. Module workers own feature proposals; no consumer invents a competing contract.

## Goals / Non-Goals

**Goals:** Keep feature frontend source with its module, share one browser connection and shell, and support reviewed existing editors without rewriting their renderers. Qualify the contract with a real Pixoo edit before dependent frontend integration.

**Non-Goals:** Runtime plugin discovery, untrusted extensions, another framework/service, data transfer, a full Nanoleaf React conversion, and new analytics or automation features.

## Decisions

1. **Module API 1.3 distinguishes page presentations.** Omitted presentation keeps the existing passive HTML shape. `react` pages declare identity/title without a Node renderer. `trusted-editor` pages declare a renderer and finite script/style asset IDs. Existing 1.0–1.2 modules remain supported within their existing capabilities. Manifest checks, kit, host and catalog consumers change together. Message profile 2.0 and device commands remain unchanged.

2. **Browser contributions are build inputs.** A module's explicit `./frontend` entry exports its page components; the existing build collects these entries as static browser imports. A browser-safe SDK frontend entry holds the small contribution/context types. The shell supplies common styling/components, authority, authenticated reads, tracked commands and scoped sync on its existing participant. Feature subscriptions release on unmount/sign-out. No runtime import URL, package-root registration, database, device transport or Node implementation enters the browser bundle. A central hardcoded device list would repeat the registry this repository already removed.

3. **Declared metadata and built code must agree.** The shell renders a React component only when its module/page is both built and declared by the authenticated admitted-module catalog. Hash navigation stays unchanged. A direct React page URL returns the canonical same-origin shell location. Missing or failed modules show unavailable; no private-file or installed-service fallback is tried. Navigation and reads issue no commands.

4. **Executable assets have a separate declared route.** Reserve `assets` beside `content`. A manifest declares finite asset IDs, content types and byte readers under `/modules/<module>/assets/<asset>`. Reuse contribution admission, running-state, five-second deadline, read authentication, Origin, secret scanning, no-store and nosniff checks. Reuse the existing 16 MiB response bound per asset. JavaScript, CSS and reviewed static images, including Prism SVG, belong here; uploaded media stays on the non-executable content route. Never serve a requested filesystem path or promote user content to an asset.

5. **Page policy follows the presentation.** Passive HTML retains its restrictive policy. Trusted editors run declared same-origin scripts and styles, with same-origin authenticated reads and framing by the shell; no external scripts, eval, inline script handlers, forms, base URL or nested frames. A style-only inline allowance supports the current Prism renderer. Treat the same-origin scripted iframe as trusted application code, with no claim of an untrusted-code sandbox. Device credentials never enter the page. Authentication and command authority remain gateway responsibilities.

6. **Pixoo uses existing owners and commands.** Reuse the current React media components and existing library/playlist/player/Monitor/settings flows with provenance. Use bounded catalog pages and reference previews; normal future media upload uses bounded authenticated staging in the module's private incoming area and the existing import command/outcome cleanup. It is not legacy-data transfer. A playlist name save sends one existing revision-checked `pixoo-playlist-change` through the core dispatcher. Show requested, accepted and completed/uncertain separately, then use current owner evidence for the result. Reuse existing attempt retention and no-retry behavior rather than creating another command controller.

7. **Qualify one boundary, then complete the views.** The first integrated editor check opens a synthetic playlist, edits its draft and explicitly saves its name. It demonstrates the real authenticated tracked path, read-only refusal and no change on open. A trusted fixture bundle qualifies asset/CSP/iframe behavior; the Nanoleaf port later verifies its real editor. Existing checks supply unchanged failure/reload coverage. Add focused checks only where the new boundary needs evidence, then exercise the Pixoo views required by the issue. Keep the existing hosted CI and independent review gates.

8. **Catalog and preview reads reuse content references.** API 1.3 extends `content(ref, request?)` with `{query, signal}` and a returned shared `ErrorBody` for expected refusals. Keep `/modules/<name>/content/<ref>`; older modules still refuse queries. Bound the query to 16 distinct keys, keys of at most 64 characters and values of at most 512; the module validates its closed set and values. Abort the supplied signal when the contribution ends or its existing five-second deadline expires. Refusals expose only the registry code with fixed gateway text. Pixoo uses SQL pagination and cached compatibility evidence, without frame validation or writes on GET. JSON pages stay within 256 KiB; preview frames retain their existing 64 KiB limit. The shell's scoped `image(path)` returns a validated image Blob through the same authenticated, abortable read path as JSON, so the existing canvas preview needs no separate connection or credentials.

## Risks / Trade-offs

- Trusted frames have same-origin application authority → ship only reviewed bundles and keep user content on non-executable routes; do not describe the frame as extension isolation.
- Feature imports could reach Node code → compile browser entries separately and extend the existing browser-bundle check with a meaningful rejected Node-entry control.
- Shell helpers could become a general UI framework → expose only facilities used by these shipped pages; reuse existing implementations and keep feature state in its module frontend.
- A successful HTTP reply could be mistaken for completion → preserve tracked operation evidence, shared errors and trace context through the existing command path. No automatic command retry.
- Parallel changes could diverge → #932 owns shared interfaces; the coordinator serializes gateway/build/shell edits. Automation core and Wispr reader work are independent, while frontend consumers wait for the qualified contract.

## Migration Plan

This is source-only delivery into the new runtime. No installed data, settings, media or scenes are copied. Old services remain untouched until owner-present #840; its accepted fresh setup and manual return procedure owns installation. Keep existing passive contributions working while adding the new declarations. Synchronize affected specifications and archive this change only after its implementation and Acceptance evidence are complete.
