// The scenario catalog's shard selection (Hub #1674): `BUNNY_SCENARIO_SHARD=i/n` makes catalog.test.ts generate only
// shard i of n of its scenario and transport pairs, so n processes can run the catalog at once. Without it the file
// generates every pair. The split is pure and deterministic; scripts/scenario-shards.mjs runs every shard at once.

/** The environment variable that selects one shard of the catalog's pairs. */
export const SHARD_VARIABLE = 'BUNNY_SCENARIO_SHARD';

/** Shard `index` of `count`, both counted from 1. */
export type Shard = {readonly index: number; readonly count: number};

/**
 * The shard a selection names, or undefined when there is none. `total` is the number of pairs to split: a selection
 * that is malformed, out of range or would leave a shard empty throws, so that a run never passes with no tests.
 */
export function parseShard(text: string | undefined, total: number): Shard | undefined {
  if (text === undefined) return undefined;
  const match = /^([1-9]\d{0,3})\/([1-9]\d{0,3})$/.exec(text);
  if (match === null) throw new Error(`${SHARD_VARIABLE} must be <i>/<n>, such as 1/4, not ${JSON.stringify(text)}`);
  const [index, count] = [Number(match[1]), Number(match[2])];
  if (index > count) throw new Error(`${SHARD_VARIABLE}=${text} names shard ${String(index)} of only ${String(count)}`);
  if (count > total) throw new Error(`${SHARD_VARIABLE}=${text} asks for ${String(count)} shards of only ${String(total)} tests`);
  return {index, count};
}

/**
 * The items of one shard, in their order: every `count`th item, starting at item `index`. Round-robin over the
 * ordered list spreads each module's run of slow scenarios across the shards, and the shards' sizes differ by one at most.
 */
export function shardOf<T>(items: readonly T[], shard: Shard): T[] {
  return items.filter((_, position) => position % shard.count === shard.index - 1);
}
