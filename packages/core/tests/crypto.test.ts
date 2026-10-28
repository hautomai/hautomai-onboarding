import { describe, expect, it } from 'vitest';
import { encryptJson, decryptJson, safeEqual } from '@hautomai/core';

describe('crypto', () => {
  const secret = 'test-secret-key-0123456789abcdef'; // gitleaks:allow test fixture

  it('round-trips a config object', () => {
    const config = { name: 'Acme', crm: { provider: 'hubspot', credentials: { accessToken: 'secret' } } };
    const token = encryptJson(secret, config);
    expect(token).not.toContain('secret');
    expect(decryptJson<typeof config>(secret, token)).toEqual(config);
  });

  it('produces different ciphertext each time', () => {
    const a = encryptJson(secret, { x: 1 });
    const b = encryptJson(secret, { x: 1 });
    expect(a).not.toBe(b);
  });

  it('refuses to operate without a secret', () => {
    expect(() => encryptJson('', {})).toThrow(/ENC_KEY/);
  });

  it('throws on tampered payloads', () => {
    const token = encryptJson(secret, { hi: 'there' });
    const iv = token.split('.')[0];
    const tag = token.split('.')[1];
    expect(() => decryptJson(secret, `${iv}.${tag}.XX`)).toThrow();
  });
});

describe('safeEqual', () => {
  it('compares equal strings true, unequal false', () => {
    expect(safeEqual('abcdef', 'abcdef')).toBe(true);
    expect(safeEqual('abcdef', 'abcdeg')).toBe(false);
    expect(safeEqual('a', 'abc')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});