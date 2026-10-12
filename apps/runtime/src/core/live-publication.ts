// First publication eligibility, shared by automation and the optional companion producer. No durable replay marks.
import type {Message} from '@jimmie-potts/event-contracts/v2';
export class LivePublication {
  readonly #live = new Set<string>();
  readonly #publishing = new Set<string>();
  committed(messages: readonly Message<unknown>[], types: ReadonlySet<string>): void {
    for (const message of messages) if (message.kind === 'occurrence' && types.has(message.type)) {
      this.#live.add(message.id);
      if (this.#live.size > 4096) {const oldest = this.#live.values().next().value; if (oldest !== undefined) this.#live.delete(oldest);}
    }
  }
  publishing(message: Message<unknown>): () => void {
    if (this.#live.delete(message.id)) {
      this.#publishing.add(message.id);
      if (this.#publishing.size > 4096) {const oldest = this.#publishing.values().next().value; if (oldest !== undefined) this.#publishing.delete(oldest);}
    }
    return () => {this.#publishing.delete(message.id); this.#live.clear();};
  }
  take(id: string): boolean {return this.#publishing.delete(id);}
  ended(messages: readonly Message<unknown>[]): void {for (const message of messages) this.#live.delete(message.id);}
  clear(): void {this.#live.clear(); this.#publishing.clear();}
}
