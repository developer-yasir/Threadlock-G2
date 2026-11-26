import { ThreadLock, ThreadState } from '../types/index.js';

export interface TransitionResult {
  previousState: ThreadState;
  newState: ThreadState;
  inUndoWindow: boolean;
  undoDeadline?: string;
  timestamp: string;
}

export class InvalidStateTransitionError extends Error {
  public fromState: ThreadState;
  public toState: ThreadState;

  constructor(fromState: ThreadState, toState: ThreadState, message?: string) {
    super(message || `Invalid state transition from ${fromState} to ${toState}`);
    this.name = 'InvalidStateTransitionError';
    this.fromState = fromState;
    this.toState = toState;
  }
}

/**
 * Valid state transition graph
 */
const ALLOWED_TRANSITIONS: Record<ThreadState, ThreadState[]> = {
  PENDING_REVIEW: ['LOCKED_NEW', 'FLAGGED', 'COUNTER_SENT', 'UNDO_WINDOW'],
  FLAGGED: ['COUNTER_SENT', 'LOCKED_NEW', 'PENDING_REVIEW', 'UNDO_WINDOW'],
  COUNTER_SENT: ['PENDING_REVIEW', 'FLAGGED', 'UNDO_WINDOW'],
  LOCKED_NEW: ['PENDING_REVIEW', 'FLAGGED', 'UNDO_WINDOW'],
  UNDO_WINDOW: ['PENDING_REVIEW', 'FLAGGED', 'COUNTER_SENT', 'LOCKED_NEW'],
};

export class ThreadStateMachine {
  private defaultUndoSeconds: number;

  constructor(defaultUndoSeconds: number = 30) {
    this.defaultUndoSeconds = defaultUndoSeconds;
  }

  /**
   * Validates whether transition from currentState to targetState is permitted
   */
  public canTransition(currentState: ThreadState, targetState: ThreadState): boolean {
    if (currentState === targetState) return true;
    const allowed = ALLOWED_TRANSITIONS[currentState] || [];
    return allowed.includes(targetState);
  }

  /**
   * Safely transitions thread to a new state
   */
  public transition(
    thread: ThreadLock,
    targetState: ThreadState,
    options?: { withUndoWindow?: boolean; actor?: string }
  ): TransitionResult {
    const currentState = thread.currentState;

    if (!this.canTransition(currentState, targetState)) {
      throw new InvalidStateTransitionError(
        currentState,
        targetState,
        `Cannot transition thread ${thread.id} from ${currentState} to ${targetState}`
      );
    }

    const timestamp = new Date().toISOString();
    let finalState = targetState;
    let undoDeadline: string | undefined = undefined;
    let inUndoWindow = false;

    // If undo window requested (e.g. for user actions on glasses/web)
    if (options?.withUndoWindow && (targetState === 'LOCKED_NEW' || targetState === 'COUNTER_SENT')) {
      inUndoWindow = true;
      finalState = 'UNDO_WINDOW';
      const deadlineDate = new Date(Date.now() + this.defaultUndoSeconds * 1000);
      undoDeadline = deadlineDate.toISOString();
    }

    thread.previousState = currentState;
    thread.currentState = finalState;
    thread.undoDeadline = undoDeadline;
    thread.updatedAt = timestamp;

    return {
      previousState: currentState,
      newState: finalState,
      inUndoWindow,
      undoDeadline,
      timestamp,
    };
  }

  /**
   * Reverts an active UNDO_WINDOW transition back to the previous state
   */
  public undo(thread: ThreadLock): TransitionResult {
    if (thread.currentState !== 'UNDO_WINDOW') {
      throw new Error(`Cannot undo: thread ${thread.id} is in state ${thread.currentState}, not in UNDO_WINDOW`);
    }

    if (!thread.previousState) {
      throw new Error(`Cannot undo: thread ${thread.id} has no previous state recorded`);
    }

    // Check if undo deadline expired
    if (thread.undoDeadline && new Date() > new Date(thread.undoDeadline)) {
      throw new Error(`Cannot undo: Undo window for thread ${thread.id} expired at ${thread.undoDeadline}`);
    }

    const previousState = thread.previousState;
    const fromState = thread.currentState;
    const timestamp = new Date().toISOString();

    thread.currentState = previousState;
    thread.previousState = fromState;
    thread.undoDeadline = undefined;
    thread.updatedAt = timestamp;

    return {
      previousState: fromState,
      newState: previousState,
      inUndoWindow: false,
      timestamp,
    };
  }

  /**
   * Commits/finalizes an active UNDO_WINDOW to its designated state (e.g. LOCKED_NEW)
   */
  public finalizeUndoWindow(thread: ThreadLock, committedState: ThreadState): TransitionResult {
    if (thread.currentState !== 'UNDO_WINDOW') {
      throw new Error(`Thread ${thread.id} is not in UNDO_WINDOW`);
    }

    const timestamp = new Date().toISOString();
    const fromState = thread.currentState;

    thread.currentState = committedState;
    thread.undoDeadline = undefined;
    thread.updatedAt = timestamp;

    return {
      previousState: fromState,
      newState: committedState,
      inUndoWindow: false,
      timestamp,
    };
  }
}
