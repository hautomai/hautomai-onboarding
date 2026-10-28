import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDiskStorage, createSmtpEmail, createGmailEmail } from '@hautomai/adapters';

describe('createDiskStorage', () => {
  const base = mkdtempSync(join(tmpdir(), 'hauto-disk-'));

  it('saves and reads back a document', async () => {
    const storage = createDiskStorage(base);
    const doc = await storage.save({
      name: 'Contrat signé.pdf',
      contentType: 'application/pdf',
      data: Buffer.from('%PDF-1.4 hello'),
      step: 'send_documents',
    });
    expect(doc.step).toBe('send_documents');
    expect(doc.fileName).toBe('Contrat signé.pdf');
    expect(doc.storageKey).toBeTruthy();

    const file = await storage.read(doc);
    expect(file.data.toString()).toBe('%PDF-1.4 hello');
    expect(existsSync(join(base, doc.storageKey!))).toBe(true);
  });

  it('sanitizes unsafe file names for the storage key', async () => {
    const storage = createDiskStorage(base);
    const doc = await storage.save({
      name: '../../../../etc/passwd',
      contentType: 'application/pdf',
      data: Buffer.from('x'),
    });
    expect(doc.storageKey).not.toContain('/');
    expect(join(base, doc.storageKey!)).toContain(base);
  });

  it('removes a document', async () => {
    const storage = createDiskStorage(base);
    const doc = await storage.save({ name: 'temp.pdf', contentType: 'application/pdf', data: Buffer.from('y') });
    await storage.remove(doc);
    expect(existsSync(join(base, doc.storageKey!))).toBe(false);
  });

  it('blocks path traversal on read', async () => {
    const storage = createDiskStorage(base);
    await expect(
      storage.read({
        id: 'x',
        name: 'evil',
        step: 'send_documents',
        fileName: 'evil',
        contentType: 'application/pdf',
        size: 1,
        storageKey: '../../secrets',
      }),
    ).rejects.toThrow(/Illegal document storage key/);
  });
});

describe('email formatting through a stub transport', () => {
  it('builds SMTP mail options with from, to and attachments', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const stubTransport = {
      sendMail: async (mail: Record<string, unknown>) => {
        sent.push(mail);
        return { messageId: 'm1' };
      },
    };
    const email = createSmtpEmail(
      { host: 'smtp.example.com', port: 465, secure: true, user: 'sender@example.com', pass: 'pw' },
      stubTransport as never,
    );
    await email.send({
      to: 'ada@example.com',
      toName: 'Ada',
      from: { name: 'Acme', email: 'hello@acme.com' },
      subject: 'Hi {{firstName}}',
      text: 'hello',
      html: '<p>hello</p>',
      attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', data: Buffer.from('x') }],
    });
    expect(sent.length).toBe(1);
    const mail = sent[0]!;
    expect(mail.from).toBe(`"Acme" <hello@acme.com>`);
    expect(mail.to).toBe(`"Ada" <ada@example.com>`);
    expect(mail.attachments).toEqual([{ filename: 'a.pdf', contentType: 'application/pdf', content: Buffer.from('x') }]);
  });

  it('throws a helpful placeholder error when SMTP creds are absent', async () => {
    const email = createSmtpEmail(undefined);
    await expect(
      email.send({ to: 'a@b.com', subject: 's', text: 't' }),
    ).rejects.toThrow(/placeholder/);
  });

  it('gmail adapter uses an app-password shape against smtp.gmail.com', async () => {
    const sent: Array<Record<string, unknown>> = [];
    const stubTransport = {
      sendMail: async (mail: Record<string, unknown>) => {
        sent.push(mail);
        return { messageId: 'm2' };
      },
    };
    const gmail = createGmailEmail({ user: 'me@gmail.com', appPassword: 'abcd efgh' }, stubTransport as never);
    await gmail.send({ to: 'ada@example.com', subject: 'hi', text: 'x' });
    expect(sent[0]?.to).toBe('ada@example.com');
  });

  it('gmail rejects when user is missing', async () => {
    const gmail = createGmailEmail(undefined);
    await expect(gmail.send({ to: 'a@b.com', subject: 's', text: 't' })).rejects.toThrow(/placeholder/);
  });
});