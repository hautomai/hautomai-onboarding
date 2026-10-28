import type { CustomerPayload, DocumentSpec } from './types.js';

export type Credentials = Record<string, unknown>;

export type CrmComputedFields = {
  firstName: string;
  lastName: string;
  signupDate?: string;
  source?: string;
  package?: string;
  onboardingStatus: string;
};

export type CrmCreateContactInput = {
  customer: CustomerPayload;
  computed: CrmComputedFields;
  fieldMap?: Record<string, string>;
};

export type CrmCreateContactResult = {
  externalId: string | null;
};

export interface CrmProvider {
  readonly id: string;
  readonly label: string;
  createContact(input: CrmCreateContactInput): Promise<CrmCreateContactResult>;
}

export type Attachment = {
  filename: string;
  contentType: string;
  data: Buffer;
};

export type EmailMessage = {
  to: string;
  toName?: string;
  from?: { name?: string; email?: string };
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: Attachment[];
};

export interface EmailProvider {
  readonly id: string;
  readonly label: string;
  send(message: EmailMessage): Promise<void>;
}

export type AlertMessage = {
  title: string;
  text: string;
  uri?: string;
};

export interface AlertProvider {
  readonly id: string;
  readonly label: string;
  notify(message: AlertMessage): Promise<void>;
}

export type UploadInput = {
  name: string;
  contentType: string;
  data: Buffer;
  step?: string;
};

export interface StorageProvider {
  readonly id: string;
  readonly label: string;
  save(input: UploadInput): Promise<DocumentSpec>;
  read(doc: DocumentSpec): Promise<Attachment>;
  remove(doc: DocumentSpec): Promise<void>;
}

export type ProviderFactory = {
  crm(client: { config: { crm: { provider: string; fieldMap?: Record<string, string>; credentials?: Credentials } } }): CrmProvider;
  email(client: {
    config: { email: { provider: string; credentials?: Credentials; fromName?: string; fromEmail?: string } };
  }): EmailProvider;
  alert(channel: { provider: string; credentials?: Credentials }): AlertProvider;
  storage(client: { config: { storage: { provider: string; dir?: string; credentials?: Credentials } } }): StorageProvider;
};