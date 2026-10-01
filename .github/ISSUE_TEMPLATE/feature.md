---
name: Feature or integration
about: Define the smallest useful change for the real setup.
labels: ["enhancement", "status:backlog"]
---

## [Describe what this story will deliver]

- [One concrete behavior or outcome.]
- [A second useful detail.]
- [A third useful detail.]
- [A fourth useful detail.]
- [A fifth useful detail or practical limit.]

<!--
Keep the normal issue title. Replace the headline and all five bullets with
short, distinct sentences in familiar words. The headline itself explains the
planned benefit; avoid generic labels such as Summary or In plain English.
Keep the opening visible, outside tables, fences and collapsed details.
Investigations promise findings or a decision, not a working feature. Preserve
unknowns; do not invent behavior or success claims to fill five bullets.

Use this opening only for new stories after adoption, including maintenance,
investigation and child stories. Do not retrofit existing stories at pickup or
edit; a new child does not change its existing parent.

Size the story for one operator, the selected installation and its configured
devices. A small story may answer each detailed prompt in a few sentences.
Complete every section below before submitting; Markdown templates do not
enforce required inputs. See docs/sdlc.md#scope-defaults and #new-story-opening.
Guide record consumers preserve these five sections and the strict Guide fields.
See docs/work-guide/contracts/README.md for the versioned field dictionary and
missing-data rules; do not invent acceptance for placeholders.

For the work guide's ## Guide convention (docs/work-guide/README.md), replace
<topic id> with one of shared-codex, bunny-controls, nanoleaf-presentation,
nanoleaf-devices, pixoo-media, controls-music, desktop-controls, work-guide,
assistant-access, hosting-migrations, development-workflow, steam-deck.
Optional lines: **Note:** a one-line reading note, and **Highlight:**
next step | decision | later | idea, <reason>. Mark a new capability, a
generalization or a newly cheap win with **Highlight:** idea, <what prompted it>;
beside an idea only, add **Extends:** <keys> for the stories it builds on,
as H67, N47 or P91.
-->

## Outcome and real setup

<!-- State what the user will observe, on which installation, clients and devices, and what is excluded. -->

## Smallest useful implementation

<!-- Start from existing components and explicit manual steps. Link required issues across repositories, or state none, and distinguish conditional gates from related independent work. -->

## Behavior and protections to preserve

<!-- Name the existing behavior, state and device-writer ownership, targets, manual control, credentials and data that must keep working. -->

## Observable acceptance and planned evidence

<!-- List observable criteria and the check or observation for each. Identify source, client and physical gates. Installation or physical work requires an explicit request and an owner. -->

Delivery target: source-only

## Meaningful deferrals

<!-- For each meaningful omission, state its consequence or manual alternative and its owning issue or revisit trigger. -->

None

## Guide

**Topic:** <topic id>
