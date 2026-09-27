// Shared pieces for the preflight gates: the gate record, the read wrapper that
// turns a failed read into a read-failure status, and revision formatting.
import { ReadFailure } from './github.mjs';

/** A local proof file that cannot be read; carries only a label and an error code. */
export class LocalReadFailure extends Error {
  constructor(what, detail) {
    super(`${what}: ${detail}`);
    this.name = 'LocalReadFailure';
    this.what = what;
    this.detail = detail;
  }
}

export const SDLC = 'docs/sdlc.md';
export const DEPOT_APP = 'depot-code-access';
export const GUIDE_ROOT = 'docs/work-guide/';
export const COMPARE_FILE_LIMIT = 300;

/** First 12 characters of a revision, or `unknown`. */
export function short(sha) {
  return sha ? String(sha).slice(0, 12) : 'unknown';
}

export class Gate {
  constructor(id, title, rule) {
    this.id = id;
    this.title = title;
    this.rule = rule;
    this.status = 'satisfied';
    this.reasons = [];
    this.evidence = {};
  }

  unresolved(reason) {
    if (this.status !== 'read-failure') this.status = 'unresolved';
    this.reasons.push(reason);
  }

  note(reason) {
    this.reasons.push(reason);
  }

  notApplicable(reason) {
    this.status = 'not-applicable';
    this.reasons.push(reason);
  }

  notEvaluated(reason) {
    this.status = 'read-failure';
    this.reasons.push(`not evaluated: ${reason}`);
  }

  toJSON() {
    return { id: this.id, title: this.title, rule: this.rule, status: this.status, reasons: this.reasons, evidence: this.evidence };
  }
}

/** Run a read for a gate; a GitHub or local read failure marks the gate and is recorded. */
export function createReader(readFailures) {
  return async function read(gate, fn) {
    try {
      return { ok: true, value: await fn() };
    } catch (error) {
      if (!(error instanceof ReadFailure || error instanceof LocalReadFailure)) throw error;
      gate.status = 'read-failure';
      gate.reasons.push(`read failure: ${error.what}: ${error.detail}`);
      readFailures.push({ gate: gate.id, what: error.what, detail: error.detail });
      return { ok: false };
    }
  };
}

/** Paths a list of changed files touches, including both sides of renames. */
export function touchedPaths(files) {
  return [...new Set(files.flatMap(file => [file.filename, file.previous_filename].filter(Boolean)))];
}
