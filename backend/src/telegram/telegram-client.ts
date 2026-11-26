import dns from 'node:dns';
import { OutgoingMessage, ThreadLock } from '../types/index.js';

// Ensure IPv6/IPv4 resolution order is verbatim for reliable Telegram connectivity
try {
  dns.setDefaultResultOrder('verbatim');
} catch {}

export class TelegramClient {
  private botToken?: string;
  private queue: OutgoingMessage[] = [];

  constructor(botToken?: string) {
    this.botToken = botToken || process.env.TELEGRAM_BOT_TOKEN;
  }

  public setToken(token: string): void {
    this.botToken = token;
  }

  public getToken(): string | undefined {
    return this.botToken;
  }

  public hasToken(): boolean {
    return !!this.botToken && this.botToken.trim().length > 0;
  }

  /**
   * Universal resilient Telegram API request:
   * Tries fetch first with fast timeout; falls back seamlessly to system curl with retries if TLS renegotiation/DPI resets connection.
   */
  public async apiCall<T = any>(endpoint: string, body?: any, timeoutMs: number = 8000): Promise<{ ok: boolean; result?: T; description?: string; error?: string }> {
    if (!this.hasToken()) {
      return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' };
    }

    const url = `https://api.telegram.org/bot${this.botToken}/${endpoint}`;

    try {
      const res = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(Math.min(timeoutMs, 3000)),
      });
      const data = await res.json() as any;
      return data;
    } catch (fetchErr: any) {
      try {
        const { execFile } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execFileAsync = promisify(execFile);

        const maxTimeSeconds = Math.max(3, Math.ceil(timeoutMs / 1000));
        const args = ['-s', '--max-time', String(maxTimeSeconds), '--retry', '3', '--retry-delay', '1', '--retry-all-errors'];
        if (body) {
          args.push('-X', 'POST', '-H', 'Content-Type: application/json', '-d', JSON.stringify(body));
        }
        args.push(url);

        try {
          const { stdout } = await execFileAsync('curl', args, { timeout: (maxTimeSeconds + 2) * 1000 });
          return JSON.parse(stdout);
        } catch (curlExecErr: any) {
          if (curlExecErr?.stdout) {
            try {
              return JSON.parse(curlExecErr.stdout);
            } catch {}
          }
          throw curlExecErr;
        }
      } catch (curlErr: any) {
        return { ok: false, error: `Network error: ${fetchErr.message} (curl fallback: ${curlErr.message})` };
      }
    }
  }

  /**
   * Verifies credentials against Telegram getMe API
   */
  public async getMe(): Promise<{ ok: boolean; result?: { id: number; is_bot: boolean; first_name: string; username?: string }; error?: string }> {
    if (!this.hasToken()) {
      return { ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' };
    }
    const data = await this.apiCall<{ id: number; is_bot: boolean; first_name: string; username?: string }>('getMe');
    if (data.ok && data.result) {
      return { ok: true, result: data.result };
    }
    return { ok: false, error: data.description || data.error || 'Failed to fetch bot info' };
  }

  /**
   * Deletes active webhook so long-polling works smoothly without 409 conflict
   */
  public async deleteWebhook(dropPendingUpdates: boolean = false): Promise<boolean> {
    if (!this.hasToken()) return false;
    const data = await this.apiCall(`deleteWebhook?drop_pending_updates=${dropPendingUpdates}`);
    return !!data.ok;
  }

  /**
   * Sends a message to a Telegram chat, or safely queues it if offline / no token configured
   */
  public async sendMessage(params: {
    chatId: string | number;
    text: string;
    type: OutgoingMessage['type'];
    threadId: string;
    pairingCode: string;
  }): Promise<OutgoingMessage> {
    const { chatId, text, type, threadId, pairingCode } = params;

    const message: OutgoingMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      threadId,
      pairingCode,
      chatId,
      text,
      type,
      status: 'queued',
      timestamp: new Date().toISOString(),
    };

    this.queue.push(message);

    // If real token available and target is a real chat ID/handle, attempt real delivery via Telegram Bot API
    const isRealChatId = typeof chatId === 'number' || /^-?[0-9]+$/.test(String(chatId)) || String(chatId).startsWith('@');
    if (this.hasToken() && isRealChatId) {
      const data = await this.apiCall('sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      });

      if (data.ok) {
        message.status = 'sent';
      } else {
        message.status = 'queued';
        message.error = `Telegram API error: ${data.description || data.error}`;
      }
    }

    return message;
  }

  /**
   * Sends or queues a formal confirmation when terms are locked on G2
   */
  public async sendLockConfirmation(
    chatId: string | number,
    thread: ThreadLock
  ): Promise<OutgoingMessage> {
    const priceStr = thread.lockedTerms.price !== undefined
      ? `$${thread.lockedTerms.price.toLocaleString()} ${thread.lockedTerms.currency || 'USD'}`
      : 'Agreed Rate';
    const deadlineStr = thread.lockedTerms.deadline || 'As agreed';

    const text = [
      `🔒 <b>ThreadLock G2 — Agreement Locked</b>`,
      ``,
      `<b>Deal:</b> ${thread.title}`,
      `<b>Agreed Price:</b> ${priceStr}`,
      `<b>Agreed Deadline:</b> ${deadlineStr}`,
      thread.lockedTerms.scope?.length ? `<b>Scope:</b> ${thread.lockedTerms.scope.join(', ')}` : '',
      ``,
      `<i>Baseline verified and locked via Even Realities G2 HUD. Any further changes will trigger real-time drift alerts.</i>`,
    ].filter(Boolean).join('\n');

    return this.sendMessage({
      chatId,
      text,
      type: 'LOCK_CONFIRMATION',
      threadId: thread.id,
      pairingCode: thread.pairingCode,
    });
  }

  /**
   * Sends or queues a flag alert when terms drift is disputed on G2
   */
  public async sendFlagAlert(
    chatId: string | number,
    thread: ThreadLock,
    reason: string
  ): Promise<OutgoingMessage> {
    const text = [
      `⚠️ <b>ThreadLock G2 — Terms Drift Flagged</b>`,
      ``,
      `<b>Deal:</b> ${thread.title}`,
      `<b>Notice:</b> Counterparty proposal deviates from our locked baseline.`,
      `<b>Disputed Item:</b> ${reason}`,
      ``,
      `<i>Please clarify or revise the proposal to match the agreed baseline terms.</i>`,
    ].join('\n');

    return this.sendMessage({
      chatId,
      text,
      type: 'FLAG_ALERT',
      threadId: thread.id,
      pairingCode: thread.pairingCode,
    });
  }

  /**
   * Sends or queues a crisp counter-offer message
   */
  public async sendCounterOffer(
    chatId: string | number,
    thread: ThreadLock,
    counterText: string
  ): Promise<OutgoingMessage> {
    const text = [
      `💬 <b>ThreadLock G2 — Counter-Offer</b>`,
      ``,
      `<b>Re:</b> ${thread.title}`,
      `${counterText}`,
      ``,
      `<i>Sent via ThreadLock G2 Smart Glasses HUD.</i>`,
    ].join('\n');

    return this.sendMessage({
      chatId,
      text,
      type: 'COUNTER_OFFER',
      threadId: thread.id,
      pairingCode: thread.pairingCode,
    });
  }

  /**
   * Sends or queues a rollback notice when an action is undone
   */
  public async sendUndoNotice(
    chatId: string | number,
    thread: ThreadLock
  ): Promise<OutgoingMessage> {
    const text = [
      `↩️ <b>ThreadLock G2 — Action Cancelled / Rolled Back</b>`,
      `The previous action on deal <b>${thread.title}</b> was reverted within the undo window. Active state restored to <code>${thread.currentState}</code>.`,
    ].join('\n');

    return this.sendMessage({
      chatId,
      text,
      type: 'UNDO_NOTICE',
      threadId: thread.id,
      pairingCode: thread.pairingCode,
    });
  }

  public getQueue(pairingCode?: string): OutgoingMessage[] {
    if (!pairingCode) return [...this.queue];
    return this.queue.filter(m => m.pairingCode === pairingCode);
  }

  public cancelMessage(id: string): boolean {
    const msg = this.queue.find(m => m.id === id);
    if (!msg || msg.status === 'sent') return false;
    msg.status = 'cancelled';
    return true;
  }

  public clearQueue(): void {
    this.queue = [];
  }
}
