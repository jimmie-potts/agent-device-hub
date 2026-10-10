import assert from 'node:assert/strict';
export function deferred<T>(): {promise: Promise<T>; resolve: (value: T) => void} {
  let complete: ((value: T) => void) | undefined;
  const promise = new Promise<T>(resolve => {complete = resolve;});
  return {promise, resolve: value => {assert.ok(complete !== undefined); complete(value);}};
}
