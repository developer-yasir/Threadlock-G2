import { Response } from 'express';

export interface StreamClient {
  id: string;
  pairingCode: string;
  res: Response;
  connectedAt: string;
}

export class EventStreamService {
  private clients: Map<string, StreamClient> = new Map();

  /**
   * Registers a client connection for real-time SSE stream
   */
  public registerClient(id: string, pairingCode: string, res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const client: StreamClient = {
      id,
      pairingCode,
      res,
      connectedAt: new Date().toISOString(),
    };

    this.clients.set(id, client);

    // Initial greeting event
    this.sendToClient(client, 'connected', {
      clientId: id,
      pairingCode,
      message: 'ThreadLock G2 real-time HUD event stream connected',
    });

    res.on('close', () => {
      this.clients.delete(id);
    });
  }

  /**
   * Broadcasts an event to all clients bound to a pairing code
   */
  public broadcastToPairing(pairingCode: string, eventName: string, data: any): void {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients.values()) {
      if (client.pairingCode === pairingCode) {
        try {
          client.res.write(payload);
        } catch {
          this.clients.delete(client.id);
        }
      }
    }
  }

  private sendToClient(client: StreamClient, eventName: string, data: any): void {
    try {
      client.res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      this.clients.delete(client.id);
    }
  }

  public getActiveClientCount(pairingCode?: string): number {
    if (!pairingCode) return this.clients.size;
    let count = 0;
    for (const c of this.clients.values()) {
      if (c.pairingCode === pairingCode) count++;
    }
    return count;
  }
}
