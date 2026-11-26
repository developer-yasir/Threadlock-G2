import cors from 'cors';
import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import dns from 'node:dns';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Ensure IPv6/IPv4 resolution order is verbatim for reliable Telegram Bot API connectivity
try {
  dns.setDefaultResultOrder('verbatim');
} catch {}

import { ActionExecutor } from './actions/action-executor.js';
import { CounterOfferGenerator } from './actions/counter-generator.js';
import { AuditTrailService } from './audit/audit-trail.js';
import { DiffEngine } from './diff-engine/index.js';
import { PairingService } from './pairing/pairing-service.js';
import { ThreadStateMachine } from './state-machine/index.js';
import { ThreadStore } from './storage/store.js';
import { EventStreamService } from './stream/event-stream.js';
import { TelegramBridgeService } from './telegram/telegram-bridge.js';
import { TelegramClient } from './telegram/telegram-client.js';
import { ActionExecutionRequest, StructuredTerms, ThreadLock, ThreadState, VoiceTranscriptionRequest } from './types/index.js';
import { VoiceTranscriptionService } from './voice/voice-service.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp() {
  const app = express();

  // Hackathon Clean CORS Configuration
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  }));
  app.use(express.json({ limit: '10mb' })); // Support base64 audio payloads for voice STT

  // Instantiate core services
  const diffEngine = new DiffEngine();
  const stateMachine = new ThreadStateMachine(
    parseInt(process.env.DEFAULT_UNDO_WINDOW_SECONDS || '30', 10)
  );
  const auditTrail = new AuditTrailService();
  const store = new ThreadStore();
  const pairing = new PairingService();
  const stream = new EventStreamService();
  const telegramClient = new TelegramClient();
  const counterGenerator = new CounterOfferGenerator();
  const actionExecutor = new ActionExecutor(
    store,
    stateMachine,
    auditTrail,
    stream,
    telegramClient,
    pairing,
    counterGenerator
  );
  const telegramBridge = new TelegramBridgeService(
    diffEngine,
    stateMachine,
    auditTrail,
    store,
    stream,
    pairing,
    telegramClient,
    actionExecutor
  );
  const voiceService = new VoiceTranscriptionService(actionExecutor);

  // Serve static assets for Companion Web and G2 App WebView
  const companionPath = path.resolve(__dirname, '../../companion-web');
  const g2AppPath = path.resolve(__dirname, '../../g2-app');

  app.use('/companion', express.static(companionPath));
  app.use('/g2', express.static(g2AppPath));
  app.use('/hud', express.static(g2AppPath));

  // Root landing page redirect / hub
  app.get('/', (_req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>ThreadLock G2 — Even Realities Hackathon</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #0a0d12; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
          .card { background: #121820; border: 1px solid #232d3d; border-radius: 12px; padding: 32px; max-width: 540px; text-align: center; }
          h1 { color: #00ff66; margin-bottom: 8px; font-family: monospace; }
          p { color: #94a3b8; line-height: 1.6; }
          .links { display: flex; gap: 12px; justify-content: center; margin-top: 24px; }
          a { background: #2563eb; color: #fff; text-decoration: none; padding: 12px 20px; border-radius: 6px; font-weight: 600; }
          a.g2 { background: #059669; }
          a:hover { opacity: 0.9; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>THREADLOCK G2</h1>
          <p>Real-Time Deal Commitment & Drift Detection HUD for Even Realities G2 Smart Glasses (Heads Up Hackathon).</p>
          <div class="links">
            <a href="/companion/">Companion Web Console</a>
            <a class="g2" href="/g2/">G2 Glasses HUD (576×288)</a>
          </div>
        </div>
      </body>
      </html>
    `);
  });

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'ThreadLock G2 Backend',
      timestamp: new Date().toISOString(),
      activePairingSessions: pairing.listSessions().length,
    });
  });

  // ==================== PAIRING API ====================

  app.post('/api/pair/create', (req: Request, res: Response) => {
    const { deviceId, customCode } = req.body;
    const session = pairing.createSession(deviceId, customCode);
    res.status(201).json(session);
  });

  app.post('/api/pair/verify', (req: Request, res: Response) => {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Pairing code is required' });
    }
    const session = pairing.getSession(code);
    if (!session || session.status !== 'active') {
      return res.status(404).json({ error: 'Pairing code invalid or expired' });
    }
    res.json(session);
  });

  app.get('/api/pair/sessions', (_req: Request, res: Response) => {
    res.json(pairing.listSessions());
  });

  // ==================== THREAD LOCK API ====================

  app.post('/api/threads', (req: Request, res: Response) => {
    const { pairingCode, title, counterparty, channel, baselineSummary, lockedTerms } = req.body;

    if (!pairingCode || !title || !baselineSummary) {
      return res.status(400).json({ error: 'pairingCode, title, and baselineSummary are required' });
    }

    if (!pairing.isValid(pairingCode)) {
      // Auto-register session if valid format
      pairing.createSession(undefined, pairingCode);
    }

    const now = new Date().toISOString();
    const thread: ThreadLock = {
      id: `th-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      pairingCode,
      title,
      counterparty: counterparty || 'Counterparty',
      channel: channel || 'manual',
      baselineSummary,
      lockedTerms: lockedTerms || {},
      currentState: 'PENDING_REVIEW',
      createdAt: now,
      updatedAt: now,
    };

    const created = store.create(thread);
    pairing.setActiveThread(pairingCode, created.id);

    // Initial audit log
    auditTrail.logEvent({
      threadId: created.id,
      pairingCode,
      actor: 'system',
      action: 'Thread Lock Created with baseline terms',
      toState: 'PENDING_REVIEW',
      metadata: { lockedTerms },
    });

    stream.broadcastToPairing(pairingCode, 'thread_created', created);

    res.status(201).json(created);
  });

  app.get('/api/threads', (req: Request, res: Response) => {
    const pairingCode = req.query.pairingCode as string;
    if (!pairingCode) {
      return res.status(400).json({ error: 'pairingCode query parameter is required for pairing isolation' });
    }
    const threads = store.listByPairingCode(pairingCode);
    res.json(threads);
  });

  app.get('/api/threads/:id', (req: Request, res: Response) => {
    const pairingCode = req.query.pairingCode as string;
    const thread = store.get(req.params.id);

    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    // Strict pairing isolation check
    if (pairingCode && thread.pairingCode !== pairingCode) {
      return res.status(403).json({ error: 'Access denied: thread does not belong to this pairing session' });
    }

    res.json(thread);
  });

  app.put('/api/threads/:id', (req: Request, res: Response) => {
    const { pairingCode, lockedTerms, baselineSummary, title } = req.body;
    const thread = store.get(req.params.id);

    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    if (pairingCode && thread.pairingCode !== pairingCode) {
      return res.status(403).json({ error: 'Access denied: thread does not belong to this pairing session' });
    }

    if (title) thread.title = title;
    if (baselineSummary) thread.baselineSummary = baselineSummary;
    if (lockedTerms) thread.lockedTerms = lockedTerms;

    const updated = store.update(thread);

    auditTrail.logEvent({
      threadId: updated.id,
      pairingCode: updated.pairingCode,
      actor: req.body.actor || 'user',
      action: 'Updated thread terms',
      metadata: { updatedTerms: lockedTerms },
    });

    stream.broadcastToPairing(updated.pairingCode, 'thread_updated', updated);

    res.json(updated);
  });

  app.delete('/api/threads/:id', (req: Request, res: Response) => {
    const pairingCode = req.query.pairingCode as string;
    if (!pairingCode) {
      return res.status(400).json({ error: 'pairingCode is required' });
    }

    const success = store.delete(req.params.id, pairingCode);
    if (!success) {
      return res.status(404).json({ error: 'Thread not found or pairing code mismatch' });
    }

    res.json({ success: true, message: 'Thread deleted' });
  });

  // ==================== DIFF EVALUATION API ====================

  app.post('/api/diff/evaluate', async (req: Request, res: Response) => {
    const { threadId, message, proposedTerms, pairingCode, sender } = req.body;

    if (!threadId || !message) {
      return res.status(400).json({ error: 'threadId and message are required' });
    }

    const thread = store.get(threadId);
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    if (pairingCode && thread.pairingCode !== pairingCode) {
      return res.status(403).json({ error: 'Access denied: thread does not belong to this pairing session' });
    }

    // Evaluate message against locked terms
    const evaluation = await diffEngine.evaluate(
      thread.lockedTerms,
      thread.baselineSummary,
      message,
      proposedTerms
    );

    thread.latestDiff = evaluation;
    thread.lastEvaluatedAt = new Date().toISOString();

    const fromState = thread.currentState;
    let targetState = fromState;

    if (evaluation.hasDrift) {
      targetState = evaluation.severity === 'HIGH' ? 'FLAGGED' : 'PENDING_REVIEW';
      if (stateMachine.canTransition(fromState, targetState)) {
        stateMachine.transition(thread, targetState, { actor: sender || 'diff-engine' });
      }
    }

    store.update(thread);

    // Audit trail record
    auditTrail.logEvent({
      threadId: thread.id,
      pairingCode: thread.pairingCode,
      actor: sender || 'counterparty',
      action: `Evaluated message: "${message.substring(0, 60)}"`,
      fromState,
      toState: thread.currentState,
      metadata: { proposedTerms },
      diffSnapshot: evaluation,
    });

    // Real-time broadcast to G2 glasses HUD
    stream.broadcastToPairing(thread.pairingCode, 'diff_alert', {
      threadId: thread.id,
      threadTitle: thread.title,
      sender: sender || thread.counterparty,
      message,
      state: thread.currentState,
      evaluation,
      glance: evaluation.glance,
    });

    res.json({
      threadId: thread.id,
      state: thread.currentState,
      evaluation,
    });
  });

  // ==================== STATE MACHINE API ====================

  app.post('/api/state/transition', (req: Request, res: Response) => {
    const { threadId, targetState, withUndoWindow, pairingCode, actor } = req.body;

    if (!threadId || !targetState) {
      return res.status(400).json({ error: 'threadId and targetState are required' });
    }

    const thread = store.get(threadId);
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    if (pairingCode && thread.pairingCode !== pairingCode) {
      return res.status(403).json({ error: 'Access denied: thread does not belong to this pairing session' });
    }

    try {
      const fromState = thread.currentState;
      const result = stateMachine.transition(thread, targetState as ThreadState, {
        withUndoWindow,
        actor: actor || 'user',
      });

      store.update(thread);

      auditTrail.logEvent({
        threadId: thread.id,
        pairingCode: thread.pairingCode,
        actor: actor || 'user',
        action: `State transitioned to ${result.newState}`,
        fromState,
        toState: result.newState,
        metadata: { inUndoWindow: result.inUndoWindow, undoDeadline: result.undoDeadline },
      });

      stream.broadcastToPairing(thread.pairingCode, 'state_changed', {
        threadId: thread.id,
        transition: result,
      });

      res.json({ success: true, thread, transition: result });
    } catch (err: any) {
      res.status(400).json({ error: err.message, fromState: thread.currentState, targetState });
    }
  });

  app.post('/api/state/undo', (req: Request, res: Response) => {
    const { threadId, pairingCode, actor } = req.body;
    if (!threadId) {
      return res.status(400).json({ error: 'threadId is required' });
    }

    const thread = store.get(threadId);
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    if (pairingCode && thread.pairingCode !== pairingCode) {
      return res.status(403).json({ error: 'Access denied: thread does not belong to this pairing session' });
    }

    try {
      const fromState = thread.currentState;
      const result = stateMachine.undo(thread);
      store.update(thread);

      auditTrail.logEvent({
        threadId: thread.id,
        pairingCode: thread.pairingCode,
        actor: actor || 'user',
        action: `Action rolled back from ${fromState} to ${result.newState}`,
        fromState,
        toState: result.newState,
      });

      stream.broadcastToPairing(thread.pairingCode, 'state_changed', {
        threadId: thread.id,
        transition: result,
        reverted: true,
      });

      res.json({ success: true, thread, transition: result });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/state/finalize', (req: Request, res: Response) => {
    const { threadId, committedState, pairingCode } = req.body;
    const thread = store.get(threadId);
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    if (pairingCode && thread.pairingCode !== pairingCode) {
      return res.status(403).json({ error: 'Access denied' });
    }

    try {
      const fromState = thread.currentState;
      const result = stateMachine.finalizeUndoWindow(thread, committedState as ThreadState);
      store.update(thread);

      auditTrail.logEvent({
        threadId: thread.id,
        pairingCode: thread.pairingCode,
        actor: 'system',
        action: `Undo window finalized to ${committedState}`,
        fromState,
        toState: committedState,
      });

      stream.broadcastToPairing(thread.pairingCode, 'state_changed', {
        threadId: thread.id,
        transition: result,
      });

      res.json({ success: true, thread, transition: result });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  // ==================== AUDIT TRAIL API ====================

  app.get('/api/audit/:threadId', (req: Request, res: Response) => {
    const pairingCode = req.query.pairingCode as string;
    const thread = store.get(req.params.threadId);

    if (thread && pairingCode && thread.pairingCode !== pairingCode) {
      return res.status(403).json({ error: 'Access denied to audit trail' });
    }

    const events = auditTrail.getEventsForThread(req.params.threadId);
    res.json(events);
  });

  app.get('/api/audit/verify/:threadId', (req: Request, res: Response) => {
    const verification = auditTrail.verifyChainIntegrity(req.params.threadId);
    res.json(verification);
  });

  // ==================== REAL-TIME SSE STREAM ====================

  app.get('/api/stream', (req: Request, res: Response) => {
    const pairingCode = (req.query.pairingCode as string) || 'G2-DEFAULT';
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    stream.registerClient(clientId, pairingCode, res);
  });

  // ==================== UNIFIED G2 ACTION EXECUTION API ====================

  app.post('/api/actions/execute', async (req: Request, res: Response) => {
    const { threadId, pairingCode, action, actor, customNote, targetTerms, withUndoWindow, sendTelegramNotification } = req.body;

    if (!threadId || !action) {
      return res.status(400).json({ error: 'threadId and action (LOCK | FLAG | COUNTER | UNDO) are required' });
    }

    try {
      const result = await actionExecutor.executeAction({
        threadId,
        pairingCode,
        action,
        actor,
        customNote,
        targetTerms,
        withUndoWindow,
        sendTelegramNotification,
      });

      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message, action, threadId });
    }
  });

  // ==================== SERVER-SIDE VOICE / AUDIO STT API ====================

  app.post('/api/voice/transcribe', async (req: Request, res: Response) => {
    const { audioBase64, mimeType, commandText, pairingCode, threadId, autoExecuteAction } = req.body;

    if (!audioBase64 && !commandText) {
      return res.status(400).json({ error: 'Either audioBase64 or commandText must be provided' });
    }

    try {
      const result = await voiceService.processVoice({
        audioBase64,
        mimeType,
        commandText,
        pairingCode,
        threadId,
        autoExecuteAction,
      });

      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ==================== TELEGRAM BRIDGE API ====================

  app.post('/api/telegram/link', (req: Request, res: Response) => {
    const { pairingCode, chatId, username, firstName, isGroup } = req.body;
    if (!pairingCode || !chatId) {
      return res.status(400).json({ error: 'pairingCode and chatId are required' });
    }

    const session = pairing.getSession(pairingCode);
    if (!session) {
      return res.status(404).json({ error: 'Pairing session not found' });
    }

    const linked = pairing.linkTelegramChat(pairingCode, {
      chatId,
      username,
      firstName,
      linkedAt: new Date().toISOString(),
      isGroup,
    });

    if (linked) {
      stream.broadcastToPairing(pairingCode, 'telegram_linked', {
        pairingCode,
        chatId,
        username,
        firstName,
      });
      res.json({ success: true, message: `Telegram chat ${chatId} linked to session ${pairingCode}` });
    } else {
      res.status(500).json({ error: 'Failed to link Telegram chat' });
    }
  });

  app.get('/api/telegram/status', (req: Request, res: Response) => {
    const pairingCode = req.query.pairingCode as string;
    if (!pairingCode) {
      return res.status(400).json({ error: 'pairingCode is required' });
    }

    const session = pairing.getOrCreateSession(pairingCode);
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || '@threadlock_g2_bot';
    const deepLink = pairing.getTelegramDeepLink(pairingCode, botUsername);

    res.json({
      pairingCode,
      isLinked: !!session.telegramLink,
      telegramLink: session.telegramLink,
      botUsername,
      deepLink,
      hasBotToken: telegramClient.hasToken(),
    });
  });

  app.post('/api/telegram/unlink', (req: Request, res: Response) => {
    const { pairingCode } = req.body;
    if (!pairingCode) {
      return res.status(400).json({ error: 'pairingCode is required' });
    }

    const unlinked = pairing.unlinkTelegramChat(pairingCode);
    res.json({ success: unlinked });
  });

  app.get('/api/telegram/verify', async (_req: Request, res: Response) => {
    if (!telegramClient.hasToken()) {
      return res.status(400).json({
        ok: false,
        error: 'TELEGRAM_BOT_TOKEN is not configured in .env',
      });
    }

    const verification = await telegramClient.getMe();
    if (verification.ok && verification.result) {
      // Auto-start polling if not active and not using webhook
      const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
      const isWebhookActive = !!webhookUrl && webhookUrl !== 'none' && webhookUrl.trim().startsWith('http');
      if (!telegramBridge.isPolling() && process.env.TELEGRAM_POLLING !== 'false' && !isWebhookActive) {
        await telegramBridge.startPolling();
      }

      res.json({
        ok: true,
        bot: {
          id: verification.result.id,
          username: verification.result.username,
          firstName: verification.result.first_name,
        },
        pollingActive: telegramBridge.isPolling(),
      });
    } else {
      res.status(502).json({
        ok: false,
        error: verification.error || 'Failed to verify bot credentials with Telegram API',
      });
    }
  });

  app.post('/api/telegram/start-polling', async (_req: Request, res: Response) => {
    try {
      await telegramBridge.startPolling();
      res.json({ ok: true, pollingActive: telegramBridge.isPolling() });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/telegram/set-webhook', async (req: Request, res: Response) => {
    try {
      const targetUrl = req.body.url || `${req.protocol}://${req.get('host')}/api/telegram/webhook`;
      const data = await telegramClient.apiCall(`setWebhook?url=${encodeURIComponent(targetUrl)}`);
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/telegram/queue', (req: Request, res: Response) => {
    const pairingCode = req.query.pairingCode as string;
    const queue = telegramClient.getQueue(pairingCode);
    res.json(queue);
  });

  app.post('/api/telegram/webhook', async (req: Request, res: Response) => {
    const parsed = telegramBridge.parseWebhookPayload(req.body);
    if (!parsed) {
      return res.status(200).json({ status: 'ignored_not_text_message' });
    }

    const pairingCodeHint = req.query.pairingCode as string;
    const result = await telegramBridge.handleMessage(parsed, pairingCodeHint);
    res.json(result);
  });

  app.post('/api/telegram/simulate', async (req: Request, res: Response) => {
    const { text, senderName, senderUsername, pairingCode, chatId } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const incoming = {
      messageId: Date.now(),
      chatId: chatId || 'sim-chat-123',
      senderName: senderName || 'Client Alice',
      senderUsername: senderUsername || '@alice_client',
      text,
      timestamp: new Date().toISOString(),
    };

    const result = await telegramBridge.handleMessage(incoming, pairingCode);
    res.json(result);
  });

  return {
    app,
    diffEngine,
    stateMachine,
    auditTrail,
    store,
    pairing,
    stream,
    telegramBridge,
    telegramClient,
    actionExecutor,
    counterGenerator,
    voiceService,
  };
}

// Start standalone server when executed directly
const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('server.ts') ||
  process.argv[1].endsWith('server.js')
);

if (isDirectRun) {
  const { app, telegramBridge, telegramClient } = createApp();
  const PORT = parseInt(process.env.PORT || '4000', 10);
  const HOST = process.env.HOST || '0.0.0.0';

  const server = http.createServer(app);
  server.listen(PORT, HOST, async () => {
    console.log(`====================================================`);
    console.log(` THREADLOCK G2 - Backend & Diff Engine Active `);
    console.log(` Port: ${PORT} | Host: ${HOST} `);
    console.log(` Companion Web: http://localhost:${PORT}/companion/ `);
    console.log(` G2 Glasses App HUD: http://localhost:${PORT}/g2/ `);

    // Verify Telegram bot and start long-polling worker if token configured
    if (telegramClient.hasToken()) {
      try {
        const botInfo = await telegramClient.getMe();
        if (botInfo.ok && botInfo.result) {
          console.log(` Telegram Bot Verified: @${botInfo.result.username} (ID: ${botInfo.result.id})`);
        } else {
          console.warn(` Telegram Bot Token Verification Warning: ${botInfo.error}`);
        }

        const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL;
        const isWebhookActive = !!webhookUrl && webhookUrl !== 'none' && webhookUrl.trim().startsWith('http');
        const pollingEnabled = process.env.TELEGRAM_POLLING !== 'false' && !isWebhookActive;
        if (pollingEnabled) {
          console.log(` Telegram Bot Long-Polling Worker Started (Real-time live ingestion)`);
          await telegramBridge.startPolling();
        }
      } catch (err: any) {
        console.warn(` Telegram Startup Check Warning: ${err.message}`);
      }
    } else {
      console.log(` Telegram Bot: Offline / Simulation Mode (no TELEGRAM_BOT_TOKEN set)`);
    }

    console.log(`====================================================`);
  });
}
