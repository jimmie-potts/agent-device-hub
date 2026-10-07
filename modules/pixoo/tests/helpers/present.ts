// A test's way past `noUncheckedIndexedAccess` without a non-null assertion: the value, or a failed test naming what was
// missing.
export function present<T>(value: T | null | undefined, what = 'the value'): T {
  if (value === undefined || value === null) throw new Error(`${what} is missing`);
  return value;
}
