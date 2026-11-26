import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server.js';

describe('Pairing & Telegram Link Flow', { timeout: 15000 }, () => {
  const { app, store, pairing, telegramClient } = createApp();
  const pairingCode = 'G2-TLK1';
  const chatId = 987654321;
  let threadId: string;

  it('should create pairing session and deal lock', async () => {
    // 1. Create pairing session on G2
    await request(app)
      .post('/api/pair/create')
      .send({ customCode: pairingCode, deviceId: 'g2-glasses-device-1' });

    // 2. Create thread lock
    const thRes = await request(app)
      .post('/api/threads')
      .send({
        pairingCode,
        title: 'Fullstack MVP Deal',
        counterparty: '@tech_buyer',
        channel: 'telegram',
        baselineSummary: 'React frontend and Node backend for $15,000 USD due 2026-12-20.',
        lockedTerms: {
          price: 15000,
          currency: 'USD',
          deadline: '2026-12-20',
          scope: ['Frontend web app', 'REST backend'],
        },
      });

    expect(thRes.status).toBe(201);
    threadId = thRes.body.id;
  });

  it('should link Telegram chat via /start command payload without Google login', async () => {
    // Simulate Telegram webhook for "/start G2-TLK1"
    const webhookRes = await request(app)
      .post('/api/telegram/webhook')
      .send({
        update_id: 1001,
        message: {
          message_id: 1,
          date: Math.floor(Date.now() / 1000),
          chat: { id: chatId, first_name: 'Alex', username: 'tech_buyer' },
          from: { id: chatId, first_name: 'Alex', username: 'tech_buyer' },
          text: `/start ${pairingCode}`,
        },
      });

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body.processed).toBe(true);
    expect(webhookRes.body.commandName).toBe('link');

    // Verify session now has telegram link
    const session = pairing.getSession(pairingCode);
    expect(session?.telegramLink).toBeDefined();
    expect(session?.telegramLink?.chatId).toBe(chatId);
    expect(session?.telegramLink?.username).toBe('@tech_buyer');

    // Check status endpoint
    const statusRes = await request(app)
      .get(`/api/telegram/status?pairingCode=${pairingCode}`);

    expect(statusRes.status).toBe(200);
    expect(statusRes.body.isLinked).toBe(true);
    expect(statusRes.body.deepLink).toContain(pairingCode);
  });

  it('should automatically route incoming messages from linked Telegram chat to active thread lock', async () => {
    // Incoming message from linked chatId proposing a price increase
    const webhookRes = await request(app)
      .post('/api/telegram/webhook')
      .send({
        update_id: 1002,
        message: {
          message_id: 2,
          date: Math.floor(Date.now() / 1000),
          chat: { id: chatId, first_name: 'Alex', username: 'tech_buyer' },
          from: { id: chatId, first_name: 'Alex', username: 'tech_buyer' },
          text: 'We reviewed the quote: total fee will be $17,500 USD for the milestone.',
        },
      });

    expect(webhookRes.status).toBe(200);
    expect(webhookRes.body.processed).toBe(true);
    expect(webhookRes.body.evaluation.hasDrift).toBe(true);
    expect(webhookRes.body.evaluation.glance.headlineDiff).toContain('2,500');

    // Thread state updated
    const thread = store.get(threadId);
    expect(thread?.currentState).toBe('FLAGGED');

    // Audit trail record verified
    const auditRes = await request(app)
      .get(`/api/audit/${threadId}?pairingCode=${pairingCode}`);
    const latestAudit = auditRes.body[auditRes.body.length - 1];
    expect(latestAudit.action).toContain('Telegram message evaluated');
  });

  it('should handle /status command from Telegram and reply with active terms', async () => {
    const statusCmdRes = await request(app)
      .post('/api/telegram/webhook')
      .send({
        update_id: 1003,
        message: {
          message_id: 3,
          date: Math.floor(Date.now() / 1000),
          chat: { id: chatId, first_name: 'Alex' },
          from: { id: chatId, first_name: 'Alex' },
          text: '/status',
        },
      });

    expect(statusCmdRes.status).toBe(200);
    expect(statusCmdRes.body.isCommand).toBe(true);
    expect(statusCmdRes.body.commandName).toBe('status');
    expect(statusCmdRes.body.responseSent).toContain('Fullstack MVP Deal');
    expect(statusCmdRes.body.responseSent).toContain('$15,000');
  });

  it('should handle /lock command from Telegram to lock agreed terms', async () => {
    const lockCmdRes = await request(app)
      .post('/api/telegram/webhook')
      .send({
        update_id: 1004,
        message: {
          message_id: 4,
          date: Math.floor(Date.now() / 1000),
          chat: { id: chatId, first_name: 'Alex' },
          from: { id: chatId, first_name: 'Alex' },
          text: '/lock',
        },
      });

    expect(lockCmdRes.status).toBe(200);
    expect(lockCmdRes.body.commandName).toBe('lock');

    const thread = store.get(threadId);
    expect(thread?.lockedTerms.price).toBe(17500); // Updated to proposed value!
  });

  it('should reliably link session G2-S9EY directly via /link command and handle /counter and /undo', async () => {
    const customChatId = 123456789;

    // 1. Send /link G2-S9EY when session not yet stored on backend
    const linkRes = await request(app)
      .post('/api/telegram/webhook')
      .send({
        update_id: 2001,
        message: {
          message_id: 10,
          date: Math.floor(Date.now() / 1000),
          chat: { id: customChatId, first_name: 'Tester' },
          from: { id: customChatId, first_name: 'Tester' },
          text: '/link G2-S9EY',
        },
      });

    expect(linkRes.status).toBe(200);
    expect(linkRes.body.processed).toBe(true);
    expect(linkRes.body.commandName).toBe('link');
    expect(linkRes.body.responseSent).toContain('G2-S9EY');

    // Verify session was created and linked
    const session = pairing.getSession('G2-S9EY');
    expect(session).toBeDefined();
    expect(session?.telegramLink?.chatId).toBe(customChatId);

    // 2. Send drift offer in chat
    const offerRes = await request(app)
      .post('/api/telegram/webhook')
      .send({
        update_id: 2002,
        message: {
          message_id: 11,
          date: Math.floor(Date.now() / 1000),
          chat: { id: customChatId, first_name: 'Tester' },
          from: { id: customChatId, first_name: 'Tester' },
          text: 'We propose $12,500 USD and delivery pushed to 2026-12-25.',
        },
      });

    expect(offerRes.status).toBe(200);
    expect(offerRes.body.evaluation.hasDrift).toBe(true);
    expect(offerRes.body.responseSent).toContain('Drift Alert');

    // 3. Send /counter from Telegram
    const counterRes = await request(app)
      .post('/api/telegram/webhook')
      .send({
        update_id: 2003,
        message: {
          message_id: 12,
          date: Math.floor(Date.now() / 1000),
          chat: { id: customChatId, first_name: 'Tester' },
          from: { id: customChatId, first_name: 'Tester' },
          text: '/counter',
        },
      });

    expect(counterRes.status).toBe(200);
    expect(counterRes.body.commandName).toBe('counter');
    expect(counterRes.body.responseSent).toBeDefined();

    // 4. Send /undo from Telegram
    const undoRes = await request(app)
      .post('/api/telegram/webhook')
      .send({
        update_id: 2004,
        message: {
          message_id: 13,
          date: Math.floor(Date.now() / 1000),
          chat: { id: customChatId, first_name: 'Tester' },
          from: { id: customChatId, first_name: 'Tester' },
          text: '/undo',
        },
      });

    expect(undoRes.status).toBe(200);
    expect(undoRes.body.commandName).toBe('undo');
    expect(undoRes.body.responseSent).toContain('Action Cancelled / Rolled Back');
  });

  it('should retrieve outgoing message queue via API', async () => {
    const queueRes = await request(app)
      .get(`/api/telegram/queue?pairingCode=${pairingCode}`);

    expect(queueRes.status).toBe(200);
    expect(Array.isArray(queueRes.body)).toBe(true);
    expect(queueRes.body.length).toBeGreaterThan(0);
  });
});
