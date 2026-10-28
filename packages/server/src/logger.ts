import type { Logger } from '@hautomai/core';

/** Minimal structured console logger (Pino-like shape, no dependency). */
export function createLogger(name = 'hautomai'): Logger {
  const ts = () => new Date().toISOString();
  const write = (level: string, msg: string, meta?: Record<string, unknown>) => {
    const line = `${ts()} ${level.toUpperCase().padEnd(5)} [${name}] ${msg}`;
    const rest = meta && Object.keys(meta).length ? ` ${safeStringify(meta)}` : '';
    if (level === 'error') console.error(line + rest);
    else if (level === 'warn') console.warn(line + rest);
    else console.log(line + rest);
  };
  return {
    error: (msg, meta) => write('error', msg, meta),
    warn: (msg, meta) => write('warn', msg, meta),
    info: (msg, meta) => write('info', msg, meta),
    debug: (msg, meta) => write('debug', msg, meta),
  };
}

function safeStringify(value: Record<string, unknown>): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}