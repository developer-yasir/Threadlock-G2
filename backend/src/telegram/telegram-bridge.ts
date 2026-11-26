import { ActionExecutor } from '../actions/action-executor.js';
import { AuditTrailService } from '../audit/audit-trail.js';
import { DiffEngine } from '../diff-engine/index.js';
import { PairingService } from '../pairing/pairing-service.js';
import { ThreadStateMachine } from '../state-machine/index.js';
import { ThreadStore } from '../storage/store.js';
import { EventStreamService } from '../stream/event-stream.js';
import { EvaluationResult, ThreadLock } from '../types/index.js';
import { TelegramClient } from './telegram-client.js';

export interface TelegramIncomingMessage {
  updateId?: number;
  messageId: number;
  chatId: number | string;
  senderName: string;
  senderUsername?: string;
  text: string;
  timestamp: string;
}

export interface TelegramBridgeResult {
  processed: boolean;
  isCommand?: boolean;
  commandName?: string;
  matchedThread?: ThreadLock;
  evaluation?: EvaluationResult;
  actionTaken: string;
  responseSent?: string;
}

export class TelegramBridgeService {
  private diffEngine: DiffEngine;
  private stateMachine: ThreadStateMachine;
  private auditTrail: AuditTrailService;
  private store: ThreadStore;
  private stream: EventStreamService;
  private pairingService: PairingService;
  private telegramClient: TelegramClient;
  private actionExecutor?: ActionExecutor;
  private pollingActive: boolean = false;
  private pollingAbortController?: AbortController;

  constructor(
    diffEngine: DiffEngine,
    stateMachine: ThreadStateMachine,
    auditTrail: AuditTrailService,
    store: ThreadStore,
    stream: EventStreamService,
    pairingService: PairingService,
    telegramClient: TelegramClient,
    actionExecutor?: ActionExecutor
  ) {
    this.diffEngine = diffEngine;
    this.stateMachine = stateMachine;
    this.auditTrail = auditTrail;
    this.store = store;
    this.stream = stream;
    this.pairingService = pairingService;
    this.telegramClient = telegramClient;
    this.actionExecutor = actionExecutor;
  }

  public setActionExecutor(executor: ActionExecutor): void {
    this.actionExecutor = executor;
  }

  /**
   * Parses standard Telegram Bot API webhook payload
   */
  public parseWebhookPayload(body: any): TelegramIncomingMessage | null {
    const msg = body?.message || body?.edited_message || body?.channel_post;
    if (!msg || !msg.text) return null;

    const from = msg.from || {};
    const senderName = [from.first_name, from.last_name].filter(Boolean).join(' ') || from.username || 'Telegram User';

    return {
      updateId: body.update_id,
      messageId: msg.message_id,
      chatId: msg.chat?.id || 0,
      senderName,
      senderUsername: from.username ? `@${from.username}` : undefined,
      text: msg.text.trim(),
      timestamp: new Date((msg.date || Date.now() / 1000) * 1000).toISOString(),
    };
  }

