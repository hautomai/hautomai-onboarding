import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Attachment, DocumentSpec, UploadInput } from '@hautomai/core';
import { ProviderConfigError } from '../util.js';

function sanitizeFileName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return base || 'file';
}

/** Local-disk document storage (dev default; swap for S3-compatible in prod). */
export function createDiskStorage(baseDir: string) {
  return {
    id: 'disk',
    label: `Local disk (${baseDir})`,
    async save(input: UploadInput): Promise<DocumentSpec> {
      await mkdir(baseDir, { recursive: true });
      const storageKey = `${Date.now()}-${randomUUID().slice(0, 8)}-${sanitizeFileName(input.name)}`;
      await writeFile(join(baseDir, storageKey), input.data);
      return {
        id: randomUUID(),
        name: input.name,
        step: (input.step ?? 'send_documents') as DocumentSpec['step'],
        fileName: input.name,
        contentType: input.contentType || 'application/pdf',
        size: input.data.length,
        storageKey,
      };
    },
    async read(doc: DocumentSpec): Promise<Attachment> {
      const key = doc.storageKey ?? doc.fileName;
      const absolute = join(baseDir, key);
      if (!absolute.startsWith(baseDir)) {
        throw new ProviderConfigError('Illegal document storage key.');
      }
      const data = await readFile(absolute);
      return { filename: doc.fileName, contentType: doc.contentType, data };
    },
    async remove(doc: DocumentSpec): Promise<void> {
      const key = doc.storageKey ?? doc.fileName;
      await unlink(join(baseDir, key)).catch(() => undefined);
    },
  };
}

export async function ensureBaseDir(baseDir: string): Promise<void> {
  await mkdir(baseDir, { recursive: true });
}