import nodemailer, { type Transporter } from 'nodemailer';
import type { Credentials, EmailMessage } from '@hautomai/core';
import { ProviderConfigError, credBool, credNumber, credString } from '../util.js';

export type SmtpCreds = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromEmail?: string;
  fromName?: string;
};

export function resolveSmtpCreds(
  creds: Credentials | undefined,
  defaults: { host?: string; port?: number; secure?: boolean; user?: string } = {},
): SmtpCreds {
  const host = credString(creds, 'host') ?? defaults.host;
  const user = credString(creds, 'user') ?? defaults.user;
  if (!host) throw new ProviderConfigError('SMTP selected but no host credential is configured (placeholder).');
  if (!user) throw new ProviderConfigError('SMTP selected but no user credential is configured (placeholder).');
  return {
    host,
    port: credNumber(creds, 'port', defaults.port ?? 465),
    secure: credBool(creds, 'secure', defaults.secure ?? true),
    user,
    pass: credString(creds, 'pass') ?? credString(creds, 'password') ?? '',
    fromEmail: credString(creds, 'fromEmail'),
    fromName: credString(creds, 'fromName'),
  };
}

function buildTransport(creds: SmtpCreds, override?: Transporter): Transporter {
  if (override) return override;
  return nodemailer.createTransport({
    host: creds.host,
    port: creds.port,
    secure: creds.secure,
    auth: creds.user ? { user: creds.user, pass: creds.pass } : undefined,
  });
}

function formatFrom(creds: SmtpCreds, message: EmailMessage): string | undefined {
  const email = message.from?.email || creds.fromEmail || creds.user;
  if (!email) return undefined;
  const name = message.from?.name || creds.fromName || email;
  return name === email ? email : `"${name}" <${email}>`;
}

export function createSmtpEmail(creds: Credentials | undefined, transport?: Transporter) {
  return {
    id: 'smtp',
    label: 'SMTP email',
    async send(message: EmailMessage): Promise<void> {
      const smtp = resolveSmtpCreds(creds);
      const transporter = buildTransport(smtp, transport);
      await transporter.sendMail({
        from: formatFrom(smtp, message),
        to: message.toName ? `"${message.toName}" <${message.to}>` : message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        replyTo: message.replyTo,
        attachments: message.attachments?.map((a) => ({
          filename: a.filename,
          content: a.data,
          contentType: a.contentType,
        })),
      });
    },
  };
}

/** Gmail adapter - Google App Password over SMTP (or OAuth via SMTP auth). */
export function createGmailEmail(creds: Credentials | undefined, transport?: Transporter) {
  return {
    id: 'gmail',
    label: 'Gmail',
    async send(message: EmailMessage): Promise<void> {
      const user = credString(creds, 'user') ?? credString(creds, 'appUser');
      if (!user) {
        throw new ProviderConfigError('Gmail selected but no user credential is configured (placeholder).');
      }
      const pass = credString(creds, 'appPassword') ?? credString(creds, 'pass');
      const merged: Credentials = {
        ...(creds ?? {}),
        host: credString(creds, 'host') ?? 'smtp.gmail.com',
        port: credNumber(creds, 'port', 465),
        secure: credBool(creds, 'secure', true),
        user,
        pass: pass ?? '',
      };
      await createSmtpEmail(merged, transport).send(message);
    },
  };
}