import { afterEach, expect, it, vi } from 'vitest';
import { systemClock } from '../../packages/device/src/index.js';

afterEach(() => { vi.useRealTimers(); });
it('does not collapse a long scheduled delay to an immediate callback', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const called = vi.fn();
  const cancel = systemClock.schedule(2 ** 31 + 50, called);
  vi.advanceTimersByTime(100);
  expect(called).not.toHaveBeenCalled();
  vi.advanceTimersByTime(2 ** 31 - 50);
  expect(called).toHaveBeenCalledTimes(1);
  cancel();
  expect(vi.getTimerCount()).toBe(0);
});
it('cancels the remaining interval after a long delay has been split', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const called = vi.fn();
  const cancel = systemClock.schedule(2 ** 31 + 50, called);
  vi.advanceTimersByTime(2 ** 31 - 1);
  cancel(); cancel();
  vi.advanceTimersByTime(100);
  expect(called).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
