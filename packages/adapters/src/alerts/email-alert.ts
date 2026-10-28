import type { Credentials, AlertMessage } from '@hautomai/core';
import { createSmtpEmail } from '../email/index.js';
import { credString } from '../util.js';

/** Alert delivery through plain email (formal record channel). */
export function createEmailAlert(creds: Credentials | undefined) {
  return {
    id: 'email',
    label: 'Email alert',
    async notify(message: AlertMessage): Promise<void> {
      const to = credString(creds, 'to');
      if (!to) {
        throw new Error('Email alert selected but no "to" recipient credential is configured.');
      }
      const underlying = {
        ...(creds ?? {}),
        fromEmail: credString(creds, 'fromEmail') ?? credString(creds, 'user'),
      };
      await createSmtpEmail(underlying).send({
        to,
        subject: message.title,
        text: message.uri ? `${message.text}\n\n${message.uri}` : message.text,
      });
    },
  };
}