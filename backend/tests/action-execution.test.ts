import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server.js';

describe('Action Execution Pipeline (LOCK, FLAG, COUNTER, UNDO)', () => {
  const { app, store, pairing, telegramClient } = createApp();
  const pairingCode = 'G2-ACT1';
  let threadId: string;

  it('should initialize pairing session and locked thread', async () => {
    // 1. Create pairing session
    await request(app)
      .post('/api/pair/create')
      .send({ customCode: pairingCode });

    // 2. Create baseline deal lock
    const threadRes = await request(app)
      .post('/api/threads')
      .send({
        pairingCode,
        title: 'Enterprise AI Consultation',
        counterparty: '@client_acme',
        channel: 'telegram',
        baselineSummary: 'Consulting sprint for $12,000 USD due 2026-12-01.',
        lockedTerms: {
          price: 12000,
          currency: 'USD',
          deadline: '2026-12-01',
          scope: ['Architecture Audit', 'Deployment Guide'],
        },
      });

    expect(threadRes.status).toBe(201);
    threadId = threadRes.body.id;
    expect(threadRes.body.lockedTerms.price).toBe(12000);
  });

  it('should evaluate an incoming drifting proposal before action', async () => {
    const evalRes = await request(app)
      .post('/api/diff/evaluate')
      .send({
        threadId,
        pairingCode,
        message: 'We want to revise the budget to $14,000 USD and push deadline to 2026-12-15.',
        sender: '@client_acme',
      });

    expect(evalRes.status).toBe(200);
    expect(evalRes.body.evaluation.hasDrift).toBe(true);
    expect(evalRes.body.evaluation.structuredDiffs.some((d: any) => d.field === 'price')).toBe(true);
  });

  it('should execute LOCK action: updates baseline terms, transitions state, and logs audit', async () => {
    const lockRes = await request(app)
      .post('/api/actions/execute')
      .send({
        threadId,
        pairingCode,
        action: 'LOCK',
        actor: 'g2-glasses-touchbar',
        targetTerms: {
          price: 14000,
          deadline: '2026-12-15',
        },
        withUndoWindow: true,
      });

    expect(lockRes.status).toBe(200);
    expect(lockRes.body.success).toBe(true);
    expect(lockRes.body.action).toBe('LOCK');
    expect(lockRes.body.inUndoWindow).toBe(true);

    // Verify baseline was updated to the new agreed value
    const updatedThread = store.get(threadId);
    expect(updatedThread?.lockedTerms.price).toBe(14000);
    expect(updatedThread?.lockedTerms.deadline).toBe('2026-12-15');
    expect(updatedThread?.previousLockedTerms?.price).toBe(12000); // Saved for undo rollback

    // Verify audit trail logged the new baseline terms
    const auditRes = await request(app)
      .get(`/api/audit/${threadId}?pairingCode=${pairingCode}`);
    const latestAudit = auditRes.body[auditRes.body.length - 1];
    expect(latestAudit.action).toContain('Terms Locked to New Baseline');
    expect(latestAudit.metadata.newLockedTerms.price).toBe(14000);
  });

  it('should execute UNDO action: reverts baseline terms and restores previous state', async () => {
    const undoRes = await request(app)
      .post('/api/actions/execute')
      .send({
        threadId,
        pairingCode,
        action: 'UNDO',
        actor: 'g2-glasses-touchbar',
      });

    expect(undoRes.status).toBe(200);
    expect(undoRes.body.success).toBe(true);
    expect(undoRes.body.action).toBe('UNDO');

    // Verify baseline terms were safely reverted
    const revertedThread = store.get(threadId);
    expect(revertedThread?.lockedTerms.price).toBe(12000);
    expect(revertedThread?.lockedTerms.deadline).toBe('2026-12-01');

    // Audit log verifies rollback
    const auditRes = await request(app)
      .get(`/api/audit/${threadId}?pairingCode=${pairingCode}`);
    const latestAudit = auditRes.body[auditRes.body.length - 1];
    expect(latestAudit.action).toContain('Action Rolled Back (Undo)');
  });

  it('should execute FLAG action: flags drift, records reason, and logs audit', async () => {
    const flagRes = await request(app)
      .post('/api/actions/execute')
      .send({
        threadId,
        pairingCode,
        action: 'FLAG',
        customNote: 'Unapproved price hike and delayed milestone',
        actor: 'g2-user',
      });

    expect(flagRes.status).toBe(200);
    expect(flagRes.body.success).toBe(true);
    expect(flagRes.body.action).toBe('FLAG');

    const flaggedThread = store.get(threadId);
    expect(flaggedThread?.currentState).toBe('FLAGGED');
    expect(flaggedThread?.flagReason).toContain('Unapproved price hike');

    const auditRes = await request(app)
      .get(`/api/audit/${threadId}?pairingCode=${pairingCode}`);
    const latestAudit = auditRes.body[auditRes.body.length - 1];
    expect(latestAudit.action).toContain('Terms Drift Flagged');
  });

  it('should execute COUNTER action: generates counter-offer, queues message, and updates state', async () => {
    const counterRes = await request(app)
      .post('/api/actions/execute')
      .send({
        threadId,
        pairingCode,
        action: 'COUNTER',
        actor: 'g2-glasses-touchbar',
        customNote: 'We can accept $13,000 maximum with final delivery by Dec 5.',
        withUndoWindow: true,
      });

    expect(counterRes.status).toBe(200);
    expect(counterRes.body.success).toBe(true);
    expect(counterRes.body.action).toBe('COUNTER');
    expect(counterRes.body.outgoingMessage).toBeDefined();
    expect(counterRes.body.outgoingMessage.text).toContain('$13,000');

    const thread = store.get(threadId);
    expect(thread?.currentState).toBe('UNDO_WINDOW');

    // Verify message is in Telegram queue
    const queue = telegramClient.getQueue(pairingCode);
    expect(queue.some(m => m.type === 'COUNTER_OFFER')).toBe(true);
  });
});
