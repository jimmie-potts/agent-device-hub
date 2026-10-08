// Reload protection stores action identities only, never a command's values or a credential (Hub #922).
export type AttemptIdentity = {requestId: string; target: string; family: string};
export const ATTEMPTS_KEY = 'bunny-device-attempts';
export function rememberAttempt(attempt: AttemptIdentity, storage: Pick<Storage, 'getItem' | 'setItem'>): boolean {
  try {
    const value: unknown = JSON.parse(storage.getItem(ATTEMPTS_KEY) ?? '[]');
    const others: unknown[] = Array.isArray(value) ? (value as unknown[]).filter((item: unknown) => typeof item === 'object' && item !== null && 'target' in item && item.target !== attempt.target) : [];
    storage.setItem(ATTEMPTS_KEY, JSON.stringify([...others, {target: attempt.target, family: attempt.family, requestId: attempt.requestId}]));
    return true;
  } catch { return false; }
}
