// Serialized admission (Hub #1142). A check made before an `await` can be stale
// by the time the effect runs: another operation on the same device may finish
// in between and change what is admissible (#1074 285-F1, #1134 F1). Work for
// one key runs one at a time, and the admission state it needs is read inside
// its turn through `fresh`, which refuses a read once the turn has ended.

/** Reads admission state inside the current turn. It throws after the turn ends, so a read cannot be carried out of it. */
export type Fresh = <S>(read: () => S) => S;

export type SerializedAdmission = <T>(key: string, work: (fresh: Fresh) => T | Promise<T>) => Promise<T>;

/** Create a keyed admission: work for the same key runs in submission order, one turn at a time. */
export function serializedAdmission(): SerializedAdmission {
  const tails = new Map<string, Promise<unknown>>();
  return async <T>(key: string, work: (fresh: Fresh) => T | Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    let release = (): void => {};
    const turn = new Promise<void>(resolve => { release = resolve; });
    const tail = previous.then(() => turn);
    tails.set(key, tail);
    await previous;
    let open = true;
    const fresh: Fresh = read => {
      if (!open) throw new Error(`serializedAdmission(${key}): admission state read after its turn ended`);
      return read();
    };
    try {
      return await work(fresh);
    } finally {
      open = false;
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}

