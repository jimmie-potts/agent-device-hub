import {createHash} from 'node:crypto';
import {lstat, mkdir, open, readdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {errorBody, type ErrorBody, type ErrorCode} from '@jimmie-potts/event-contracts/v2';
import {MAX_UPLOAD_BYTES, type ModuleStagedUpload, type ModuleUploadRequest} from '@jimmie-potts/sdk';
import {nameSchema} from '../library/contracts.js';

const HASH = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const refuse = (code: ErrorCode): ErrorBody => errorBody(code, {detail: 'the Pixoo upload was refused'});
type ActiveInput = {requestId: string; file: string; owned: boolean; releasing?: Promise<void>};
type UploadOptions = {folder: string; target: string; signal: AbortSignal; pending: (requestId: string) => boolean; failed: (error: unknown) => void};

/** One temporary input, coupled to the existing core command identity and owner outcome rather than another tracker. */
export class PixooUploads {
  readonly #options: UploadOptions;
  readonly #incoming: string;
  #active: ActiveInput | undefined;
  #ready = false;

  constructor(options: UploadOptions) {
    this.#options = options;
    this.#incoming = join(options.folder, 'incoming');
  }

  /** Called after unfinished commands have been reported uncertain; unrelated names and media are left alone. */
  async recover(): Promise<void> {
    try {
      await mkdir(this.#incoming, {recursive: true, mode: 0o700});
      if (!(await lstat(this.#incoming)).isDirectory()) throw new Error('upload staging is not a directory');
      for (const entry of await readdir(this.#incoming, {withFileTypes: true})) {
        if (entry.isFile() && HASH.test(entry.name)) await rm(join(this.#incoming, entry.name));
      }
      this.#ready = true;
    } catch (error) {
      this.#options.failed(error);
    }
  }

  async stage(request: ModuleUploadRequest): Promise<ModuleStagedUpload | ErrorBody> {
    if (!this.#ready) return refuse('unavailable');
    if (request.target !== this.#options.target) return refuse('not-found');
    const name = nameSchema.safeParse(request.name);
    if (!name.success || !REQUEST_ID.test(request.requestId)) return refuse('invalid-request');
    if (!(request.bytes instanceof Uint8Array) || request.bytes.byteLength === 0) return refuse('invalid-request');
    if (request.bytes.byteLength > MAX_UPLOAD_BYTES) return refuse('too-large');
    const signal = AbortSignal.any([request.signal, this.#options.signal]);
    if (signal.aborted) return refuse('cancelled');
    if (this.#active !== undefined) return refuse('capacity');
    // Own the bytes before yielding, so the hash and file cannot disagree if a caller changes its input buffer.
    const bytes = Buffer.from(request.bytes);
    const file = createHash('sha256').update(bytes).digest('hex');
    const active: ActiveInput = {requestId: request.requestId, file, owned: false};
    this.#active = active;
    try {
      const handle = await open(join(this.#incoming, file), 'wx', 0o600);
      active.owned = true;
      try { await handle.writeFile(bytes, {signal}); } finally { await handle.close(); }
      if (signal.aborted) {
        await this.#release(active);
        return refuse('cancelled');
      }
    } catch (error) {
      await this.#release(active);
      if (signal.aborted) return refuse('cancelled');
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return refuse('capacity');
      this.#options.failed(error);
      return refuse('internal');
    }
    return {
      data: {change: {operation: 'import', name: name.data, content: {staged: {file, bytes: bytes.length}}}},
      finish: async reply => {
        if (this.#active !== active) return;
        if ('error' in reply) {
          if (reply.error.code === 'uncertain-result') return;
        } else {
          if (reply.requestId !== active.requestId) return;
          try { if (this.#options.pending(active.requestId)) return; } catch (error) { this.#options.failed(error); return; }
        }
        await this.#release(active);
      },
    };
  }

  /** Release only the input named by this core command, after its terminal outcome has committed. */
  async completed(source: string, requestId: string, file: string): Promise<void> {
    const active = this.#active;
    if (source === 'bunny/core' && active?.requestId === requestId && active.file === file) await this.#release(active);
  }

  async #release(active: ActiveInput): Promise<void> {
    if (this.#active !== active) return;
    active.releasing ??= (async () => {
      try {
        if (active.owned) await rm(join(this.#incoming, active.file), {force: true});
        if (this.#active === active) this.#active = undefined;
      } catch (error) {
        // Keep the occupied slot on failure. Never turn an accepted reply/outcome into a cleanup refusal.
        this.#options.failed(error);
      }
    })();
    await active.releasing;
  }
}
