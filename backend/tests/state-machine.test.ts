import { describe, expect, it } from 'vitest';
import { ThreadStateMachine, InvalidStateTransitionError } from '../src/state-machine/index.js';
import { ThreadLock } from '../src/types/index.js';

describe('State Machine & Undo Window', () => {
  const machine = new ThreadStateMachine(30);

  const createDummyThread = (): ThreadLock => ({
    id: 'th-test-1',
    pairingCode: 'G2-TEST',
    title: 'Test Deal',
    counterparty: 'Client Acme',
    channel: 'manual',
    baselineSummary: 'MVP build',
    lockedTerms: { price: 5000 },
    currentState: 'PENDING_REVIEW',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  it('should allow valid transition from PENDING_REVIEW to FLAGGED', () => {
    const thread = createDummyThread();
    const result = machine.transition(thread, 'FLAGGED');

    expect(result.previousState).toBe('PENDING_REVIEW');
    expect(result.newState).toBe('FLAGGED');
    expect(thread.currentState).toBe('FLAGGED');
    expect(thread.previousState).toBe('PENDING_REVIEW');
  });

  it('should support entering UNDO_WINDOW and rolling back', () => {
    const thread = createDummyThread();
    thread.currentState = 'PENDING_REVIEW';

    // Transition to LOCKED_NEW with undo window
    const result = machine.transition(thread, 'LOCKED_NEW', { withUndoWindow: true });
    expect(result.inUndoWindow).toBe(true);
    expect(result.newState).toBe('UNDO_WINDOW');
    expect(thread.currentState).toBe('UNDO_WINDOW');
    expect(thread.undoDeadline).toBeDefined();

    // Perform rollback
    const undoResult = machine.undo(thread);
    expect(undoResult.newState).toBe('PENDING_REVIEW');
    expect(thread.currentState).toBe('PENDING_REVIEW');
    expect(thread.undoDeadline).toBeUndefined();
  });

  it('should finalize UNDO_WINDOW to target state', () => {
    const thread = createDummyThread();
    machine.transition(thread, 'LOCKED_NEW', { withUndoWindow: true });
    expect(thread.currentState).toBe('UNDO_WINDOW');

    const finalized = machine.finalizeUndoWindow(thread, 'LOCKED_NEW');
    expect(finalized.newState).toBe('LOCKED_NEW');
    expect(thread.currentState).toBe('LOCKED_NEW');
  });

  it('should throw error when calling undo on non-undo state', () => {
    const thread = createDummyThread();
    thread.currentState = 'FLAGGED';

    expect(() => machine.undo(thread)).toThrow(/not in UNDO_WINDOW/);
  });

  it('should block invalid state transition', () => {
    const thread = createDummyThread();
    // Simulate an impossible state or mock non-allowed transition
    // E.g. trying to transition with undefined target or from invalid state
    expect(machine.canTransition('PENDING_REVIEW', 'UNKNOWN' as any)).toBe(false);

    expect(() => {
      machine.transition(thread, 'UNKNOWN' as any);
    }).toThrow(InvalidStateTransitionError);
  });
});
