import { readFileSync } from 'node:fs';
import { Ajv2020 } from 'ajv/dist/2020.js';

export const INSTALL_RECEIPT_VERSION = 'install-receipt/1.0';
export const installReceiptSchema = JSON.parse(readFileSync(new URL('../schemas/install-receipt-v1.schema.json', import.meta.url), 'utf8'));
const shape = new Ajv2020({ strict: true, allErrors: true }).compile(installReceiptSchema);

/** Validates receipt shape and cross-field evidence consistency, without inspecting a host. */
export function validateInstallReceipt(value: unknown): boolean {
  if (!jsonValue(value) || !shape(value)) return false;
  const receipt = value as { startedAt: string; updatedAt: string; completedAt: string | null; outcome: string;
    running: { identity: unknown }; target: unknown; previous: unknown; rollback: { status: string } };
  const times = [receipt.startedAt, receipt.updatedAt, receipt.completedAt].filter((t): t is string => t !== null);
  if (times.some(t => !Number.isFinite(Date.parse(t)) || new Date(t).getUTCFullYear() < 1 || new Date(t).toISOString().replace('.000Z', 'Z') !== t)) return false;
  if (receipt.updatedAt < receipt.startedAt || (receipt.completedAt !== null && receipt.completedAt !== receipt.updatedAt)) return false;
  if (receipt.outcome === 'succeeded' && !equal(receipt.running.identity, receipt.target)) return false;
  if (receipt.rollback.status === 'succeeded' && !equal(receipt.running.identity, receipt.previous)) return false;
  return true;
}

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(k => Object.hasOwn(right, k) && equal(left[k], right[k]));
}

function jsonValue(value: unknown): boolean {
  const pending: [unknown, number][] = [[value, 0]];
  while (pending.length) {
    const [item, depth] = pending.pop()!;
    if (depth > 32) return false;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') continue;
    if (typeof item === 'number') { if (!Number.isFinite(item)) return false; continue; }
    if (!Array.isArray(item) && (typeof item !== 'object' || Object.getPrototypeOf(item) !== Object.prototype)) return false;
    for (const child of Object.values(item)) pending.push([child, depth + 1]);
  }
  return true;
}
