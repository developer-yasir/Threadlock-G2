import { AuditTrailService } from '../audit/audit-trail.js';
import { PairingService } from '../pairing/pairing-service.js';
import { ThreadStateMachine } from '../state-machine/index.js';
import { ThreadStore } from '../storage/store.js';
import { EventStreamService } from '../stream/event-stream.js';
import { TelegramClient } from '../telegram/telegram-client.js';
import { ActionExecutionRequest, ActionExecutionResult, OutgoingMessage, StructuredTerms, ThreadLock } from '../types/index.js';
import { CounterOfferGenerator } from './counter-generator.js';

export class ActionExecutor {
  private store: ThreadStore;
  private stateMachine: ThreadStateMachine;
  private auditTrail: AuditTrailService;
  private stream: EventStreamService;
  private telegramClient: TelegramClient;
  private pairingService: PairingService;
  private counterGenerator: CounterOfferGenerator;

  constructor(
    store: ThreadStore,
    stateMachine: ThreadStateMachine,
    auditTrail: AuditTrailService,
    stream: EventStreamService,
    telegramClient: TelegramClient,
    pairingService: PairingService,
    counterGenerator?: CounterOfferGenerator
  ) {
    this.store = store;
    this.stateMachine = stateMachine;
    this.auditTrail = auditTrail;
    this.stream = stream;
    this.telegramClient = telegramClient;
    this.pairingService = pairingService;
    this.counterGenerator = counterGenerator || new CounterOfferGenerator();
  }

