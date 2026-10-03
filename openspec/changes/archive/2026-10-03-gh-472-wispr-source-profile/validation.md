# Source qualification

Refs https://github.com/jimmie-potts/agent-device-hub/issues/472. This change repairs the owner-approved native source-profile incompatibility found during installed setup. It does not establish installed acceptance.

The observed-schema regression failed with `source-schema` before the reader change and passed afterward. Collector tests passed 97/97; focused reader/language cases passed 14/14. The root build, typecheck, TypeScript contracts (410 tests), Python contracts, contract packaging and extracted collector packaging passed. The affected Hub producer/HTTP consumer checks passed 20/20 using synthetic files outside Git. Workflow tests passed 18/18 before archive; final archive validation is a release gate.

Collector 1.1.2 contains 601 manifest-verified files. Its archive SHA256 is `84655d50a66cc1d5c7522357bb14a284b5ffed8d6be3f8275a23186491bdd425`. On native Windows Node 24.21.0, the complete extracted package passed reader, privacy, production CLI, native source-profile CLI, locked-output recovery, 100,000-row capacity and offline package checks. The new profile check verifies exact repeated numeric and language results, native app/reporting-zone groups, unknown missing edit-end evidence, text opt-out, source byte/ACL preservation and private-canary exclusion.

The affected main spec is synchronized and this change is archived before final committed-candidate reviews. Private raw logs and immutable review/CI bindings remain outside Git in the delivery evidence directory. Installation is still paused; real-source app/duration meaning, installed dashboard/export/scheduling and the one-day observation remain separate acceptance work. No live source write, source ACL change, text collection, Hub upgrade or task registration is claimed here.
