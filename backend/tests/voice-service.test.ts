import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server.js';

describe('Server-Side Voice STT & Command Routing', () => {
  const { app, store } = createApp();
  const pairingCode = 'G2-VOX1';
  let threadId: string;

  it('should initialize deal thread for voice testing', async () => {
    await request(app)
      .post('/api/pair/create')
      .send({ customCode: pairingCode });

    const thRes = await request(app)
      .post('/api/threads')
      .send({
        pairingCode,
        title: 'Voice Controlled Deal',
        counterparty: 'Client Dave',
        baselineSummary: 'Hardware prototyping for $9,000 USD due 2026-11-30.',
        lockedTerms: { price: 9000, deadline: '2026-11-30' },
      });

    threadId = thRes.body.id;
  });

  it('should classify voice command intents accurately', async () => {
    // 1. LOCK intent
    const resLock = await request(app)
      .post('/api/voice/transcribe')
      .send({ commandText: 'Please lock these agreed terms now' });

    expect(resLock.status).toBe(200);
    expect(resLock.body.detectedIntent).toBe('LOCK_TERMS');

    // 2. FLAG intent
    const resFlag = await request(app)
      .post('/api/voice/transcribe')
      .send({ commandText: 'Flag this drift immediately' });

    expect(resFlag.status).toBe(200);
    expect(resFlag.body.detectedIntent).toBe('FLAG_DRIFT');

    // 3. COUNTER intent
    const resCounter = await request(app)
      .post('/api/voice/transcribe')
      .send({ commandText: 'Send counter offer with original scope' });

    expect(resCounter.status).toBe(200);
    expect(resCounter.body.detectedIntent).toBe('COUNTER_OFFER');

    // 4. UNDO intent
    const resUndo = await request(app)
      .post('/api/voice/transcribe')
      .send({ commandText: 'Undo that last action' });

    expect(resUndo.status).toBe(200);
    expect(resUndo.body.detectedIntent).toBe('UNDO');
  });

  it('should auto-execute action via voice command on active thread', async () => {
    // Execute FLAG via voice command
    const autoFlagRes = await request(app)
      .post('/api/voice/transcribe')
      .send({
        commandText: 'Flag terms drift on this deal',
        pairingCode,
        threadId,
        autoExecuteAction: true,
      });

    expect(autoFlagRes.status).toBe(200);
    expect(autoFlagRes.body.detectedIntent).toBe('FLAG_DRIFT');
    expect(autoFlagRes.body.executedAction).toBeDefined();
    expect(autoFlagRes.body.executedAction.success).toBe(true);

    // Verify thread state updated
    const thread = store.get(threadId);
    expect(thread?.currentState).toBe('FLAGGED');
  });

  it('should reject invalid empty voice requests', async () => {
    const emptyRes = await request(app)
      .post('/api/voice/transcribe')
      .send({});

    expect(emptyRes.status).toBe(400);
    expect(emptyRes.body.error).toContain('audioBase64 or commandText');
  });
});
