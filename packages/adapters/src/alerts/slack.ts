import type { Credentials, AlertMessage } from '@hautomai/core';
import { ProviderConfigError, credString, httpJson } from '../util.js';

export function createSlackAlert(creds: Credentials | undefined) {
  return {
    id: 'slack',
    label: 'Slack (incoming webhook)',
    async notify(message: AlertMessage): Promise<void> {
      const webhookUrl = credString(creds, 'webhookUrl');
      if (!webhookUrl) {
        throw new ProviderConfigError('Slack selected but no webhookUrl credential is configured (placeholder).');
      }
      const lines = [`*${message.title}*`, message.text];
      if (message.uri) lines.push(message.uri);
      const payload = { text: lines.join('\n\n') };
      await httpJson<unknown>(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    },
  };
}

export function createTelegramAlert(creds: Credentials | undefined) {
  return {
    id: 'telegram',
    label: 'Telegram (bot)',
    async notify(message: AlertMessage): Promise<void> {
      const botToken = credString(creds, 'botToken');
      const chatId = credString(creds, 'chatId');
      if (!botToken || !chatId) {
        throw new ProviderConfigError(
          'Telegram selected but botToken/chatId credentials are missing (placeholder).',
        );
      }
      const text = [message.title, message.text, message.uri].filter(Boolean).join('\n\n');
      await httpJson<unknown>(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
    },
  };
}

export { createEmailAlert } from './email-alert.js';