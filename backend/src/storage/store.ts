import { ThreadLock } from '../types/index.js';

export class ThreadStore {
  private threads: Map<string, ThreadLock> = new Map();

  public create(thread: ThreadLock): ThreadLock {
    this.threads.set(thread.id, { ...thread });
    return thread;
  }

  public get(id: string): ThreadLock | undefined {
    const thread = this.threads.get(id);
    return thread ? { ...thread } : undefined;
  }

  /**
   * Retrieves all threads belonging strictly to a specific pairing code (pairing isolation)
   */
  public listByPairingCode(pairingCode: string): ThreadLock[] {
    return Array.from(this.threads.values())
      .filter(t => t.pairingCode === pairingCode)
      .map(t => ({ ...t }));
  }

  public update(thread: ThreadLock): ThreadLock {
    if (!this.threads.has(thread.id)) {
      throw new Error(`Thread not found: ${thread.id}`);
    }
    const updated = {
      ...thread,
      updatedAt: new Date().toISOString(),
    };
    this.threads.set(thread.id, updated);
    return updated;
  }

  public delete(id: string, pairingCode: string): boolean {
    const thread = this.threads.get(id);
    if (!thread || thread.pairingCode !== pairingCode) {
      return false;
    }
    return this.threads.delete(id);
  }

  /**
   * Checks if a thread belongs to the given pairing code
   */
  public belongsToPairing(threadId: string, pairingCode: string): boolean {
    const thread = this.threads.get(threadId);
    return !!thread && thread.pairingCode === pairingCode;
  }

  public clear(): void {
    this.threads.clear();
  }
}
