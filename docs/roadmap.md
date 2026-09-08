# Delivery sequence

GitHub issues own scope, acceptance, status and dependency relationships. This
routing map records the accepted division of work; follow each issue for current
readiness. Native blocked-by links mirror required issue prerequisites.
Conditional live/physical authorization is stated separately in the issues.

## Shared work

| Issue | Outcome | Required issues |
| --- | --- | --- |
| [agent-device-hub#1](https://github.com/jimmie-potts/agent-device-hub/issues/1) | Initialize the shared hub repository and cross-repository plan | Bootstrap authorization |
| [agent-device-hub#2](https://github.com/jimmie-potts/agent-device-hub/issues/2) | Qualify and version the shared agent lifecycle contract | [agent-device-hub#1](https://github.com/jimmie-potts/agent-device-hub/issues/1) |
| [agent-device-hub#3](https://github.com/jimmie-potts/agent-device-hub/issues/3) | Implement the reusable agent-state core and provider emitters | [agent-device-hub#2](https://github.com/jimmie-potts/agent-device-hub/issues/2) |
| [agent-device-hub#4](https://github.com/jimmie-potts/agent-device-hub/issues/4) | Define versioned controller capabilities and integration APIs | [agent-device-hub#1](https://github.com/jimmie-potts/agent-device-hub/issues/1) |
| [agent-device-hub#5](https://github.com/jimmie-potts/agent-device-hub/issues/5) | Host shared monitoring and route commands to existing controllers | [agent-device-hub#3](https://github.com/jimmie-potts/agent-device-hub/issues/3), [agent-device-hub#4](https://github.com/jimmie-potts/agent-device-hub/issues/4), [divoom-app-upgrade#37](https://github.com/jimmie-potts/divoom-app-upgrade/issues/37), [codex-nanoleaf#28](https://github.com/jimmie-potts/codex-nanoleaf/issues/28), [divoom-app-upgrade#31](https://github.com/jimmie-potts/divoom-app-upgrade/issues/31) |
| [agent-device-hub#6](https://github.com/jimmie-potts/agent-device-hub/issues/6) | Build the unified session and device dashboard | [agent-device-hub#5](https://github.com/jimmie-potts/agent-device-hub/issues/5) |
| [agent-device-hub#7](https://github.com/jimmie-potts/agent-device-hub/issues/7) | Provide reusable local MCP transport and device tools | [agent-device-hub#4](https://github.com/jimmie-potts/agent-device-hub/issues/4) |
| [agent-device-hub#8](https://github.com/jimmie-potts/agent-device-hub/issues/8) | Package reversible shared hooks and collector ownership migration | [agent-device-hub#5](https://github.com/jimmie-potts/agent-device-hub/issues/5), [divoom-app-upgrade#31](https://github.com/jimmie-potts/divoom-app-upgrade/issues/31), [codex-nanoleaf#29](https://github.com/jimmie-potts/codex-nanoleaf/issues/29) |
| [agent-device-hub#9](https://github.com/jimmie-potts/agent-device-hub/issues/9) | Verify shared status and command routing across both existing device integrations | [agent-device-hub#6](https://github.com/jimmie-potts/agent-device-hub/issues/6), [agent-device-hub#7](https://github.com/jimmie-potts/agent-device-hub/issues/7), [agent-device-hub#8](https://github.com/jimmie-potts/agent-device-hub/issues/8), [agent-device-hub#13](https://github.com/jimmie-potts/agent-device-hub/issues/13), [divoom-app-upgrade#33](https://github.com/jimmie-potts/divoom-app-upgrade/issues/33), [codex-nanoleaf#29](https://github.com/jimmie-potts/codex-nanoleaf/issues/29) |
| [agent-device-hub#10](https://github.com/jimmie-potts/agent-device-hub/issues/10) | Publish shared OpenSpec validation tooling | [agent-device-hub#1](https://github.com/jimmie-potts/agent-device-hub/issues/1) |
| [agent-device-hub#11](https://github.com/jimmie-potts/agent-device-hub/issues/11) | Evaluate Home Assistant and MQTT for additional device integrations | [agent-device-hub#4](https://github.com/jimmie-potts/agent-device-hub/issues/4) |
| [agent-device-hub#13](https://github.com/jimmie-potts/agent-device-hub/issues/13) | Host shared MCP discovery and agent-status tools in the standalone hub | [agent-device-hub#5](https://github.com/jimmie-potts/agent-device-hub/issues/5), [agent-device-hub#7](https://github.com/jimmie-potts/agent-device-hub/issues/7) |

## New controllers in the monorepo

[ADR 0003](decisions/0003-device-controller-monorepo.md) records the accepted
direction. These issues prioritize automatic status for Tidbyt and LIFX without
changing the existing local Codex control priority. Source controllers use
fakes; hardware permissions and visible acceptance remain separate gates.

| Issue | Outcome | Required issues |
| --- | --- | --- |
| [#14](https://github.com/jimmie-potts/agent-device-hub/issues/14) | Initialize controller documents and backlog | [#1](https://github.com/jimmie-potts/agent-device-hub/issues/1) |
| [#15](https://github.com/jimmie-potts/agent-device-hub/issues/15) | Qualify Tidbyt cloud and Tronbyt connections | [#14](https://github.com/jimmie-potts/agent-device-hub/issues/14) |
| [#16](https://github.com/jimmie-potts/agent-device-hub/issues/16) | Implement the Tidbyt cloud controller | [#15](https://github.com/jimmie-potts/agent-device-hub/issues/15), [#4](https://github.com/jimmie-potts/agent-device-hub/issues/4) |
| [#17](https://github.com/jimmie-potts/agent-device-hub/issues/17) | Qualify direct LIFX LAN control | [#14](https://github.com/jimmie-potts/agent-device-hub/issues/14) |
| [#18](https://github.com/jimmie-potts/agent-device-hub/issues/18) | Implement the LIFX LAN controller | [#17](https://github.com/jimmie-potts/agent-device-hub/issues/17), [#4](https://github.com/jimmie-potts/agent-device-hub/issues/4) |
| [#19](https://github.com/jimmie-potts/agent-device-hub/issues/19) | Add Tidbyt automatic status | [#16](https://github.com/jimmie-potts/agent-device-hub/issues/16), [#3](https://github.com/jimmie-potts/agent-device-hub/issues/3), [Pixoo #31](https://github.com/jimmie-potts/divoom-app-upgrade/issues/31) |
| [#20](https://github.com/jimmie-potts/agent-device-hub/issues/20) | Add LIFX automatic status | [#18](https://github.com/jimmie-potts/agent-device-hub/issues/18), [#3](https://github.com/jimmie-potts/agent-device-hub/issues/3), [Pixoo #31](https://github.com/jimmie-potts/divoom-app-upgrade/issues/31) |
| [#21](https://github.com/jimmie-potts/agent-device-hub/issues/21) | Install and verify Tidbyt | [#19](https://github.com/jimmie-potts/agent-device-hub/issues/19), [#8](https://github.com/jimmie-potts/agent-device-hub/issues/8) |
| [#22](https://github.com/jimmie-potts/agent-device-hub/issues/22) | Install and verify LIFX | [#20](https://github.com/jimmie-potts/agent-device-hub/issues/20), [#8](https://github.com/jimmie-potts/agent-device-hub/issues/8) |
| [#23](https://github.com/jimmie-potts/agent-device-hub/issues/23) | Implement the deferred Tronbyt connection | [#15](https://github.com/jimmie-potts/agent-device-hub/issues/15), [#16](https://github.com/jimmie-potts/agent-device-hub/issues/16), [#4](https://github.com/jimmie-potts/agent-device-hub/issues/4) |
| [#24](https://github.com/jimmie-potts/agent-device-hub/issues/24) | Verify the deferred Tidbyt-to-Tronbyt transition | [#23](https://github.com/jimmie-potts/agent-device-hub/issues/23), [#21](https://github.com/jimmie-potts/agent-device-hub/issues/21) |
| [#25](https://github.com/jimmie-potts/agent-device-hub/issues/25) | Plan and migrate Pixoo source later | [#14](https://github.com/jimmie-potts/agent-device-hub/issues/14), agreed future migration window |
| [#26](https://github.com/jimmie-potts/agent-device-hub/issues/26) | Plan and migrate Nanoleaf source later | [#14](https://github.com/jimmie-potts/agent-device-hub/issues/14), agreed future migration window |

The exact bulb model, Tidbyt generation, status layouts/effects and takeover/
restoration policies remain named qualification or readiness decisions. #21/#22
require the shared producer setup for full live lifecycle acceptance; source
status integration only requires the core and its initial Pixoo host. #24 also
requires explicit firmware authorization and a validated cloud baseline.

Deferred source migrations reconcile active work and transfer ownership before
moving code. They do not block current Pixoo/Nanoleaf delivery or authorize
installed-runtime changes. New device acceptance remains in #21/#22; #9 retains
its existing Pixoo/Nanoleaf scope.

## PC tower lighting

[#50](https://github.com/jimmie-potts/agent-device-hub/issues/50) owns documentation/backlog initialization only. The
[PC lighting guide](../controllers/pc-lighting/README.md) records the accepted
Corsair scope, optional Strimer route and preserved vendor applications. The
following issues are skeletons to refine before implementation; GitHub owns
their current readiness and acceptance.

| Issue | Outcome | Required source prerequisites |
| --- | --- | --- |
| [#51](https://github.com/jimmie-potts/agent-device-hub/issues/51) | Qualify iCUE, RAM and H150i lighting. | [#50](https://github.com/jimmie-potts/agent-device-hub/issues/50) |
| [#52](https://github.com/jimmie-potts/agent-device-hub/issues/52) | Qualify Strimer control and L-Connect handoff. | [#50](https://github.com/jimmie-potts/agent-device-hub/issues/50) |
| [#53](https://github.com/jimmie-potts/agent-device-hub/issues/53) | Build the PC controller and qualified Corsair adapter. | [#51](https://github.com/jimmie-potts/agent-device-hub/issues/51), [#4](https://github.com/jimmie-potts/agent-device-hub/issues/4) |
| [#54](https://github.com/jimmie-potts/agent-device-hub/issues/54) | Add the optional qualified Strimer adapter. | [#52](https://github.com/jimmie-potts/agent-device-hub/issues/52), [#53](https://github.com/jimmie-potts/agent-device-hub/issues/53), [#4](https://github.com/jimmie-potts/agent-device-hub/issues/4) |
| [#55](https://github.com/jimmie-potts/agent-device-hub/issues/55) | Map shared agent status to qualified lighting targets. | [#53](https://github.com/jimmie-potts/agent-device-hub/issues/53), [#3](https://github.com/jimmie-potts/agent-device-hub/issues/3), [Pixoo #31](https://github.com/jimmie-potts/divoom-app-upgrade/issues/31) |
| [#56](https://github.com/jimmie-potts/agent-device-hub/issues/56) | Add later shared UI/MCP controls. | [#53](https://github.com/jimmie-potts/agent-device-hub/issues/53), [#7](https://github.com/jimmie-potts/agent-device-hub/issues/7), [#31](https://github.com/jimmie-potts/agent-device-hub/issues/31) |
| [#57](https://github.com/jimmie-potts/agent-device-hub/issues/57) | Install and verify Corsair status and restoration. | [#55](https://github.com/jimmie-potts/agent-device-hub/issues/55), [#8](https://github.com/jimmie-potts/agent-device-hub/issues/8) |
| [#58](https://github.com/jimmie-potts/agent-device-hub/issues/58) | Install and verify Strimer handoff and restoration. | [#54](https://github.com/jimmie-potts/agent-device-hub/issues/54), [#55](https://github.com/jimmie-potts/agent-device-hub/issues/55), [#8](https://github.com/jimmie-potts/agent-device-hub/issues/8) |

Strimer participation in shared status or controls additionally requires
[#54](https://github.com/jimmie-potts/agent-device-hub/issues/54). This conditional branch does not block Corsair source
status or [#57](https://github.com/jimmie-potts/agent-device-hub/issues/57). General controls follow the feature and frontend
work selected by #31; refine those additional implementation dependencies before
[#56](https://github.com/jimmie-potts/agent-device-hub/issues/56) is ready. Existing Codex-first work retains its priority.

The acceptance issues require separate installation and lighting-sequence
authorization, confirmed SDK/USB identities or network targets as applicable,
vendor ownership handoff and visible restoration evidence. Source dependency
closure grants none of those permissions. Neither firmware changes nor replacing
iCUE/L-Connect is part of this plan. No shared package, runtime or service is
introduced by the documentation bootstrap.

## Device adoption

| Issue | Outcome | Required issues |
| --- | --- | --- |
| [divoom-app-upgrade#36](https://github.com/jimmie-potts/divoom-app-upgrade/issues/36) | Record shared agent-device-hub ownership and migration dependencies | Planning authorization |
| [divoom-app-upgrade#37](https://github.com/jimmie-potts/divoom-app-upgrade/issues/37) | Expose the Pixoo controller through the shared device API | [agent-device-hub#4](https://github.com/jimmie-potts/agent-device-hub/issues/4), [divoom-app-upgrade#8](https://github.com/jimmie-potts/divoom-app-upgrade/issues/8) |
| [divoom-app-upgrade#38](https://github.com/jimmie-potts/divoom-app-upgrade/issues/38) | Adopt shared OpenSpec validation tooling | [agent-device-hub#10](https://github.com/jimmie-potts/agent-device-hub/issues/10) |
| [codex-nanoleaf#27](https://github.com/jimmie-potts/codex-nanoleaf/issues/27) | Record shared agent-device-hub adoption and migration dependencies | Planning authorization |
| [codex-nanoleaf#28](https://github.com/jimmie-potts/codex-nanoleaf/issues/28) | Expose a protected controller API for the shared hub | [agent-device-hub#4](https://github.com/jimmie-potts/agent-device-hub/issues/4) |
| [codex-nanoleaf#29](https://github.com/jimmie-potts/codex-nanoleaf/issues/29) | Consume shared agent sessions while preserving Nanoleaf behavior | [agent-device-hub#3](https://github.com/jimmie-potts/agent-device-hub/issues/3), [agent-device-hub#4](https://github.com/jimmie-potts/agent-device-hub/issues/4), [divoom-app-upgrade#31](https://github.com/jimmie-potts/divoom-app-upgrade/issues/31), [codex-nanoleaf#28](https://github.com/jimmie-potts/codex-nanoleaf/issues/28) |
| [codex-nanoleaf#30](https://github.com/jimmie-potts/codex-nanoleaf/issues/30) | Verify shared monitoring migration and Nanoleaf compatibility | [codex-nanoleaf#29](https://github.com/jimmie-potts/codex-nanoleaf/issues/29), [agent-device-hub#8](https://github.com/jimmie-potts/agent-device-hub/issues/8) |
| [codex-nanoleaf#31](https://github.com/jimmie-potts/codex-nanoleaf/issues/31) | Adopt shared OpenSpec validation tooling | [agent-device-hub#10](https://github.com/jimmie-potts/agent-device-hub/issues/10) |
| [divoom-app-upgrade#29](https://github.com/jimmie-potts/divoom-app-upgrade/issues/29) | Adopt qualified shared monitoring contracts in Pixoo | [agent-device-hub#2](https://github.com/jimmie-potts/agent-device-hub/issues/2), [divoom-app-upgrade#2](https://github.com/jimmie-potts/divoom-app-upgrade/issues/2), [divoom-app-upgrade#3](https://github.com/jimmie-potts/divoom-app-upgrade/issues/3) |
| [divoom-app-upgrade#31](https://github.com/jimmie-potts/divoom-app-upgrade/issues/31) | Embed the shared agent-state service in the Pixoo backend | [divoom-app-upgrade#29](https://github.com/jimmie-potts/divoom-app-upgrade/issues/29), [agent-device-hub#3](https://github.com/jimmie-potts/agent-device-hub/issues/3), [agent-device-hub#4](https://github.com/jimmie-potts/agent-device-hub/issues/4), [divoom-app-upgrade#6](https://github.com/jimmie-potts/divoom-app-upgrade/issues/6), [divoom-app-upgrade#8](https://github.com/jimmie-potts/divoom-app-upgrade/issues/8) |
| [divoom-app-upgrade#24](https://github.com/jimmie-potts/divoom-app-upgrade/issues/24) | Add local MCP status and display controls for Codex | [divoom-app-upgrade#8](https://github.com/jimmie-potts/divoom-app-upgrade/issues/8), [agent-device-hub#7](https://github.com/jimmie-potts/agent-device-hub/issues/7) |
| [divoom-app-upgrade#25](https://github.com/jimmie-potts/divoom-app-upgrade/issues/25) | Add MCP media selection and playlist playback tools | [divoom-app-upgrade#24](https://github.com/jimmie-potts/divoom-app-upgrade/issues/24), [divoom-app-upgrade#8](https://github.com/jimmie-potts/divoom-app-upgrade/issues/8) |
| [divoom-app-upgrade#32](https://github.com/jimmie-potts/divoom-app-upgrade/issues/32) | Render the 64×64 agent monitoring dashboard and preview | [divoom-app-upgrade#31](https://github.com/jimmie-potts/divoom-app-upgrade/issues/31), [divoom-app-upgrade#3](https://github.com/jimmie-potts/divoom-app-upgrade/issues/3) |
| [divoom-app-upgrade#33](https://github.com/jimmie-potts/divoom-app-upgrade/issues/33) | Add monitor controls and shared Monitor/Media display ownership | [divoom-app-upgrade#31](https://github.com/jimmie-potts/divoom-app-upgrade/issues/31), [divoom-app-upgrade#32](https://github.com/jimmie-potts/divoom-app-upgrade/issues/32), [divoom-app-upgrade#30](https://github.com/jimmie-potts/divoom-app-upgrade/issues/30), [divoom-app-upgrade#7](https://github.com/jimmie-potts/divoom-app-upgrade/issues/7), [divoom-app-upgrade#8](https://github.com/jimmie-potts/divoom-app-upgrade/issues/8), [divoom-app-upgrade#9](https://github.com/jimmie-potts/divoom-app-upgrade/issues/9), [divoom-app-upgrade#37](https://github.com/jimmie-potts/divoom-app-upgrade/issues/37) |
| [divoom-app-upgrade#34](https://github.com/jimmie-potts/divoom-app-upgrade/issues/34) | Package and verify Codex and Claude monitoring on the Pixoo | [divoom-app-upgrade#29](https://github.com/jimmie-potts/divoom-app-upgrade/issues/29), [divoom-app-upgrade#31](https://github.com/jimmie-potts/divoom-app-upgrade/issues/31), [divoom-app-upgrade#32](https://github.com/jimmie-potts/divoom-app-upgrade/issues/32), [divoom-app-upgrade#30](https://github.com/jimmie-potts/divoom-app-upgrade/issues/30), [divoom-app-upgrade#33](https://github.com/jimmie-potts/divoom-app-upgrade/issues/33), [agent-device-hub#8](https://github.com/jimmie-potts/agent-device-hub/issues/8) |
| [codex-nanoleaf#15](https://github.com/jimmie-potts/codex-nanoleaf/issues/15) | Expose authoritative light rendering state for display clients | [agent-device-hub#4](https://github.com/jimmie-potts/agent-device-hub/issues/4) |

## Stages and gates

1. Qualify shared lifecycle contracts and define controller contracts. They can
   proceed independently after bootstrap.
2. Deliver the shared state core, embed it in Pixoo and expose both protected
   controller APIs. Nanoleaf can then consume the shared feed while retaining
   its Windows writer and a reversible legacy input path.
3. Introduce standalone hosting after Pixoo #31 provides the export/import and
   embedded/remote session-source boundary. Verify producer and consumer route
   switching, including Pixoo rendering and acknowledgment, through cutover and
   rollback with one state owner.
   The shared dashboard and #13's MCP host depend on that host. The reusable local
   MCP module in #7 depends only on #4 and can serve local device integrations
   earlier, independently of monitoring or standalone hosting.
4. Package reversible hook/cutover tooling. Keep installation, real-client
   compatibility and each device's physical acceptance under their named owners.
5. Run cross-repository source compatibility at a pinned revision matrix.
   Physical/client receipts remain separately identified.

Pixoo's pure renderer can proceed before its physical transport experiment is
complete. Final Monitor/Media device integration still requires that result.
The basic shared overview does not wait for exact Nanoleaf mirroring, Lively,
ambient redesign or Pixoo's advanced player UI. Exact previews in the hub are
deferred for a future scope decision; device renderer issues do not own that
future hub integration.

Shared workflow tooling is an independent package-and-adoption sequence.
Home Assistant/MQTT evaluation remains deferred; it neither blocks local
monitoring nor authorizes a second writer or new installation.
LIFX's direct-LAN choice is recorded in #17 and ADR 0003.

Closed foundational device issues retain their completed evidence. This plan
does not reopen them, claim new runtime delivery, or advance active wall-map UI
work as a side effect.
