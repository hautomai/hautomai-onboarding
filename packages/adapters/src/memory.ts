import type {
  AlertMessage,
  Attachment,
  CrmCreateContactInput,
  CrmCreateContactResult,
  DocumentSpec,
  EmailMessage,
  UploadInput,
} from '@hautomai/core';
import { splitName, type Credentials } from '@hautomai/core';

export const memorySink = {
  crmContacts: [] as Array<{ input: CrmCreateContactInput; result: CrmCreateContactResult }>,
  emails: [] as EmailMessage[],
  alerts: [] as Array<{ provider: string; message: AlertMessage }>,
  documents: [] as DocumentSpec[],
};

const failureCounters = new Map<string, number>();

/** Test/toy control: make the next N calls of a provider category throw. */
export const memoryControllables = {
  failNext(provider: 'crm' | 'email' | 'alert' | 'storage', count = 1): void {
    failureCounters.set(provider, count);
  },
  flush(): void {
    failureCounters.clear();
  },
};

function consumeFailure(category: string): void {
  const remaining = failureCounters.get(category) ?? 0;
  if (remaining > 0) {
    failureCounters.set(category, remaining - 1);
    throw new Error(`injected ${category} failure (${remaining} remaining)`);
  }
}

export function resetMemorySink(): void {
  memorySink.crmContacts.length = 0;
  memorySink.emails.length = 0;
  memorySink.alerts.length = 0;
  memorySink.documents.length = 0;
  memoryControllables.flush();
}

export function createMemoryCrm(creds?: Credentials) {
  return {
    id: 'memory',
    label: 'memory',
    async createContact(input: CrmCreateContactInput): Promise<CrmCreateContactResult> {
      consumeFailure('crm');
      void creds;
      const result = { externalId: 'mem-' + Date.now().toString(36) };
      memorySink.crmContacts.push({ input, result });
      const firstName = splitName(input.customer.customerName).firstName;
      void firstName;
      return result;
    },
  };
}

export function createMemoryEmail(creds?: Credentials) {
  return {
    id: 'memory',
    label: 'memory',
    async send(message: EmailMessage): Promise<void> {
      consumeFailure('email');
      void creds;
      memorySink.emails.push(message);
    },
  };
}

export function createMemoryAlert(creds?: Credentials) {
  return {
    id: 'memory',
    label: 'memory',
    async notify(message: AlertMessage): Promise<void> {
      consumeFailure('alert');
      void creds;
      memorySink.alerts.push({ provider: 'memory', message });
    },
  };
}

export function createMemoryStorage(creds?: Credentials) {
  return {
    id: 'memory',
    label: 'memory',
    async save(input: UploadInput): Promise<DocumentSpec> {
      consumeFailure('storage');
      void creds;
      const doc: DocumentSpec = {
        id: `mem-${memorySink.documents.length + 1}`,
        name: input.name,
        step: (input.step ?? 'send_documents') as DocumentSpec['step'],
        fileName: input.name,
        contentType: input.contentType,
        size: input.data.length,
        storageKey: input.name,
      };
      memorySink.documents.push(doc);
      return doc;
    },
    async read(doc: DocumentSpec): Promise<Attachment> {
      return { filename: doc.fileName, contentType: doc.contentType, data: Buffer.from(`pdf:${doc.fileName}`) };
    },
    async remove(): Promise<void> {
      void 0;
    },
  };
}

/** A provider factory fully wired to in-memory providers (tests / sandbox). */
export function createMemoryProviderFactory() {
  return {
    crm: () => createMemoryCrm(),
    email: () => createMemoryEmail(),
    alert: () => createMemoryAlert(),
    storage: () => createMemoryStorage(),
  };
}