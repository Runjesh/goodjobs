import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { expectsRealBackend, isSameOriginApiMode } from '../env';
import { isMockEnabled } from '../mockBackend';

describe('API env / mock gating', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('expectsRealBackend when VITE_USE_SAME_ORIGIN_API is true', () => {
    vi.stubEnv('VITE_USE_SAME_ORIGIN_API', 'true');
    vi.stubEnv('VITE_API_BASE_URL', '');
    expect(isSameOriginApiMode()).toBe(true);
    expect(expectsRealBackend()).toBe(true);
    expect(isMockEnabled()).toBe(false);
  });

  it('expectsRealBackend when VITE_API_BASE_URL is set', () => {
    vi.stubEnv('VITE_USE_SAME_ORIGIN_API', '');
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.com');
    expect(expectsRealBackend()).toBe(true);
    expect(isMockEnabled()).toBe(false);
  });
});
