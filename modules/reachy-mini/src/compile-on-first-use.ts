import type {ValidateFunction} from 'ajv/dist/2020.js';

const compilers: (() => unknown)[] = [];

/**
 * A validator that compiles its schema on the first call and reuses it afterwards, so importing the module compiles
 * no schema (Hub #1686). A malformed schema then fails on first use, so `compileAll` keeps it failing in the tests.
 */
export function compileOnFirstUse<T>(compile: () => ValidateFunction<T>): (data: unknown) => data is T {
  let compiled: ValidateFunction<T> | undefined;
  const compiler = (): ValidateFunction<T> => compiled ??= compile();
  compilers.push(compiler);
  return (data: unknown): data is T => compiler()(data);
}

/** Compiles every validator created so far and returns how many there are. */
export function compileAll(): number {
  for (const compiler of compilers) compiler();
  return compilers.length;
}
