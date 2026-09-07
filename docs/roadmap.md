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
| [agent-device-hub#7](https://github.com/jimmie-potts/agent-device-hub/issues/7) | Provide reusable MCP tools and a shared device gateway | [agent-device-hub#5](https://github.com/jimmie-potts/agent-device-hub/issues/5) |
| [agent-device-hub#8](https://github.com/jimmie-potts/agent-device-hub/issues/8) | Package reversible shared hooks and collector ownership migration | [agent-device-hub#5](https://github.com/jimmie-potts/agent-device-hub/issues/5), [divoom-app-upgrade#31](https://github.com/jimmie-potts/divoom-app-upgrade/issues/31), [codex-nanoleaf#29](https://github.com/jimmie-potts/codex-nanoleaf/issues/29) |
| [agent-device-hub#9](https://github.com/jimmie-potts/agent-device-hub/issues/9) | Verify shared status and command routing across both device integrations | [agent-device-hub#6](https://github.com/jimmie-potts/agent-device-hub/issues/6), [agent-device-hub#7](https://github.com/jimmie-potts/agent-device-hub/issues/7), [agent-device-hub#8](https://github.com/jimmie-potts/agent-device-hub/issues/8), [divoom-app-upgrade#33](https://github.com/jimmie-potts/divoom-app-upgrade/issues/33), [codex-nanoleaf#29](https://github.com/jimmie-potts/codex-nanoleaf/issues/29) |
| [agent-device-hub#10](https://github.com/jimmie-potts/agent-device-hub/issues/10) | Publish shared OpenSpec validation tooling | [agent-device-hub#1](https://github.com/jimmie-potts/agent-device-hub/issues/1) |
| [agent-device-hub#11](https://github.com/jimmie-potts/agent-device-hub/issues/11) | Evaluate Home Assistant and MQTT for additional device integrations | [agent-device-hub#4](https://github.com/jimmie-potts/agent-device-hub/issues/4) |

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
   The shared dashboard and MCP gateway depend on that host. Pixoo's local MCP
   endpoint consumes the same reusable implementation.
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

Closed foundational device issues retain their completed evidence. This plan
does not reopen them, claim new runtime delivery, or advance active wall-map UI
work as a side effect.
