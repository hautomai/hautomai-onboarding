import type { Client, Customer, Logger, StepId } from '../types.js';
import { noopLogger } from '../types.js';
import type { ProviderFactory } from '../providers.js';
import type { Repository } from '../repo.js';
import { splitName, toIsoDate } from '../fields.js';
import {
  DEFAULT_CHECKIN_SUBJECT,
  DEFAULT_CHECKIN_TEXT,
  DEFAULT_DOCS_SUBJECT,
  DEFAULT_DOCS_TEXT,
  DEFAULT_FAILURE_ALERT_TEXT,
  DEFAULT_FAILURE_ALERT_TITLE,
  DEFAULT_TEAM_ALERT_TEXT,
  DEFAULT_TEAM_ALERT_TITLE,
  DEFAULT_WEEK1_SUBJECT,
  DEFAULT_WEEK1_TEXT,
  DEFAULT_WELCOME_SUBJECT,
  DEFAULT_WELCOME_TEXT,
  renderTemplate,
  type TemplateVars,
} from '../templates.js';
import type { EmailMessage, AlertMessage, Attachment } from '../providers.js';

export type StepContext = {
  factory: ProviderFactory;
  repo: Repository;
  logger: Logger;
  /** Base URL used to render deep links in alerts. */
  baseUrl?: string;
};

export type StepResult = { skipped?: string };

export interface StepDef {
  readonly id: StepId;
  readonly label: string;
  run(ctx: StepContext, client: Client, customer: Customer): Promise<StepResult | void>;
}

export function templateVars(client: Client, customer: Customer): TemplateVars {
  const { firstName, lastName } = splitName(customer.payload.customerName);
  return {
    clientName: client.config.name,
    firstName,
    lastName,
    customerName: customer.payload.customerName,
    email: customer.payload.email,
    phone: customer.payload.phone ?? '',
    package: customer.payload.package ?? '',
    source: customer.payload.source ?? '',
    signupDate: customer.payload.signupDate ?? toIsoDate(customer.signupAt),
  };
}

function emailTarget(
  client: Client,
  customer: Customer,
  message: Omit<EmailMessage, 'to' | 'toName' | 'from'>,
): EmailMessage {
  const vars = templateVars(client, customer);
  return {
    ...message,
    to: customer.payload.email,
    toName: vars.firstName,
    from: {
      name: client.config.email.fromName ?? client.config.name,
      email: client.config.email.fromEmail ?? '',
    },
  };
}

function stepTemplate(client: Client, step: StepId, fallback: { subject: string; text: string }) {
  const t = client.config.email.templates?.[step];
  const global = client.config.email;
  return {
    subject: t?.subject ?? (step === 'send_welcome_email' ? global.subject : undefined) ?? fallback.subject,
    text: t?.text ?? (step === 'send_welcome_email' ? global.text : undefined) ?? fallback.text,
    html: t?.html ?? (step === 'send_welcome_email' ? global.html : undefined) ?? '',
  };
}

export const createCrmContactStep: StepDef = {
  id: 'create_crm_contact',
  label: 'Create CRM contact',
  async run(ctx, client, customer) {
    const provider = ctx.factory.crm(client);
    const { firstName, lastName } = splitName(customer.payload.customerName);
    const contact = await provider.createContact({
      customer: customer.payload,
      fieldMap: client.config.crm.fieldMap,
      computed: {
        firstName,
        lastName,
        signupDate: customer.payload.signupDate || toIsoDate(customer.signupAt),
        source: customer.payload.source || 'website',
        package: customer.payload.package || '',
        onboardingStatus: 'onboarding',
      },
    });
    ctx.logger.info('crm.contact.created', {
      client: client.slug,
      email: customer.email,
      externalId: contact.externalId,
    });
  },
};

export const sendTeamAlertStep: StepDef = {
  id: 'send_team_alert',
  label: 'Send team alert',
  async run(ctx, client, customer) {
    const channels = client.config.alerts.filter((a) => a.events.includes('signup'));
    if (channels.length === 0) {
      ctx.logger.debug('alert.skipped', { client: client.slug, reason: 'no signup channels' });
      return { skipped: 'no alert channel configured for signup' };
    }
    const vars = templateVars(client, customer);
    const text = renderTemplate(DEFAULT_TEAM_ALERT_TEXT, vars);
    const message: AlertMessage = {
      title: renderTemplate(DEFAULT_TEAM_ALERT_TITLE, vars),
      text,
      uri: ctx.baseUrl ? `${ctx.baseUrl}/admin#customers?slug=${client.slug}&q=${encodeURIComponent(customer.email)}` : undefined,
    };
    for (const channel of channels) {
      const provider = ctx.factory.alert(channel);
      await provider.notify(message);
      ctx.logger.info('alert.sent', { client: client.slug, provider: channel.provider, email: customer.email });
    }
  },
};

