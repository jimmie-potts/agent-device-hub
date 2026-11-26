## Why

Hub #2172 needs a disposable way to qualify a cloud coding destination before selecting a real provider or account.

## What Changes

- Make cloud enrollment insufficient for routing. Require scoped cloud authority and a qualified workspace.
- Exercise bounded workspace creation and verified cleanup through a disposable provider.
- Keep real activation gated on the owner's provider, account, authentication and compute/storage allowance decisions.

## Capabilities

### Modified Capabilities

- `bunny-coding-delegation`: apply cloud-specific eligibility to Auto and pinned routing.

## Impact

The Companions coordinator and selector gain a cloud admission check. The installed module supplies no cloud authority. Existing Mac and PC routes continue to use their current policy.
