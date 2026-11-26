import { describe, expect, it } from 'vitest';
import { AuditTrailService } from '../src/audit/audit-trail.js';

describe('Audit Trail - Cryptographic Hash Chaining', () => {
  it('should chain events with valid hashes', () => {
    const audit = new AuditTrailService();
    const threadId = 'th-audit-1';
    const pairingCode = 'G2-9999';

    const ev1 = audit.logEvent({
      threadId,
      pairingCode,
      actor: 'user',
      action: 'Created lock',
      toState: 'PENDING_REVIEW',
    });

    const ev2 = audit.logEvent({
      threadId,
      pairingCode,
      actor: 'client',
      action: 'Proposed price increase',
      fromState: 'PENDING_REVIEW',
      toState: 'FLAGGED',
    });

    const ev3 = audit.logEvent({
      threadId,
      pairingCode,
      actor: 'user',
      action: 'Sent counter offer',
      fromState: 'FLAGGED',
      toState: 'COUNTER_SENT',
    });

    expect(ev1.previousHash).toBe('0000000000000000000000000000000000000000000000000000000000000000');
    expect(ev2.previousHash).toBe(ev1.hash);
    expect(ev3.previousHash).toBe(ev2.hash);

    const integrity = audit.verifyChainIntegrity(threadId);
    expect(integrity.isValid).toBe(true);
  });

  it('should detect tampering in the event ledger', () => {
    const audit = new AuditTrailService();
    const threadId = 'th-tamper-1';
    const pairingCode = 'G2-8888';

    audit.logEvent({
      threadId,
      pairingCode,
      actor: 'user',
      action: 'Baseline lock',
      toState: 'PENDING_REVIEW',
    });

    const ev2 = audit.logEvent({
      threadId,
      pairingCode,
      actor: 'client',
      action: 'Message received',
      fromState: 'PENDING_REVIEW',
      toState: 'FLAGGED',
    });

    // Tamper with ev2's action directly
    ev2.action = 'TAMPERED ACTION DATA';

    const integrity = audit.verifyChainIntegrity(threadId);
    expect(integrity.isValid).toBe(false);
    expect(integrity.brokenAtEventId).toBe(ev2.id);
  });
});
