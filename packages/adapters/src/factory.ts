import type { ProviderFactory } from '@hautomai/core';
import { createHubspotCrm } from './crm/hubspot.js';
import { createEmailAlert, createSlackAlert, createTelegramAlert } from './alerts/slack.js';
import { createGmailEmail, createSmtpEmail } from './email/index.js';
import { createDiskStorage, ensureBaseDir } from './storage/disk.js';
import {
  createMemoryAlert,
  createMemoryCrm,
  createMemoryEmail,
  createMemoryStorage,
} from './memory.js';

export type FactoryEnv = Record<string, string | undefined>;

/**
 * Maps a client config to concrete provider implementations. Real providers
 * activate once credentials are present (env or client "credentials" block).
 * The "memory" provider is the always-available sandbox.
 */
export function createProviderFactory(env: FactoryEnv = {}): ProviderFactory {
  const docsDir = env.DOCS_DIR?.trim() || '.uploads';
  void ensureBaseDir(docsDir);

  return {
    crm: (client) => {
      const { provider, credentials } = client.config.crm;
      if (provider === 'hubspot') {
        return createHubspotCrm({
          accessToken: credentials?.accessToken ?? env.HUBSPOT_ACCESS_TOKEN,
          ...(credentials ?? {}),
        });
      }
      if (provider === 'memory') return createMemoryCrm(credentials);
      return createMemoryCrm(credentials);
    },

    email: (client) => {
      const { provider, credentials } = client.config.email;
      if (provider === 'smtp') return createSmtpEmail(credentials);
      if (provider === 'gmail') {
        return createGmailEmail({
          user: credentials?.user ?? env.GMAIL_USER,
          appPassword: credentials?.appPassword ?? env.GMAIL_APP_PASSWORD,
          ...(credentials ?? {}),
        });
      }
      return createMemoryEmail(credentials);
    },

    alert: (channel) => {
      const creds = channel.credentials ?? {};
      switch (channel.provider) {
        case 'slack':
          return createSlackAlert({
            webhookUrl: creds.webhookUrl ?? env.SLACK_WEBHOOK_URL,
            ...creds,
          });
        case 'telegram':
          return createTelegramAlert({
            botToken: creds.botToken ?? env.TELEGRAM_BOT_TOKEN,
            chatId: creds.chatId ?? env.TELEGRAM_CHAT_ID,
            ...creds,
          });
        case 'email':
          return createEmailAlert(creds);
        case 'memory':
          return createMemoryAlert(creds);
        default:
          return createMemoryAlert();
      }
    },

    storage: (client) => {
      const { provider, dir, credentials } = client.config.storage;
      const baseDir = dir?.trim() || docsDir;
      if (provider === 'memory') return createMemoryStorage(credentials);
      return createDiskStorage(baseDir);
    },
  };
}