import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { APP_REFRESH_EVENT, emitAppRefresh, onAppRefresh } from '../events';

describe('events', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('dispatches goodjobs:refresh', () => {
    emitAppRefresh();
    expect(window.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: APP_REFRESH_EVENT }));
  });

  it('subscribes and unsubscribes', () => {
    const handler = vi.fn();
    const off = onAppRefresh(handler);
    expect(window.addEventListener).toHaveBeenCalledWith(APP_REFRESH_EVENT, handler);
    off();
    expect(window.removeEventListener).toHaveBeenCalledWith(APP_REFRESH_EVENT, handler);
  });
});
