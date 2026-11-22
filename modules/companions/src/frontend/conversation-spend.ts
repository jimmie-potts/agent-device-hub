// The shared spend of today and this month on the Conversation page (Hub #2024), read from the module's private `spend`
// content route after each assistant-state revision, so it follows every saved call without polling.
import {useEffect, useState} from 'react';
import type {FrontendContext} from '@jimmie-potts/sdk/frontend';
import {dollars} from '../assistant/limits.js';
import type {SpendPeriod, SpendView} from '../assistant/spend-contract.js';

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
const MODEL = /^[a-z0-9][a-z0-9.-]{0,127}$/;
function paidOf(value: unknown): SpendView['paid'] | undefined {
  if (value === null) return null;
  if (!object(value) || typeof value.model !== 'string' || !MODEL.test(value.model) || (value.minimumMicros !== null && !amount(value.minimumMicros))) return undefined;
  return {model: value.model, minimumMicros: value.minimumMicros};
}
/** The route's answer, or undefined for anything else, which the page shows as unknown. */
export function decodeSpend(value: unknown): SpendView | undefined {
  if (!object(value) || value.version !== 1) return undefined;
  const day = periodOf(value.day, PERIOD.day), month = periodOf(value.month, PERIOD.month), paid = paidOf(value.paid);
  return day === undefined || month === undefined || paid === undefined ? undefined : {version: 1, day, month, paid};
}
/** "$1.23 of $20.00", naming the reservations still counted for calls whose usage was not reported. */
export function spendText(period: SpendPeriod): string {
  const counted = `${dollars(period.spentMicros)} of ${dollars(period.limitMicros)}`;
  if (period.unreported === 0) return counted;
  return `${counted}, including ${dollars(period.unreportedMicros)} reserved for ${String(period.unreported)} ${period.unreported === 1 ? 'call' : 'calls'} without reported usage`;
}
/** The prices fact: configured, missing for the paid model, or not needed by the synthetic provider. */
export function priceText(spend: SpendView | undefined): string {
  if (spend === undefined) return 'Unknown';
  if (spend.paid === null) return 'Not needed (synthetic calls)';
  return spend.paid.minimumMicros === null ? `Missing for ${spend.paid.model}; paid messages are refused` : `Configured for ${spend.paid.model}`;
}
/**
 * Why a new paid message would be refused now, as a short notice, or undefined: no price for the paid model, or a limit
 * whose remainder is below the smallest first call, as the engine refuses it.
 */
export function spendNotice(spend: SpendView | undefined): string | undefined {
  if (spend === undefined || spend.paid === null) return undefined;
  const least = spend.paid.minimumMicros;
  if (least === null) return `No price is configured for ${spend.paid.model}, so new messages are refused. Add it to assistant.prices in the private configuration.`;
  if (spend.day.spentMicros + least > spend.day.limitMicros || spend.day.spentMicros >= spend.day.limitMicros) {
    return `The daily spend limit of ${dollars(spend.day.limitMicros)} is reached. New messages can start after midnight, the runtime host's local time.`;
  }
  if (spend.month.spentMicros + least > spend.month.limitMicros || spend.month.spentMicros >= spend.month.limitMicros) {
    return `The monthly spend limit of ${dollars(spend.month.limitMicros)} is reached. New messages can start when the next month begins.`;
  }
  return undefined;
}
/** Reads the spend once per assistant-state revision while the page is connected; a failed read shows unknown. */
export function useSpend(api: FrontendContext['api'], ready: boolean, revision: number | undefined): SpendView | undefined {
  const [spend, setSpend] = useState<SpendView>();
  useEffect(() => {
    if (!ready) {setSpend(undefined); return;}
    let active = true;
    void api.read(SPEND_PATH).then(value => {if (active) setSpend(decodeSpend(value));}, () => {if (active) setSpend(undefined);});
    return () => {active = false;};
  }, [api, ready, revision]);
  return spend;
}
