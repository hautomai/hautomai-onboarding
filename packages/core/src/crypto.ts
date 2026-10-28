import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const IV_LEN = 12;

export function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function encryptJson(secret: string, value: unknown): string {
  if (!secret) {
    throw new Error('ENC_KEY is not set. Refusing to encrypt config without a master key.');
  }
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value), 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decryptJson<T = unknown>(secret: string, token: string): T {
  if (!secret) {
    throw new Error('ENC_KEY is not set. Refusing to decrypt config without a master key.');
  }
  const [ivB64, tagB64, dataB64] = token.split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed encrypted payload.');
  }
  const key = deriveKey(secret);
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as T;
}

function toSafeBuffer(a: string, b: string): [Buffer, Buffer] {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  const len = Math.max(ba.length, bb.length);
  return [
    Buffer.concat([ba, Buffer.alloc(len - ba.length)]),
    Buffer.concat([bb, Buffer.alloc(len - bb.length)]),
  ];
}

/** Constant-time comparison that never throws on length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const [ba, bb] = toSafeBuffer(a, b);
  return timingSafeEqual(ba, bb);
}