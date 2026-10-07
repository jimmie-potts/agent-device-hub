// Red stub for Hub #920's PR #942 fix round.
export class BurstLimit {
  constructor(readonly limit: number, readonly windowMs: number, readonly now: () => number) {}
  allow(): boolean { return true; }
}
