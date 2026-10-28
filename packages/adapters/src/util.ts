import type { Credentials } from '@hautomai/core';

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

/** Pull the first present, non-empty string from a list of candidates. */
export function firstNonEmpty(...candidates: Array<string | undefined | null>): string | undefined {
  for (const c of candidates) {
    if (c && String(c).trim().length > 0) return String(c).trim();
  }
  return undefined;
}

export function credString(creds: Credentials | undefined, key: string): string | undefined {
  const raw = creds?.[key];
  if (raw === undefined || raw === null) return undefined;
  return String(raw);
}

export function credNumber(creds: Credentials | undefined, key: string, fallback: number): number {
  const raw = creds?.[key];
  if (raw === undefined || raw === null) return fallback;
  const n = Number(raw);
  return Number.isNaN(n) ? fallback : n;
}

export function credBool(creds: Credentials | undefined, key: string, fallback: boolean): boolean {
  const raw = creds?.[key];
  if (raw === undefined || raw === null) return fallback;
  return raw === true || raw === 'true' || raw === '1';
}

const MAX_BODY = 5 * 1024 * 1024;

export async function httpJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  const body =
    text.length === 0 ? null : (JSON.parse(text) as unknown);
  if (!res.ok) {
    const detail =
      body && typeof body === 'object' && 'message' in (body as object)
        ? String((body as { message: unknown }).message)
        : text.slice(0, 500);
    throw new Error(`HTTP ${res.status} from ${url}: ${detail}`);
  }
  return body as T;
}

export function toBuffer(data: Buffer | Uint8Array | string): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

export { MAX_BODY };