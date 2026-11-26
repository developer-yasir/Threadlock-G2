import { PairingSession, TelegramChatLink } from '../types/index.js';

export class PairingService {
  private sessions: Map<string, PairingSession> = new Map();
  private chatToPairingMap: Map<string, string> = new Map();

  /**
   * Generates a 6-character alphanumeric pairing code formatted as G2-XXXX
   */
  public generateCode(): string {
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Exclude ambiguous chars like 0/O, 1/I
    let suffix = '';
    for (let i = 0; i < 4; i++) {
      suffix += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return `G2-${suffix}`;
  }

  /**
   * Registers a new pairing session for a device (glasses HUD or companion)
   */
  public createSession(deviceId?: string, customCode?: string): PairingSession {
    const code = customCode || this.generateCode();
    const session: PairingSession = {
      code,
      deviceId: deviceId || `dev-${Math.random().toString(36).substring(2, 9)}`,
      connectedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      status: 'active',
    };
    this.sessions.set(code, session);
    return session;
  }

  /**
   * Retrieves a session by code
   */
  public getSession(code: string): PairingSession | undefined {
    return this.sessions.get(code);
  }

  /**
   * Retrieves an existing session or creates it if it does not yet exist
   */
  public getOrCreateSession(code: string, deviceId?: string): PairingSession {
    let session = this.sessions.get(code);
    if (!session) {
      session = this.createSession(deviceId, code);
    }
    return session;
  }

  /**
   * Links a Telegram chat/user to this pairing session
   */
  public linkTelegramChat(pairingCode: string, link: TelegramChatLink): boolean {
    const session = this.sessions.get(pairingCode);
    if (!session) return false;

    session.telegramLink = link;
    session.lastHeartbeat = new Date().toISOString();

    const chatKey = String(link.chatId);
    this.chatToPairingMap.set(chatKey, pairingCode);
    return true;
  }

  /**
   * Finds the pairing session linked to a given Telegram chat ID
   */
  public getPairingByChatId(chatId: string | number): PairingSession | undefined {
    const chatKey = String(chatId);
    const pairingCode = this.chatToPairingMap.get(chatKey);
    if (!pairingCode) return undefined;
    return this.sessions.get(pairingCode);
  }

  /**
   * Unlinks a Telegram chat from this pairing session
   */
  public unlinkTelegramChat(pairingCode: string): boolean {
    const session = this.sessions.get(pairingCode);
    if (!session || !session.telegramLink) return false;

    const chatKey = String(session.telegramLink.chatId);
    this.chatToPairingMap.delete(chatKey);
    session.telegramLink = undefined;
    session.lastHeartbeat = new Date().toISOString();
    return true;
  }

  /**
   * Generates a Telegram deep link for seamless 1-click bot pairing
   * e.g. https://t.me/ThreadLockBot?start=G2-9A4B
   */
  public getTelegramDeepLink(pairingCode: string, botUsername: string = 'ThreadLockG2Bot'): string {
    const cleanUsername = botUsername.replace(/^@/, '');
    return `https://t.me/${cleanUsername}?start=${pairingCode}`;
  }

  /**
   * Sets active thread ID for this pairing session
   */
  public setActiveThread(code: string, threadId: string): boolean {
    const session = this.sessions.get(code);
    if (!session) return false;
    session.activeThreadId = threadId;
    session.lastHeartbeat = new Date().toISOString();
    return true;
  }

  /**
   * Verifies pairing code validity
   */
  public isValid(code: string): boolean {
    const session = this.sessions.get(code);
    return !!session && session.status === 'active';
  }

  public listSessions(): PairingSession[] {
    return Array.from(this.sessions.values());
  }

  public clear(): void {
    this.sessions.clear();
    this.chatToPairingMap.clear();
  }
}

