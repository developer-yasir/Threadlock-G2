import { createHash } from 'node:crypto';
import { AuditEvent, EvaluationResult, ThreadState } from '../types/index.js';

export class AuditTrailService {
  private events: AuditEvent[] = [];
  private lastHashByThread: Map<string, string> = new Map();

  private computeHash(
    previousHash: string,
    timestamp: string,
    threadId: string,
    pairingCode: string,
    actor: string,
    action: string,
    fromState?: ThreadState,
    toState?: ThreadState,
    diffSnapshot?: EvaluationResult
  ): string {
    const data = JSON.stringify({
      previousHash,
      timestamp,
      threadId,
      pairingCode,
      actor,
      action,
      fromState,
      toState,
      diffSnapshot: diffSnapshot ? {
        hasDrift: diffSnapshot.hasDrift,
        severity: diffSnapshot.severity,
        diffs: diffSnapshot.structuredDiffs,
      } : null,
    });
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Appends an audit event to the ledger with tamper-evident cryptographic hash chaining
   */
  public logEvent(params: {
    threadId: string;
    pairingCode: string;
    actor: string;
    action: string;
    fromState?: ThreadState;
    toState?: ThreadState;
    metadata?: Record<string, any>;
    diffSnapshot?: EvaluationResult;
  }): AuditEvent {
    const { threadId, pairingCode, actor, action, fromState, toState, metadata, diffSnapshot } = params;
    const timestamp = new Date().toISOString();
    const previousHash = this.lastHashByThread.get(threadId) || '0000000000000000000000000000000000000000000000000000000000000000';

    const hash = this.computeHash(
      previousHash,
      timestamp,
      threadId,
      pairingCode,
      actor,
      action,
      fromState,
      toState,
      diffSnapshot
    );

    const event: AuditEvent = {
      id: `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      threadId,
      pairingCode,
      timestamp,
      actor,
      action,
      fromState,
      toState,
      metadata,
      diffSnapshot,
      previousHash,
      hash,
    };

    this.events.push(event);
    this.lastHashByThread.set(threadId, hash);
    return event;
  }

  /**
   * Returns all audit events for a thread
   */
  public getEventsForThread(threadId: string): AuditEvent[] {
    return this.events.filter(e => e.threadId === threadId);
  }

  /**
   * Returns all audit events for a pairing code (pairing isolation check)
   */
  public getEventsForPairingCode(pairingCode: string): AuditEvent[] {
    return this.events.filter(e => e.pairingCode === pairingCode);
  }

  /**
   * Verifies the cryptographic chain integrity of a thread's audit trail
   */
  public verifyChainIntegrity(threadId: string): { isValid: boolean; brokenAtEventId?: string } {
    const threadEvents = this.getEventsForThread(threadId);
    let expectedPrevious = '0000000000000000000000000000000000000000000000000000000000000000';

    for (const evt of threadEvents) {
      if (evt.previousHash !== expectedPrevious) {
        return { isValid: false, brokenAtEventId: evt.id };
      }

      const recalculated = this.computeHash(
        evt.previousHash,
        evt.timestamp,
        evt.threadId,
        evt.pairingCode,
        evt.actor,
        evt.action,
        evt.fromState,
        evt.toState,
        evt.diffSnapshot
      );

      if (recalculated !== evt.hash) {
        return { isValid: false, brokenAtEventId: evt.id };
      }

      expectedPrevious = evt.hash;
    }

    return { isValid: true };
  }

  public clear(): void {
    this.events = [];
    this.lastHashByThread.clear();
  }
}
