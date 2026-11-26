import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server.js';

describe('ThreadLock G2 - REST API Integration & Pairing Isolation', () => {
  const { app } = createApp();

  const pairingCodeA = 'G2-AAA1';
  const pairingCodeB = 'G2-BBB2';

  it('should create pairing sessions', async () => {
    const res = await request(app)
      .post('/api/pair/create')
      .send({ customCode: pairingCodeA, deviceId: 'test-glasses-hud' });

    expect(res.status).toBe(201);
    expect(res.body.code).toBe(pairingCodeA);
    expect(res.body.status).toBe('active');
  });

  it('should create a thread lock with structured terms', async () => {
    const res = await request(app)
      .post('/api/threads')
      .send({
        pairingCode: pairingCodeA,
        title: 'Freelance Design Deal',
        counterparty: '@client_sarah',
        channel: 'telegram',
        baselineSummary: 'Landing page and brand design for $8,000 USD due 2026-12-10.',
        lockedTerms: {
          price: 8000,
          currency: 'USD',
          deadline: '2026-12-10',
          scope: ['Landing page Figma', 'Brand guide PDF', 'SVG icons asset export'],
          customRules: [
            {
              id: 'cr1',
              name: 'No weekend on-call',
              description: 'Weekend work requires double fee',
              forbiddenKeywords: ['weekend support', 'on-call sunday'],
              severity: 'HIGH',
            },
          ],
        },
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.currentState).toBe('PENDING_REVIEW');
    expect(res.body.lockedTerms.price).toBe(8000);
  });

  it('should evaluate diff on incoming price drift message', async () => {
    // 1. Get thread created for pairingCodeA
    const listRes = await request(app)
      .get(`/api/threads?pairingCode=${pairingCodeA}`);
    expect(listRes.body.length).toBeGreaterThan(0);
    const thread = listRes.body[0];

    // 2. Evaluate drifting message: price increased to $9,500
    const evalRes = await request(app)
      .post('/api/diff/evaluate')
      .send({
        threadId: thread.id,
        pairingCode: pairingCodeA,
        message: 'Hey, after reviewing requirements, our total fee is now $9,500 USD.',
        sender: '@client_sarah',
      });

    expect(evalRes.status).toBe(200);
    expect(evalRes.body.evaluation.hasDrift).toBe(true);
    expect(evalRes.body.evaluation.glance.headlineDiff).toContain('1,500');
    expect(evalRes.body.evaluation.glance.recommendedAction).toBe('FLAG');
    expect(evalRes.body.state).toBe('FLAGGED');
  });

  it('should evaluate non-drifting confirmation message', async () => {
    const listRes = await request(app)
      .get(`/api/threads?pairingCode=${pairingCodeA}`);
    const thread = listRes.body[0];

    const evalRes = await request(app)
      .post('/api/diff/evaluate')
      .send({
        threadId: thread.id,
        pairingCode: pairingCodeA,
        message: 'Everything looks great, agreed on the $8,000 USD and Dec 10 deadline! Confirmed.',
        sender: '@client_sarah',
      });

    expect(evalRes.status).toBe(200);
    expect(evalRes.body.evaluation.hasDrift).toBe(false);
    expect(evalRes.body.evaluation.glance.headlineDiff).toBe('LOCKED: ZERO DRIFT');
    expect(evalRes.body.evaluation.glance.recommendedAction).toBe('ACCEPT_LOCK');
  });

  it('should handle state transitions and undo window rollback', async () => {
    const listRes = await request(app)
      .get(`/api/threads?pairingCode=${pairingCodeA}`);
    const thread = listRes.body[0];

    // Transition to LOCKED_NEW with undo window
    const transRes = await request(app)
      .post('/api/state/transition')
      .send({
        threadId: thread.id,
        pairingCode: pairingCodeA,
        targetState: 'LOCKED_NEW',
        withUndoWindow: true,
      });

    expect(transRes.status).toBe(200);
    expect(transRes.body.transition.inUndoWindow).toBe(true);
    expect(transRes.body.thread.currentState).toBe('UNDO_WINDOW');

    // Trigger undo rollback
    const undoRes = await request(app)
      .post('/api/state/undo')
      .send({
        threadId: thread.id,
        pairingCode: pairingCodeA,
      });

    expect(undoRes.status).toBe(200);
    expect(undoRes.body.thread.currentState).toBe(transRes.body.transition.previousState);
  });

  it('should verify audit trail integrity via API', async () => {
    const listRes = await request(app)
      .get(`/api/threads?pairingCode=${pairingCodeA}`);
    const thread = listRes.body[0];

    // Fetch audit trail
    const auditRes = await request(app)
      .get(`/api/audit/${thread.id}?pairingCode=${pairingCodeA}`);
    expect(auditRes.status).toBe(200);
    expect(auditRes.body.length).toBeGreaterThan(1);

    // Verify hash integrity
    const verifyRes = await request(app)
      .get(`/api/audit/verify/${thread.id}`);
    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.isValid).toBe(true);
  });

  it('should enforce strict pairing isolation between different pairing sessions', async () => {
    // 1. Create thread under pairingCodeA
    const threadARes = await request(app)
      .post('/api/threads')
      .send({
        pairingCode: pairingCodeA,
        title: 'Confidential Deal A',
        counterparty: 'Partner A',
        baselineSummary: 'Secret Deal A terms',
        lockedTerms: { price: 50000 },
      });
    const threadAId = threadARes.body.id;

    // 2. Create session B
    await request(app)
      .post('/api/pair/create')
      .send({ customCode: pairingCodeB });

    // 3. Session B lists threads: must NOT see Thread A
    const listB = await request(app)
      .get(`/api/threads?pairingCode=${pairingCodeB}`);
    expect(listB.body.some((t: any) => t.id === threadAId)).toBe(false);

    // 4. Session B attempts direct access to Thread A: must return 403 Forbidden
    const directAccess = await request(app)
      .get(`/api/threads/${threadAId}?pairingCode=${pairingCodeB}`);
    expect(directAccess.status).toBe(403);

    // 5. Session B attempts to evaluate diff against Thread A: must return 403 Forbidden
    const unauthorizedEval = await request(app)
      .post('/api/diff/evaluate')
      .send({
        threadId: threadAId,
        pairingCode: pairingCodeB,
        message: 'Sneak peek',
      });
    expect(unauthorizedEval.status).toBe(403);
  });

  it('should process simulated Telegram message through the bridge', async () => {
    const listRes = await request(app)
      .get(`/api/threads?pairingCode=${pairingCodeA}`);
    const thread = listRes.body[0];

    const simRes = await request(app)
      .post('/api/telegram/simulate')
      .send({
        pairingCode: pairingCodeA,
        senderUsername: '@client_sarah',
        senderName: 'Sarah Client',
        text: 'Also need weekend support and on-call sunday for our launch.',
      });

    expect(simRes.status).toBe(200);
    expect(simRes.body.processed).toBe(true);
    expect(simRes.body.evaluation.hasDrift).toBe(true);
    expect(simRes.body.evaluation.ruleViolations.length).toBeGreaterThan(0);
  });
});
