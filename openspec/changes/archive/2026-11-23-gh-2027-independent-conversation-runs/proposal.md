## Why

[#2027](https://github.com/jimmie-potts/agent-device-hub/issues/2027), part of epic [#2035](https://github.com/jimmie-potts/agent-device-hub/issues/2035), lets each companion run its own task at the same time, so B.U.N.N.Y., Reachy and MicroDuck never block each other. The fake-model slice (#499) allowed one unfinished task across all profiles and one graph invocation. The owner accepted profile rules P1-P8 in round 5 on #505 ([decision](https://github.com/jimmie-potts/agent-device-hub/issues/505#issuecomment-7080895854)). Four follow-up answers on #2027 ([decision](https://github.com/jimmie-potts/agent-device-hub/issues/2027#issuecomment-7107434945)) settle the details: one waiting spoken reply per conversation, the existing speech ranking, the existing device-approval guards, and disable refused while any conversation has an unfinished task.

## What changes

- The engine keeps one running slot per conversation, keyed by conversation ID, so the Apartment conversation (#2032) can join later. A start is refused with `capacity` only while the same conversation has an unfinished task. Answer, resume, cancel and a coding worker's word find the task's own slot.
- Startup reconciles each conversation's unfinished task separately and starts no work.
- Disable stays refused with `invalid-state` while any conversation has an unfinished task. Enable is unchanged.
- The speech coordinator keeps one waiting reply per conversation beside Reachy's card slot. A newer reply of the same conversation, a replay included, replaces that conversation's waiting reply. The voice takes the highest rank first, then arrival order. The existing ranking and the 60-second reply deadline stay.
- The page drops the cross-profile "finish or cancel" gate for starting. Conversation settings names and links each conversation whose unfinished task keeps Disable unavailable.
- Tests: concurrency tests for the engine and the speech coordinator, and a qualification test with three graphs at once, scripted replies in mixed order, an abrupt process exit and a restart.

## Capabilities

### New capabilities

None.

### Modified capabilities

- `bunny-assistant-tasks`: "Bounded single execution" becomes "Bounded execution per conversation"; durable activation, the conversation panel and the conversation workspace change.
- `bunny-companions`: the single speech coordinator keeps one waiting reply per conversation.

## Impact

`modules/companions` (engine, store, speech coordinator, module wiring, page) and two runtime dashboard browser journeys. No event contract, SDK, runtime, table or diagnostic change. The engine gains a test seam, `profileProviders`, for a provider per profile; Reachy and MicroDuck keep the synthetic provider in production until #2026. Out of scope: coding-worker slots (#2028), the queue (#2030), steer (#2031) and the room (#2036). Delivery is reviewed source; installation joins the next runtime batch.
