## Context

History compares the top-level members of a state record with the record it holds (`apps/runtime/src/core/history.ts`). Schemas of the contracts package's families live in `packages/event-contracts`; a module's own families come from its registration's `schemas`, collected by `moduleSchemas`. Families carry no kind in a module's registration: a module's checks refuse other kinds inside closures, and the Pixoo and Nanoleaf register schemas with no check at all. See proposal.md for the motivation.

## Goals / Non-Goals

**Goals:**
- One declaration per family, by family and not by version, that #1772 can read.
- Every state family classified on purpose, with tests that fail on an unclassified family or version and on a safety member marked bookkeeping.

**Non-Goals:**
- Reading the declaration (history intake is #1772), gap rows and polling intervals (decision 4, #1772), any schema or message change.

## Decisions

- **JSON pointers to single-value members.** A pointer names an object member at any depth, never an array position, and must name a member that holds a single value in every version of the family. Masking a whole object such as `/observed` would hide `observed/power`; refusing containers keeps each entry as narrow as a reading time. For the Roborock's `observedAtMs`, a known-or-unknown wrapper, the declaration is `/observedAtMs/value`: a reading appearing or disappearing still counts. Alternative: pointers to any member, checked by the deny list only; rejected because a parent of a safety member could slip through under another name.
- **Deny list by member name at any depth.** A pointer is refused when any of its tokens is a name that is never bookkeeping: identity, availability, generation, configuration revision, holds, status, observed power and brightness, desired, pending work and outcomes, a transmission's request and operations, power-limit settings and status, and `showing`, `freshness` and `failing` from the replay. Names apply in every family, which is stricter than the issue's per-family list and refuses a nested `status` or a member under `held`. Settings families (ADR 0015's replicated settings) declare nothing.
- **Complete map in the package, sparse maps in modules, one table in the runtime tests.** The contracts package lists every one of its state families, an empty list included, so its own tests fail on a new family. Modules declare only families with members, because their families carry no kind. The runtime test's checked-in table lists every state family and version of the core and every registered module, and every module family that is not state, so a new module family or version fails until someone classifies it; each entry must equal the declaration.
- **Refusal when the shipped list assembles.** `shippedList` already refuses registrations that break its rules; `moduleBookkeeping` runs there, so a bad declaration stops the runtime from starting with the same sentence form. The check walks schemas in memory and adds no file or network work.
- **The value never counts; presence and null do** (review of PR #1783). `withoutBookkeeping` puts one fixed marker in place of a present, non-null bookkeeping value instead of removing the member, so absent, null and "some value" stay three states. A new power limit's first reading (null to a time) is then a change, as the Roborock's reading appearing is. Alternative: removing the member, which hid those steps.
- **Positive scalars only** (review of PR #1783). Every alternative of a declared member must say it holds a scalar; an unconstrained schema, another keyword such as `if` or `not`, or a value mixed with a `const` or `enum` is refused, so a state can never ride on a time's alternative.
- **Helpers next to the declaration.** `withoutBookkeeping`, `sameState` and `leafMutations` live in `v2/bookkeeping`, so #1772's intake and tests use the same comparison the declaration's tests check. `sameState` also ignores `id` and `revision`, as history does today.

## Risks / Trade-offs

- [A member marked bookkeeping that is real state hides changes later] → the deny list, the single-value rule, the leaf-mutation check over each declared family's fixtures, and the classification table's review.
- [Module kinds are classified by hand] → the table lists every module family, state or not, so a new one fails; declared families' fixtures are validated as state messages through the module's own validator.
- [Hibernated modules (BB-8, ONN) are not built] → when one returns, the table test fails until its families are listed.

## Migration Plan

None: no storage, schema or message changes. Rolling back removes metadata nothing reads.
