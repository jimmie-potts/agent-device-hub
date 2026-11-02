// During a gap only the outer request ID and a possible initialize matter. Keep
// a bounded copy of the envelope, replacing nested containers with empty ones.
// It is never a source of receipt evidence. An unreadable envelope ends observation.
const MAX_ENVELOPE = 4096, MAX_DEPTH = 128;
export class OversizedClientEnvelope {
  readonly #header = Buffer.alloc(MAX_ENVELOPE);
  readonly #ends: number[] = [];
  #length = 0;
  #quoted = false;
  #escaped = false;

  feed(bytes: Uint8Array): void {
    for (const byte of bytes) {
      const depth = this.#ends.length;
      if (this.#quoted) {
        if (depth <= 1) this.#keep(byte);
        if (this.#escaped) this.#escaped = false;
        else if (byte === 92) this.#escaped = true;
        else if (byte === 34) this.#quoted = false;
        continue;
      }
      if (byte === 125 || byte === 93) {
        if (this.#ends.pop() !== byte) throw new Error('invalid envelope');
        if (depth <= 2) this.#keep(byte);
        continue;
      }
      if (depth <= 1) this.#keep(byte);
      if (byte === 34) this.#quoted = true;
      else if (byte === 123 || byte === 91) {
        if (depth === MAX_DEPTH) throw new Error('envelope nesting limit');
        this.#ends.push(byte === 123 ? 125 : 93);
      }
    }
  }

  finish(): unknown {
    if (this.#quoted || this.#ends.length !== 0) throw new Error('incomplete envelope');
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(this.#header.subarray(0, this.#length)));
  }

  #keep(byte: number): void {
    if (this.#length === MAX_ENVELOPE) throw new Error('envelope limit');
    this.#header[this.#length++] = byte;
  }
}
