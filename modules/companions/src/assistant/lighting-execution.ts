import {containsControlQuote} from './catalog-grounding.js';
import type {LightingFamily, LightingSetting} from './lighting-control.js';
import type {ToolInputSchema} from './tool-types.js';

const executions = ['immediate', 'conditional-or-future', 'unresolved'] as const;
const slots = ['none', 'on', 'percent', 'kelvin', 'hue', 'saturation'] as const;
export type LightingExecution = typeof executions[number];
export type LightingSlot = Exclude<typeof slots[number], 'none'>;
export type LightingIntent = {intent: 'read' | 'set'; execution: LightingExecution; condition: string; missing: typeof slots[number]};

export type LightingDecision = Omit<LightingIntent, 'missing'> & {
  requestId: string;
  requestRevision: number;
  family: LightingFamily;
  owner?: string;
  target?: string;
  completed?: LightingSetting;
};

export const lightingIntentFields = {
  intent: {type: 'string', enum: ['read', 'set'], description: 'Interpret the complete current owner request and its authorized context. Use read for a status question and set for a requested change.'},
  execution: {type: 'string', enum: executions, description: 'Use immediate only for a change requested now, conditional-or-future for a condition or later time, and unresolved when intent or timing is unclear. An answer to a setting question does not change the original timing.'},
  condition: {type: 'string', description: 'Copy the exact condition or later time from the original current owner request for conditional-or-future. Use an empty string otherwise.'},
  missing: {type: 'string', enum: slots, description: 'Use none for a complete value or read. Name the single missing setting for a requested change, including when it was requested conditionally.'},
} as const satisfies ToolInputSchema['properties'];

export const powerLiteralField = {
  type: 'string', description: 'Quote the owner’s wording that supplies power. For an explicit on or off value, copy that word. Leave empty while asking or reading.',
} as const satisfies ToolInputSchema['properties'][string];

export function lightingIntent(input: Record<string, unknown>): LightingIntent | undefined {
  const {intent, execution, condition, missing} = input;
  const timing = executions.find(value => value === execution);
  const slot = slots.find(value => value === missing);
  if ((intent !== 'read' && intent !== 'set') || timing === undefined || slot === undefined ||
      typeof condition !== 'string' || condition !== condition.trim() || condition.length > 256 ||
      (timing === 'conditional-or-future') !== (condition !== '') ||
      intent === 'read' && (slot !== 'none' || timing !== 'immediate')) return undefined;
  return {intent, execution: timing, condition, missing: slot};
}

export function lightingConditionMatches(decision: LightingIntent, request: string): boolean {
  return decision.condition === '' || containsControlQuote(request, decision.condition);
}