export const sendWelcomeEmailStep: StepDef = {
  id: 'send_welcome_email',
  label: 'Send welcome email',
  async run(ctx, client, customer) {
    const provider = ctx.factory.email(client);
    const vars = templateVars(client, customer);
    const t = stepTemplate(client, 'send_welcome_email', {
      subject: DEFAULT_WELCOME_SUBJECT,
      text: DEFAULT_WELCOME_TEXT,
    });
    await provider.send(
      emailTarget(client, customer, {
        subject: renderTemplate(t.subject, vars),
        text: renderTemplate(t.text, vars),
        html: renderTemplate(t.html, vars) || undefined,
      }),
    );
    ctx.logger.info('email.sent', { client: client.slug, step: 'send_welcome_email', to: customer.email });
  },
};

export const sendDocumentsStep: StepDef = {
  id: 'send_documents',
  label: 'Send documents',
  async run(ctx, client, customer) {
    const docs = client.config.documents.filter((d) => (d.step ?? 'send_documents') === 'send_documents');
    if (docs.length === 0) {
      ctx.logger.debug('docs.skipped', { client: client.slug, reason: 'no documents configured' });
      return { skipped: 'no documents configured for this client' };
    }
    const storage = ctx.factory.storage(client);
    const attachments: Attachment[] = [];
    for (const doc of docs) {
      const file = await storage.read(doc);
      attachments.push({
        filename: doc.fileName,
        contentType: doc.contentType,
        data: file.data,
      });
      ctx.logger.debug('docs.read', { client: client.slug, doc: doc.id });
    }
    const provider = ctx.factory.email(client);
    const vars = templateVars(client, customer);
    const t = stepTemplate(client, 'send_documents', {
      subject: DEFAULT_DOCS_SUBJECT,
      text: DEFAULT_DOCS_TEXT,
    });
    await provider.send(
      emailTarget(client, customer, {
        subject: renderTemplate(t.subject, vars),
        text: renderTemplate(t.text, vars),
        html: renderTemplate(t.html, vars) || undefined,
        attachments,
      }),
    );
    ctx.logger.info('docs.sent', { client: client.slug, to: customer.email, count: docs.length });
  },
};

export const sendCheckinStep: StepDef = {
  id: 'send_checkin',
  label: 'Send personal check-in (24h)',
  async run(ctx, client, customer) {
    const provider = ctx.factory.email(client);
    const vars = templateVars(client, customer);
    const t = stepTemplate(client, 'send_checkin', {
      subject: DEFAULT_CHECKIN_SUBJECT,
      text: DEFAULT_CHECKIN_TEXT,
    });
    await provider.send(
      emailTarget(client, customer, {
        subject: renderTemplate(t.subject, vars),
        text: renderTemplate(t.text, vars),
        html: renderTemplate(t.html, vars) || undefined,
      }),
    );
    ctx.logger.info('email.sent', { client: client.slug, step: 'send_checkin', to: customer.email });
  },
};

export const sendWeek1Step: StepDef = {
  id: 'send_week1',
  label: 'Send week-1 success guide (3 days)',
  async run(ctx, client, customer) {
    const provider = ctx.factory.email(client);
    const vars = templateVars(client, customer);
    const t = stepTemplate(client, 'send_week1', {
      subject: DEFAULT_WEEK1_SUBJECT,
      text: DEFAULT_WEEK1_TEXT,
    });
    await provider.send(
      emailTarget(client, customer, {
        subject: renderTemplate(t.subject, vars),
        text: renderTemplate(t.text, vars),
        html: renderTemplate(t.html, vars) || undefined,
      }),
    );
    ctx.logger.info('email.sent', { client: client.slug, step: 'send_week1', to: customer.email });
  },
};

export function sendFailureAlert(
  client: Client,
  customer: Customer,
  step: StepId,
  error: string,
  attempts: number,
  ctx: StepContext,
): Promise<void> {
  const channels = client.config.alerts.filter((a) => a.events.includes('failed'));
  if (channels.length === 0) return Promise.resolve();
  const vars = templateVars(client, customer);
  const text = renderTemplate(DEFAULT_FAILURE_ALERT_TEXT, { ...vars, step, error, attempts: String(attempts) });
  const message: AlertMessage = {
    title: renderTemplate(DEFAULT_FAILURE_ALERT_TITLE, vars),
    text,
    uri: ctx.baseUrl ? `${ctx.baseUrl}/admin#customers?slug=${client.slug}` : undefined,
  };
  const jobs = channels.map(async (channel) => {
    try {
      await ctx.factory.alert(channel).notify(message);
    } catch (err) {
      ctx.logger.warn('alert.failure_notification_error', {
        client: client.slug,
        provider: channel.provider,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
  return Promise.all(jobs).then(() => undefined);
}

export function defaultStepLogger(): Logger {
  return noopLogger;
}

export const STEPS: Record<StepId, StepDef> = {
  create_crm_contact: createCrmContactStep,
  send_team_alert: sendTeamAlertStep,
  send_welcome_email: sendWelcomeEmailStep,
  send_documents: sendDocumentsStep,
  send_checkin: sendCheckinStep,
  send_week1: sendWeek1Step,
};