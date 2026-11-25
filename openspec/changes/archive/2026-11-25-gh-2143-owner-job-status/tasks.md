## 1. Implementation

- [x] 1.1 Bind one status request to the indexed Jobs projection and its originating conversation.
- [x] 1.2 Record and recheck the private reply and keep its facts out of shared message records.
- [x] 1.3 Preserve ordinary task, queue and job-control behavior.

## 2. Verification

- [x] 2.1 Exercise a running disposable job and an owner status question through Conversation.
- [x] 2.2 Check mixed, unknown and foreign requests, changes of attempt, replays, revocation and restart.
- [x] 2.3 Verify the private question and reply issue no model turn and send no job control. Track the real installed acceptance in [Hub #2115](https://github.com/jimmie-potts/agent-device-hub/issues/2115).
