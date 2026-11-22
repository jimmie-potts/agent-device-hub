// The shared spend of today and this month on the Conversation page (Hub #2024), read from the module's private `spend`
// content route after each assistant-state revision, so it follows every saved call without polling.
import {useEffect, useState} from 'react';
import type {FrontendContext} from '@jimmie-potts/sdk/frontend';
import {dollars} from '../assistant/limits.js';
import type {SpendPeriod, SpendTotals} from '../assistant/spend-contract.js';

export const SPEND_PATH = '/modules/companions/content/spend';
const PERIOD = {day: /^\d{4}-\d{2}-\d{2}$/, month: /^\d{4}-\d{2}$/} as const;
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function periodOf(value: unknown, shape: RegExp): SpendPeriod | undefined {
  if (!object(value) || typeof value.period !== 'string' || !shape.test(value.period)) return undefined;
  const {spentMicros, limitMicros, unreported, unreportedMicros} = value;
  if (!amount(spentMicros) || !amount(limitMicros) || !amount(unreported) || !amount(unreportedMicros)) return undefined;
  return {period: value.period, spentMicros, limitMicros, unreported, unreportedMicros};
}
/** The route's answer, or undefined for anything else, which the page shows as unknown. */
export function decodeSpend(value: unknown): SpendTotals | undefined {
  if (!object(value) || value.version !== 1) return undefined;
  const day = periodOf(value.day, PERIOD.day), month = periodOf(value.month, PERIOD.month);
  return day === undefined || month === undefined ? undefined : {version: 1, day, month};
}
/** "$1.23 of $20.00", naming the reservations still counted for calls whose usage was not reported. */
export function spendText(period: SpendPeriod): string {
  const counted = `${dollars(period.spentMicros)} of ${dollars(period.limitMicros)}`;
  if (period.unreported === 0) return counted;
  return `${counted}, including ${dollars(period.unreportedMicros)} reserved for ${String(period.unreported)} ${period.unreported === 1 ? 'call' : 'calls'} without reported usage`;
}
/** The limit that refuses a new paid message now, as a short notice, or undefined below both limits. */
export function spendNotice(spend: SpendTotals | undefined): string | undefined {
  if (spend === undefined) return undefined;
  if (spend.day.spentMicros >= spend.day.limitMicros) return `The daily spend limit of ${dollars(spend.day.limitMicros)} is reached. New messages can start after midnight, the runtime host's local time.`;
  if (spend.month.spentMicros >= spend.month.limitMicros) return `The monthly spend limit of ${dollars(spend.month.limitMicros)} is reached. New messages can start when the next month begins.`;
  return undefined;
}
/** Reads the spend once per assistant-state revision while the page is connected; a failed read shows unknown. */
export function useSpend(api: FrontendContext['api'], ready: boolean, revision: number | undefined): SpendTotals | undefined {
  const [spend, setSpend] = useState<SpendTotals>();
  useEffect(() => {
    if (!ready) {setSpend(undefined); return;}
    let active = true;
    void api.read(SPEND_PATH).then(value => {if (active) setSpend(decodeSpend(value));}, () => {if (active) setSpend(undefined);});
    return () => {active = false;};
  }, [api, ready, revision]);
  return spend;
}
