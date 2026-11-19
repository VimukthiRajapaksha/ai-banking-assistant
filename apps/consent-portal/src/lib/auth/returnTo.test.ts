import { describe, expect, it } from 'vitest';
import { safeReturnTo } from './returnTo';

describe('safeReturnTo', () => {
  it('keeps same-origin paths', () => {
    expect(safeReturnTo('/consents?status=pending')).toBe('/consents?status=pending');
  });

  it.each([null, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/auth/login'])('refuses %s', (value) => {
    expect(safeReturnTo(value)).toBe('/');
  });
});
