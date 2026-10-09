// Local reader errors only; the module adapter converts these to the shared registry.
export class WisprError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