  /**
   * Processes incoming Telegram messages, commands, or deal negotiation offers
   */
  public async handleMessage(
    incoming: TelegramIncomingMessage,
    pairingCodeHint?: string
  ): Promise<TelegramBridgeResult> {
    const text = incoming.text.trim();

    // ========================================================
    // 1. TELEGRAM LINKING & COMMAND HANDLING (/start, /link)
    // ========================================================
    // Matches /start, /link, /start@bot, /link@bot with optional code e.g. G2-S9EY, s9ey, G2_S9EY
    const linkMatch = text.match(/^\/(?:start|link)(?:@\w+)?(?:\s+(.+))?$/i);
    if (linkMatch) {
      const rawCode = (linkMatch[1]?.trim() || pairingCodeHint || '').toUpperCase();
      let cleanCode = rawCode.replace(/_/g, '-');
      if (cleanCode && !cleanCode.startsWith('G2-') && cleanCode.length === 4) {
        cleanCode = `G2-${cleanCode}`;
      }

      if (cleanCode && /^G2-[A-Z0-9]{4,6}$/.test(cleanCode)) {
        let session = this.pairingService.getSession(cleanCode);
        if (!session) {
          session = this.pairingService.createSession(undefined, cleanCode);
        }

        this.pairingService.linkTelegramChat(session.code, {
          chatId: incoming.chatId,
          username: incoming.senderUsername,
          firstName: incoming.senderName,
          linkedAt: new Date().toISOString(),
        });

        // Ensure an active deal lock exists for this session
        let thread = session.activeThreadId ? this.store.get(session.activeThreadId) : undefined;
        if (!thread) {
          const existing = this.store.listByPairingCode(session.code);
          if (existing.length > 0) {
            thread = existing[0];
            session.activeThreadId = thread.id;
          } else {
            thread = this.store.create({
              id: `th-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              pairingCode: session.code,
              title: 'Active Deal Lock',
              counterparty: incoming.senderUsername || incoming.senderName || 'Client',
              channel: 'telegram',
              baselineSummary: 'Agreed deal deliverables and milestones.',
              lockedTerms: {
                price: 10000,
                currency: 'USD',
                deadline: '2026-11-30',
                scope: ['Core Deliverables', 'Milestone Review'],
              },
              currentState: 'PENDING_REVIEW',
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            session.activeThreadId = thread.id;
            this.auditTrail.logEvent({
              threadId: thread.id,
              pairingCode: session.code,
              actor: 'telegram-bridge',
              action: `Deal lock auto-initialized for Telegram pairing session ${session.code}`,
              toState: 'PENDING_REVIEW',
            });
          }
        }

        const replyText = [
          `🔒 <b>ThreadLock G2 Linked!</b>`,
          ``,
          `<b>Session:</b> <code>${session.code}</code>`,
          `<b>Active Deal:</b> ${thread.title}`,
          `<b>Locked Rate:</b> $${thread.lockedTerms.price?.toLocaleString() || 0} ${thread.lockedTerms.currency || 'USD'}`,
          `<b>Deadline:</b> ${thread.lockedTerms.deadline || 'N/A'}`,
          `<b>Current State:</b> <code>${thread.currentState}</code>`,
          ``,
          `<i>Monitoring active! Any proposal or terms shift discussed in this chat will be evaluated live on your Even Realities G2 HUD.</i>`,
          ``,
          `<b>Commands:</b>`,
          `• Send any offer message (e.g. <i>"Price is $11,500 by Dec 15"</i>)`,
          `• /status - Check deal lock status`,
          `• /counter - Send a counter-offer`,
          `• /flag - Flag terms drift`,
          `• /lock - Lock new agreed terms`,
          `• /undo - Revert accidental action`,
        ].join('\n');

        await this.telegramClient.sendMessage({
          chatId: incoming.chatId,
          text: replyText,
          type: 'STATUS_REPLY',
          threadId: thread.id,
          pairingCode: session.code,
        });

        this.stream.broadcastToPairing(session.code, 'telegram_linked', {
          pairingCode: session.code,
          chatId: incoming.chatId,
          username: incoming.senderUsername,
          senderName: incoming.senderName,
          activeThreadId: thread.id,
        });

        return {
          processed: true,
          isCommand: true,
          commandName: 'link',
          matchedThread: thread,
          actionTaken: `Linked chat ${incoming.chatId} to pairing session ${session.code}`,
          responseSent: replyText,
        };
      }

      // If no valid code provided with /start or /link
      const promptReply = [
        `👋 <b>ThreadLock G2 Telegram Bot</b>`,
        ``,
        `Please provide your 6-character G2 pairing code from your HUD or Companion to link:`,
        `<code>/link G2-XXXX</code>`,
        ``,
        `<i>Example: <code>/link G2-S9EY</code></i>`,
      ].join('\n');

      await this.telegramClient.sendMessage({
        chatId: incoming.chatId,
        text: promptReply,
        type: 'STATUS_REPLY',
        threadId: 'system',
        pairingCode: 'G2-UNPAIRED',
      });

      return {
        processed: true,
        isCommand: true,
        commandName: 'start',
        actionTaken: 'Awaiting pairing code',
        responseSent: promptReply,
      };
    }

    // ========================================================
    // 2. FIND MATCHING THREAD VIA LINKED SESSION OR HINT
    // ========================================================
    let pairedSession = this.pairingService.getPairingByChatId(incoming.chatId);
    if (!pairedSession && pairingCodeHint) {
      pairedSession = this.pairingService.getSession(pairingCodeHint);
    }

    const candidateThreads = pairedSession
      ? this.store.listByPairingCode(pairedSession.code)
      : (pairingCodeHint ? this.store.listByPairingCode(pairingCodeHint) : []);

    let matchedThread: ThreadLock | undefined;
    if (candidateThreads.length > 0) {
      // 1. Prioritize matching by sender handle or counterparty name
      matchedThread = candidateThreads.find(t =>
        (incoming.senderUsername && t.counterparty.toLowerCase().includes(incoming.senderUsername.toLowerCase())) ||
        (incoming.senderName && t.counterparty.toLowerCase().includes(incoming.senderName.toLowerCase()))
      );

      // 2. Fall back to session's active thread
      if (!matchedThread && pairedSession?.activeThreadId) {
        matchedThread = candidateThreads.find(t => t.id === pairedSession!.activeThreadId);
      }

      // 3. Fall back to first thread
      if (!matchedThread) {
        matchedThread = candidateThreads[0];
      }
    }

    if (!matchedThread) {
      const unlinkedPrompt = `⚠️ <b>ThreadLock G2:</b> This chat is not yet linked to an active session.\nPlease send <code>/link G2-XXXX</code> with your code from your G2 HUD or Companion.`;
      await this.telegramClient.sendMessage({
        chatId: incoming.chatId,
        text: unlinkedPrompt,
        type: 'STATUS_REPLY',
        threadId: 'system',
        pairingCode: 'G2-UNPAIRED',
      });

      return {
        processed: false,
        actionTaken: 'No active thread lock found matching chat or counterparty',
        responseSent: unlinkedPrompt,
      };
    }

    // ========================================================
    // 3. ACTION COMMANDS (/status, /lock, /flag, /counter, /undo)
    // ========================================================
    if (text.startsWith('/')) {
      const rawCmd = text.split(' ')[0].toLowerCase();
      const cmd = rawCmd.split('@')[0]; // Strip bot mention suffix (e.g. /counter@threadlock_g2_bot -> /counter)

      if (cmd === '/status') {
        const locked = matchedThread.lockedTerms;
        const statusText = [
          `📊 <b>ThreadLock Status: ${matchedThread.title}</b>`,
          `<b>State:</b> <code>${matchedThread.currentState}</code>`,
          `<b>Price:</b> $${locked.price?.toLocaleString() || 0} ${locked.currency || 'USD'}`,
          `<b>Deadline:</b> ${locked.deadline || 'N/A'}`,
          `<b>Scope:</b> ${locked.scope?.join(', ') || 'N/A'}`,
          matchedThread.latestDiff ? `<b>Latest Diff:</b> ${matchedThread.latestDiff.glance?.headlineDiff}` : '',
          ``,
          `<i>Use /counter to negotiate, /flag to dispute, /lock to confirm, or /undo to revert.</i>`,
        ].filter(Boolean).join('\n');

        await this.telegramClient.sendMessage({
          chatId: incoming.chatId,
          text: statusText,
          type: 'STATUS_REPLY',
          threadId: matchedThread.id,
          pairingCode: matchedThread.pairingCode,
        });

        return {
          processed: true,
          isCommand: true,
          commandName: 'status',
          matchedThread,
          actionTaken: 'Status reported',
          responseSent: statusText,
        };
      }

      if (this.actionExecutor) {
        if (cmd === '/lock') {
          try {
            const res = await this.actionExecutor.executeAction({
              threadId: matchedThread.id,
              pairingCode: matchedThread.pairingCode,
              action: 'LOCK',
              actor: incoming.senderUsername || incoming.senderName,
              chatId: incoming.chatId,
              withUndoWindow: true,
            });

            return {
              processed: true,
              isCommand: true,
              commandName: 'lock',
              matchedThread: res.thread,
              actionTaken: res.message,
              responseSent: res.outgoingMessage?.text || res.message,
            };
          } catch (err: any) {
            const errMsg = `⚠️ <b>Lock Failed:</b> ${err.message}`;
            await this.telegramClient.sendMessage({
              chatId: incoming.chatId,
              text: errMsg,
              type: 'STATUS_REPLY',
              threadId: matchedThread.id,
              pairingCode: matchedThread.pairingCode,
            });
            return { processed: false, isCommand: true, commandName: 'lock', actionTaken: err.message };
          }
        }

        if (cmd === '/flag') {
          try {
            const res = await this.actionExecutor.executeAction({
              threadId: matchedThread.id,
              pairingCode: matchedThread.pairingCode,
              action: 'FLAG',
              actor: incoming.senderUsername || incoming.senderName,
              chatId: incoming.chatId,
            });

            return {
              processed: true,
              isCommand: true,
              commandName: 'flag',
              matchedThread: res.thread,
              actionTaken: res.message,
              responseSent: res.outgoingMessage?.text || res.message,
            };
          } catch (err: any) {
            const errMsg = `⚠️ <b>Flag Failed:</b> ${err.message}`;
            await this.telegramClient.sendMessage({
              chatId: incoming.chatId,
              text: errMsg,
              type: 'STATUS_REPLY',
              threadId: matchedThread.id,
              pairingCode: matchedThread.pairingCode,
            });
            return { processed: false, isCommand: true, commandName: 'flag', actionTaken: err.message };
          }
        }

        if (cmd === '/counter') {
          try {
            const res = await this.actionExecutor.executeAction({
              threadId: matchedThread.id,
              pairingCode: matchedThread.pairingCode,
              action: 'COUNTER',
              actor: incoming.senderUsername || incoming.senderName,
              chatId: incoming.chatId,
              withUndoWindow: true,
            });

            return {
              processed: true,
              isCommand: true,
              commandName: 'counter',
              matchedThread: res.thread,
              actionTaken: res.message,
              responseSent: res.outgoingMessage?.text || res.message,
            };
          } catch (err: any) {
            const errMsg = `⚠️ <b>Counter Failed:</b> ${err.message}`;
            await this.telegramClient.sendMessage({
              chatId: incoming.chatId,
              text: errMsg,
              type: 'STATUS_REPLY',
              threadId: matchedThread.id,
              pairingCode: matchedThread.pairingCode,
            });
            return { processed: false, isCommand: true, commandName: 'counter', actionTaken: err.message };
          }
        }

        if (cmd === '/undo') {
          try {
            const res = await this.actionExecutor.executeAction({
              threadId: matchedThread.id,
              pairingCode: matchedThread.pairingCode,
              action: 'UNDO',
              actor: incoming.senderUsername || incoming.senderName,
              chatId: incoming.chatId,
            });

            return {
              processed: true,
              isCommand: true,
              commandName: 'undo',
              matchedThread: res.thread,
              actionTaken: res.message,
              responseSent: res.outgoingMessage?.text || res.message,
            };
          } catch (err: any) {
            const errMsg = `⚠️ <b>Undo Unavailable:</b> ${err.message}.\nDeal is currently in state <code>${matchedThread.currentState}</code>. Undo is permitted within the 30-second window following an action.`;
            await this.telegramClient.sendMessage({
              chatId: incoming.chatId,
              text: errMsg,
              type: 'STATUS_REPLY',
              threadId: matchedThread.id,
              pairingCode: matchedThread.pairingCode,
            });
            return { processed: false, isCommand: true, commandName: 'undo', actionTaken: err.message };
          }
        }
      }
    }

    // ========================================================
    // 4. NEGOTIATION PROPOSAL / MESSAGE DIFF EVALUATION
    // ========================================================
    const evaluation = await this.diffEngine.evaluate(
      matchedThread.lockedTerms,
      matchedThread.baselineSummary,
      incoming.text
    );

    matchedThread.latestDiff = evaluation;
    matchedThread.lastEvaluatedAt = new Date().toISOString();

    const fromState = matchedThread.currentState;
    let targetState = fromState;
    let actionTaken = 'Evaluated message';

    // State transition & alert logic
    if (evaluation.hasDrift) {
      targetState = evaluation.severity === 'HIGH' ? 'FLAGGED' : 'PENDING_REVIEW';
      if (this.stateMachine.canTransition(fromState, targetState)) {
        this.stateMachine.transition(matchedThread, targetState, { actor: 'telegram-bridge' });
      }
      actionTaken = `Drift detected (${evaluation.severity}) - Transitioned to ${matchedThread.currentState}`;
    } else {
      actionTaken = 'Terms verified - No drift';
    }

    this.store.update(matchedThread);

    // Tamper-evident SHA-256 audit trail
    this.auditTrail.logEvent({
      threadId: matchedThread.id,
      pairingCode: matchedThread.pairingCode,
      actor: incoming.senderUsername || incoming.senderName,
      action: `Telegram message evaluated: "${incoming.text.substring(0, 50)}..."`,
      fromState,
      toState: matchedThread.currentState,
      metadata: {
        chatId: incoming.chatId,
        messageId: incoming.messageId,
      },
      diffSnapshot: evaluation,
    });

    // Broadcast real-time alert to paired G2 glasses HUD and companion
    this.stream.broadcastToPairing(matchedThread.pairingCode, 'diff_alert', {
      threadId: matchedThread.id,
      threadTitle: matchedThread.title,
      sender: incoming.senderName,
      messageText: incoming.text,
      state: matchedThread.currentState,
      evaluation,
      glance: evaluation.glance,
    });

    // Send immediate Telegram reply to counterparty
    let feedbackReply = '';
    if (evaluation.hasDrift) {
      feedbackReply = [
        `⚠️ <b>ThreadLock G2 — Drift Alert Detected</b>`,
        ``,
        `<b>Diff:</b> <code>${evaluation.glance.headlineDiff}</code>`,
        `<b>Old:</b> ${evaluation.glance.oldValue} | <b>New:</b> ${evaluation.glance.newValue}`,
        `<b>Recommendation:</b> ${evaluation.glance.recommendedAction}`,
        ``,
        `<i>Alert pushed to Even Realities G2 HUD. Reply with:</i>`,
        `• /counter - Send a counter-offer`,
        `• /flag - Dispute terms drift`,
        `• /lock - Accept & lock new baseline`,
      ].join('\n');
    } else {
      feedbackReply = [
        `✅ <b>ThreadLock G2 — Terms Verified</b>`,
        `All terms align with locked baseline (<code>${evaluation.glance.headlineDiff}</code>).`,
      ].join('\n');
    }

    await this.telegramClient.sendMessage({
      chatId: incoming.chatId,
      text: feedbackReply,
      type: 'STATUS_REPLY',
      threadId: matchedThread.id,
      pairingCode: matchedThread.pairingCode,
    });

    return {
      processed: true,
      matchedThread,
      evaluation,
      actionTaken,
      responseSent: feedbackReply,
    };
  }

  /**
   * Starts Telegram long-polling worker if token configured
   */
  public async startPolling(): Promise<void> {
    if (!this.telegramClient.hasToken() || this.pollingActive) return;

    this.pollingActive = true;
    this.pollingAbortController = new AbortController();
    let offset = 0;

    const token = this.telegramClient.getToken();

    // Ensure webhook is removed first so getUpdates does not encounter 409 Conflict
    await this.telegramClient.deleteWebhook(false).catch(() => {});

    (async () => {
      while (this.pollingActive) {
        try {
          const data = await this.telegramClient.apiCall<any[]>(`getUpdates?offset=${offset}&timeout=10`);
          if (data && data.ok && Array.isArray(data.result)) {
            for (const update of data.result) {
              offset = update.update_id + 1;
              const parsed = this.parseWebhookPayload(update);
              if (parsed) {
                await this.handleMessage(parsed);
              }
            }
          } else {
            await new Promise(r => setTimeout(r, 2000));
          }
        } catch (err: any) {
          if (err.name === 'AbortError') break;
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    })();
  }

  public isPolling(): boolean {
    return this.pollingActive;
  }

  public stopPolling(): void {
    this.pollingActive = false;
    this.pollingAbortController?.abort();
  }
}
