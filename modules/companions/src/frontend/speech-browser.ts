import type {SpeechQualification} from '../speech-qualification.js';

const callable = (value: unknown): value is (...args: unknown[]) => unknown => typeof value === 'function';

/** Browser hints are checked locally and are never sent to the runtime. */
export async function qualifiedChrome(receipt: SpeechQualification, browser: object = navigator): Promise<boolean> {
  if (!('userAgentData' in browser)) return false;
  const hints = browser.userAgentData;
  if (typeof hints !== 'object' || hints === null || !('platform' in hints) || hints.platform !== 'macOS'
    || !('getHighEntropyValues' in hints) || !callable(hints.getHighEntropyValues)) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value: unknown = await Promise.race([hints.getHighEntropyValues(['fullVersionList']), new Promise<undefined>(resolve => {
      timer = setTimeout(() => {resolve(undefined);}, 5000);
    })]);
    if (typeof value !== 'object' || value === null || !('fullVersionList' in value) || !Array.isArray(value.fullVersionList)) return false;
    return value.fullVersionList.some((entry: unknown) => typeof entry === 'object' && entry !== null && 'brand' in entry && entry.brand === 'Google Chrome'
      && 'version' in entry && entry.version === receipt.browserVersion);
  } catch {return false;}
  finally {clearTimeout(timer);}
}
