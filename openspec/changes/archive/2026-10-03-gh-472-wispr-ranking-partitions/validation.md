# Source qualification

The synthetic large-batch regression fails with aggregate-capacity on collector 1.1.3 and passes with the partition correction. The focused suite passes 17/17, including adversarial partition overflow and committed-state rollback. Whole-output differential comparison matches 264 mixed contributions across three reporting zones.

Required build/typecheck, collector (103/103), offline package, controller contracts (410/410), Python contracts (4/4), contract package, workflow and affected Hub consumers (20/20) pass. After incorporating main's CHOMPI and Claude Desktop changes, shared checks and Hub consumers are refreshed; that comparison has 41 specifications and 87 archives, with 18/18 workflow tests. The earlier count of 88 incorrectly included `.gitkeep`. The subsequent maintenance-only base refresh adds one archive; its refreshed inventory is 41 specifications and 88 archives.

Complete extracted collector 1.1.4 passes all six native entrypoints and package smoke. Its 603 manifest hashes are verified. Archive SHA256: `302da81feb855adeeba3d281fb11414823beb9c41949a10ee775fa87ddbd59ff`.

Enlarged synthetic retained-store import/repeat/restart/zone exercise: Windows 29,219 ms, peak RSS 437,416 KiB; Linux 30,926 ms, peak RSS 458,520 KiB. These are direct-store exercises. The native production CLI on oversized synthetic ranking batches succeeds in 10,143 ms, repeats exact counts and preserves source bytes. The existing 100,000-row test completes in 2,531 ms and preserves last-good state on overflow. Existing budgets are unchanged.

The first comparison fixture incorrectly expected alignment for 1,800-token stages above the existing matrix-cell bound; the final 900-token fixture preserves the large key population and proves its old-version failure. A spec scenario title needed preservation under MODIFIED validation; the existing title and the partition overflow criterion are retained. A malformed inline resource driver was replaced by a syntax-checked script. These harness/planning failures remain in private evidence.

Installed collector 1.1.3 still fails its active batch and is paused. This source correction does not establish actual-history performance, field semantics, an owner-reviewed sample, installed replacement, recurring collection or a completed day. Personal data remains outside source/public evidence. Hosted reviews and CI are coordinator gates recorded on the PR after commit.
