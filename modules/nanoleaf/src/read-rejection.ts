const REQUEST_ERROR_CATEGORIES: ReadonlyMap<string, RequestCategory> = new Map([
  ['HPE_INVALID_CONSTANT', 'http-protocol'],
  ['HPE_INVALID_HEADER_TOKEN', 'http-protocol'],
  ['ETIMEDOUT', 'timeout'],
  ['ECONNREFUSED', 'connection-refused'],
  ['ECONNRESET', 'connection-reset'],
  ['EHOSTUNREACH', 'host-unreachable'],
  ['ENETUNREACH', 'network-unreachable'],
]);

type RequestCategory = 'http-protocol' | 'timeout' | 'connection-refused' | 'connection-reset' | 'host-unreachable' | 'network-unreachable' | 'other';
export type ReadRejection =
  | {stage: 'setup'; category: 'invalid-input' | 'other'}
  | {stage: 'request'; category: RequestCategory}
  | {stage: 'response-body'; category: 'interrupted' | 'other'}
  | {stage: 'decode'; category: 'invalid-json' | 'other'}
  | {stage: 'unknown'; category: 'other'};

export type ReportReadRejection = (classification: ReadRejection) => void;

function ownCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    if (descriptor !== undefined && Object.hasOwn(descriptor, 'value')) {
      const value: unknown = descriptor.value;
      if (typeof value === 'string') return value;
    }
  } catch {
    // A rejected value can refuse descriptor inspection.
  }
  return undefined;
}

export function classifyHttpError(stage: 'request' | 'response-body', error: unknown): ReadRejection {
  const code = ownCode(error);
  if (stage === 'response-body') return {stage, category: code === 'ECONNRESET' ? 'interrupted' : 'other'};
  return {stage, category: code === undefined ? 'other' : REQUEST_ERROR_CATEGORIES.get(code) ?? 'other'};
}

export function reportReadRejection(report: ReportReadRejection | undefined, classify: () => ReadRejection): void {
  if (report === undefined) return;
  try {
    report(classify());
  } catch {
    // Diagnostics cannot replace a rejection.
  }
}
