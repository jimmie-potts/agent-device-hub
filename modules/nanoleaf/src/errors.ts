// The Python bridge's exception kinds, kept so callers can tell a refusal from a storage or device failure.

/** Python's ValueError: input or saved state that an operation refuses. Its message is safe to show the operator. */
export class ValueError extends Error {
  override name = 'ValueError';
}

/** shared_input.FeedError: a fixed code, never host error text or response content. */
export class FeedError extends ValueError {
  override name = 'FeedError';
}

/** enrollment.Partial: a failure after the first state write; rerunning the same operation finishes the change. */
export class Partial extends Error {
  override name = 'Partial';
  constructor(cause: unknown) {
    super('The operation stopped after changing saved state.', {cause});
  }
}

/** A fixed, safe failure message. The original transport error stays in memory. */
export class DeviceUnreachable extends Error {
  override name = 'DeviceUnreachable';
  constructor(cause?: unknown) {
    super('The device did not answer.', cause === undefined ? undefined : {cause});
  }
}

/** A GET exceeded a deadline enforced by the Nanoleaf link or transport. */
export class DeviceReadDeadline extends DeviceUnreachable {}
