# Wispr analytics module

This read-only module projects the Windows collector's published aggregate and diagnostic JSON files. It does not open the collector database, collect dictations, create an analytics store or broadcast analytics. The runtime's authenticated read adapter calls `read(route, query, signal)`; all authenticated read-scoped clients use the same access rule, without a separate Wispr client grant.

Configure `sourceId`, `aggregatePath` and `diagnosticsPath` manually in the module's private configuration section. Both paths must select distinct absolute normalized JSON files outside a Git checkout and cloud-sync folders. Files must be regular, single-link, owner-controlled files; Linux files must be private. The existing Windows producer owns ACL qualification on DrvFS. Missing or malformed files produce a refusal when no valid observation exists, rather than invented zero totals. No source discovery, import or migration occurs.

`freshnessMs` defaults to 600000 and accepts 1000 through 86400000. `exposeToDashboard` and `shareTextAggregates` independently default to false. Settings returned through the runtime contain the source label, freshness threshold and flags, without file paths. Browser exposure is a gateway decision; machine reads remain available under the runtime read scope. Text additionally requires the producer's current `languageEnabled` choice. Ordinary JSON and CSV exports remain numeric; including text requires an explicit query and both text choices.

The module starts without opening source files. The first read starts a host-owned worker. Refreshes coalesce for 30 seconds; each response still checks the diagnostic identity. Bounded last-good numeric data retains its original observation time and becomes stale on an unreadable replacement. A clear generation retires that data, and its authority survives worker replacement. Input snapshots are bounded at 16 MiB, diagnostics at 4096 bytes, output at 1 MiB, query rows at 10000, pending reads at 32 and worker requests at 2500 ms. CSV cells escape spreadsheet formulas.

Privacy changes invalidate pending reads and completed replies whose delivery is still outstanding. Request cancellation and module stop also fence those replies. `privacy(expose, text)` is an internal lifecycle/settings seam, not a new HTTP configuration writer. The gateway must re-admit the original credential/session immediately before HTTP emission, and recheck browser exposure there. The backend does not identify clients or mint authority.

The content adapter returns shared registry refusals or bounded content. JSON documents use `wispr-analytics/2.0`; CSV uses `text/csv; charset=utf-8`. The coordinator owns the API1.3 content/page attachment, fixed download filename, shared React page, numeric home widget and runtime catalog. Backend source tests do not establish those integration paths or installed acceptance.

## Validation

After the repository build compiles the SDK and unchanged Wispr contracts, compile this package with `fnm exec --using=.nvmrc -- node node_modules/typescript/bin/tsc -p modules/wispr/tsconfig.json`. Run its compiled tests with `fnm exec --using=.nvmrc -- node --test modules/wispr/dist/tests/*.test.js` and lint `modules/wispr` with the repository strict profile. The coordinator owns workspace/build/CI integration and the scoped permission to import the existing Wispr contracts.

Tests use fresh private synthetic files under the caller's disk-backed `TMPDIR`. They exercise the real reader worker and SDK module harness without a listener, installed runtime, collector, device or cloud call. They cover numeric views and filters, missing/malformed/stale input, clear fences through worker replacement, producer and reader text choices, CSV escaping, bounded admission/deadline, cancellation, outstanding opt-out/stop, lazy startup and worker cleanup.

See [PROVENANCE.md](PROVENANCE.md) for the source copy and adaptations. Source delivery remains separate from owner-present fresh setup under Hub #840.
