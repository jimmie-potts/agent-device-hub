# Source qualification

The new store regression fails on collector 1.1.4: an on-time interval of 300,017 ms records a `not-observed` gap. It passes with the 450,000 ms observation tolerance. The test also covers the inclusive boundary, a missed run, merging of consecutive gaps and a failed attempt inside the tolerance.

Required build, typecheck, collector (104/104), offline package, controller contracts (410/410), Python contracts, contract package, workflow checks and workflow tests (52/52) pass from the delivery worktree. Affected Hub consumers pass 20/20.

Complete extracted collector 1.1.5 passes all six native Windows entrypoints and package smoke under Node 24.21.0. Its 603 manifest hashes are verified. Archive SHA256: `e31694169826838dcb403e97e19ace7ddc7f7cd36e88a2e0801efebc1a70a12e`; a second package build reproduces it byte for byte.

Installed evidence for #472 motivated the change. Collector 1.1.4 recorded 108 false `not-observed` gaps across 28 hours of on-time task runs. The private gap timestamps stay outside source and public evidence. This source correction does not establish installed replacement, rewrite gaps already recorded or complete #472's day observation. Hosted reviews and CI are coordinator gates recorded on the PR after commit.