  public async executeAction(request: ActionExecutionRequest): Promise<ActionExecutionResult> {
    const { threadId, pairingCode, action, actor, customNote, targetTerms, withUndoWindow } = request;

    const thread = this.store.get(threadId);
    if (!thread) {
      throw new Error(`Thread not found: ${threadId}`);
    }

    if (pairingCode && thread.pairingCode !== pairingCode) {
      throw new Error(`Access denied: thread ${threadId} does not belong to pairing session ${pairingCode}`);
    }

    const session = this.pairingService.getSession(thread.pairingCode);
    const linkedChatId = request.chatId || session?.telegramLink?.chatId;
    const shouldSendTelegram = request.sendTelegramNotification !== false && !!linkedChatId;

    let outgoingMessage: OutgoingMessage | undefined;
    let messageResult = '';
    const fromState = thread.currentState;

    switch (action) {
      case 'LOCK': {
        // 1. Save previous baseline for safe rollback
        thread.previousLockedTerms = JSON.parse(JSON.stringify(thread.lockedTerms));

        // 2. Compute newly locked terms
        const updatedTerms: StructuredTerms = {
          ...thread.lockedTerms,
          ...(targetTerms || {}),
        };

        // If targetTerms wasn't explicitly passed, apply terms from latest evaluated diff
        if (!targetTerms && thread.latestDiff?.structuredDiffs) {
          for (const diff of thread.latestDiff.structuredDiffs) {
            if (diff.field === 'price' && typeof diff.newValue === 'string') {
              const parsedNum = parseFloat(diff.newValue.replace(/[^0-9.]/g, ''));
              if (!isNaN(parsedNum)) updatedTerms.price = parsedNum;
            } else if (diff.field === 'deadline' && typeof diff.newValue === 'string') {
              updatedTerms.deadline = diff.newValue;
            } else if (diff.field === 'scope' && diff.driftType === 'SCOPE_CREEP' && typeof diff.newValue === 'string') {
              const currentScope = updatedTerms.scope || [];
              if (!currentScope.includes(diff.newValue)) {
                updatedTerms.scope = [...currentScope, diff.newValue];
              }
            }
          }
        }

        thread.lockedTerms = updatedTerms;

        // 3. Transition state
        const transition = this.stateMachine.transition(thread, 'LOCKED_NEW', {
          withUndoWindow: withUndoWindow ?? true,
          actor: actor || 'g2-glasses',
        });

        // 4. Update store
        this.store.update(thread);

        // 5. Send Telegram confirmation if chat linked
        if (shouldSendTelegram && linkedChatId) {
          outgoingMessage = await this.telegramClient.sendLockConfirmation(linkedChatId, thread);
        }

        // 6. Log audit event
        const auditEvent = this.auditTrail.logEvent({
          threadId: thread.id,
          pairingCode: thread.pairingCode,
          actor: actor || 'g2-glasses',
          action: 'Terms Locked to New Baseline',
          fromState,
          toState: thread.currentState,
          metadata: {
            newLockedTerms: thread.lockedTerms,
            previousLockedTerms: thread.previousLockedTerms,
            inUndoWindow: transition.inUndoWindow,
            undoDeadline: transition.undoDeadline,
            telegramSent: !!outgoingMessage,
          },
          diffSnapshot: thread.latestDiff,
        });

        // 7. Broadcast SSE to G2 HUD & Companion
        this.broadcastAction('LOCK', thread, transition, auditEvent, outgoingMessage);

        messageResult = `Terms successfully locked. New baseline active.`;
        return {
          success: true,
          action: 'LOCK',
          thread,
          outgoingMessage,
          inUndoWindow: transition.inUndoWindow,
          undoDeadline: transition.undoDeadline,
          auditEvent,
          message: messageResult,
        };
      }

      case 'FLAG': {
        const reason = customNote || thread.latestDiff?.glance?.shortReason || 'Unapproved terms drift detected';
        thread.flagReason = reason;

        const transition = this.stateMachine.transition(thread, 'FLAGGED', {
          withUndoWindow: false,
          actor: actor || 'g2-glasses',
        });

        this.store.update(thread);

        if (shouldSendTelegram && linkedChatId) {
          outgoingMessage = await this.telegramClient.sendFlagAlert(linkedChatId, thread, reason);
        }

        const auditEvent = this.auditTrail.logEvent({
          threadId: thread.id,
          pairingCode: thread.pairingCode,
          actor: actor || 'g2-glasses',
          action: `Terms Drift Flagged: ${reason}`,
          fromState,
          toState: thread.currentState,
          metadata: {
            flagReason: reason,
            telegramSent: !!outgoingMessage,
          },
          diffSnapshot: thread.latestDiff,
        });

        this.broadcastAction('FLAG', thread, transition, auditEvent, outgoingMessage);

        messageResult = `Drift flagged: ${reason}`;
        return {
          success: true,
          action: 'FLAG',
          thread,
          outgoingMessage,
          inUndoWindow: false,
          auditEvent,
          message: messageResult,
        };
      }

      case 'COUNTER': {
        // 1. Generate counter-offer text
        const counterText = await this.counterGenerator.generateCounter(
          thread,
          thread.latestDiff,
          customNote
        );

        // 2. Transition state
        const transition = this.stateMachine.transition(thread, 'COUNTER_SENT', {
          withUndoWindow: withUndoWindow ?? true,
          actor: actor || 'g2-glasses',
        });

        this.store.update(thread);

        // 3. Dispatch to Telegram
        if (shouldSendTelegram && linkedChatId) {
          outgoingMessage = await this.telegramClient.sendCounterOffer(linkedChatId, thread, counterText);
        } else {
          // Queue internally if no active Telegram link
          outgoingMessage = await this.telegramClient.sendMessage({
            chatId: 'internal-queue',
            text: counterText,
            type: 'COUNTER_OFFER',
            threadId: thread.id,
            pairingCode: thread.pairingCode,
          });
        }

        const auditEvent = this.auditTrail.logEvent({
          threadId: thread.id,
          pairingCode: thread.pairingCode,
          actor: actor || 'g2-glasses',
          action: 'Counter-Offer Dispatched',
          fromState,
          toState: thread.currentState,
          metadata: {
            counterText,
            telegramSent: !!outgoingMessage,
            inUndoWindow: transition.inUndoWindow,
            undoDeadline: transition.undoDeadline,
          },
          diffSnapshot: thread.latestDiff,
        });

        this.broadcastAction('COUNTER', thread, transition, auditEvent, outgoingMessage);

        messageResult = `Counter-offer dispatched: "${counterText}"`;
        return {
          success: true,
          action: 'COUNTER',
          thread,
          outgoingMessage,
          inUndoWindow: transition.inUndoWindow,
          undoDeadline: transition.undoDeadline,
          auditEvent,
          message: messageResult,
        };
      }

      case 'UNDO': {
        // Safe rollback
        const transition = this.stateMachine.undo(thread);

        // If previously locked terms were saved, restore them
        if (thread.previousLockedTerms) {
          thread.lockedTerms = JSON.parse(JSON.stringify(thread.previousLockedTerms));
          thread.previousLockedTerms = undefined;
        }

        this.store.update(thread);

        if (shouldSendTelegram && linkedChatId) {
          outgoingMessage = await this.telegramClient.sendUndoNotice(linkedChatId, thread);
        }

        const auditEvent = this.auditTrail.logEvent({
          threadId: thread.id,
          pairingCode: thread.pairingCode,
          actor: actor || 'g2-glasses',
          action: `Action Rolled Back (Undo): State restored to ${transition.newState}`,
          fromState,
          toState: transition.newState,
          metadata: {
            restoredTerms: thread.lockedTerms,
          },
        });

        this.broadcastAction('UNDO', thread, transition, auditEvent, outgoingMessage);

        messageResult = `Action undone. Restored to ${transition.newState}.`;
        return {
          success: true,
          action: 'UNDO',
          thread,
          outgoingMessage,
          inUndoWindow: false,
          auditEvent,
          message: messageResult,
        };
      }

      default:
        throw new Error(`Unsupported action: ${action}`);
    }
  }

  private broadcastAction(
    action: string,
    thread: ThreadLock,
    transition: any,
    auditEvent: any,
    outgoingMessage?: OutgoingMessage
  ): void {
    this.stream.broadcastToPairing(thread.pairingCode, 'action_executed', {
      action,
      threadId: thread.id,
      threadTitle: thread.title,
      state: thread.currentState,
      transition,
      auditEvent,
      outgoingMessage,
      lockedTerms: thread.lockedTerms,
    });
  }
}
