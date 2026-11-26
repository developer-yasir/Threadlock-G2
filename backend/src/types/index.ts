export type ThreadState =
  | 'PENDING_REVIEW'
  | 'LOCKED_NEW'
  | 'FLAGGED'
  | 'COUNTER_SENT'
  | 'UNDO_WINDOW';

export type DriftSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export type DriftType =
  | 'PRICE_INCREASE'
  | 'PRICE_DECREASE'
  | 'CURRENCY_MISMATCH'
  | 'PAYMENT_TERMS_SHIFT'
  | 'DEADLINE_EXTENDED'
  | 'DEADLINE_SHORTENED'
  | 'DEADLINE_REMOVED'
  | 'SCOPE_CREEP'
  | 'SCOPE_REMOVAL'
  | 'SCOPE_RESTRICTION'
  | 'CUSTOM_RULE_VIOLATION'
  | 'SEMANTIC_DRIFT'
  | 'CONFIRMATION_MATCH';

export interface CustomRule {
  id: string;
  name: string;
  description: string;
  forbiddenKeywords?: string[];
  requiredKeywords?: string[];
  pattern?: string;
  severity: DriftSeverity;
}

export interface StructuredTerms {
  price?: number;
  currency?: string;
  deadline?: string; // ISO date or "YYYY-MM-DD"
  scope?: string[];
  paymentTerms?: string; // e.g. "50% upfront, 50% on completion", "Net 30"
  customRules?: CustomRule[];
}

export interface StructuredDiff {
  field: string;
  driftType: DriftType;
  oldValue: any;
  newValue: any;
  changeDescription: string;
  severity: DriftSeverity;
}

export interface GlanceAlert {
  headlineDiff: string;       // e.g. "PRICE: +$1,500 (+15%)"
  oldValue: string;          // e.g. "$10,000 USD"
  newValue: string;          // e.g. "$11,500 USD"
  driftTypes: DriftType[];
  severity: DriftSeverity;
  recommendedAction: 'FLAG' | 'COUNTER' | 'ACCEPT_LOCK' | 'DISMISS';
  shortReason: string;       // e.g. "Price increased above agreed baseline"
  g2Lines: string[];         // Max 6 lines formatted for Even G2 576x288 HUD display
}

export interface SemanticDriftResult {
  detected: boolean;
  reason: string;
  confidence: number;
  severity: DriftSeverity;
  detectedChanges?: string[];
}

export interface RuleViolation {
  ruleId: string;
  ruleName: string;
  reason: string;
  severity: DriftSeverity;
}

export interface EvaluationResult {
  hasDrift: boolean;
  severity: DriftSeverity;
  confidence: number;
  structuredDiffs: StructuredDiff[];
  semanticDrift?: SemanticDriftResult;
  ruleViolations: RuleViolation[];
  glance: GlanceAlert;
  rawInput: string;
  timestamp: string;
}

export interface ThreadLock {
  id: string;
  pairingCode: string;
  title: string;
  counterparty: string;
  channel: 'telegram' | 'email' | 'slack' | 'manual';
  baselineSummary: string;
  lockedTerms: StructuredTerms;
  previousLockedTerms?: StructuredTerms; // Saved for rollback on undo
  flagReason?: string;
  currentState: ThreadState;
  previousState?: ThreadState;
  undoDeadline?: string;
  latestDiff?: EvaluationResult;
  lastEvaluatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuditEvent {
  id: string;
  threadId: string;
  pairingCode: string;
  timestamp: string;
  actor: string;
  action: string;
  fromState?: ThreadState;
  toState?: ThreadState;
  metadata?: Record<string, any>;
  diffSnapshot?: EvaluationResult;
  previousHash: string;
  hash: string;
}

export interface TelegramChatLink {
  chatId: string | number;
  username?: string;
  firstName?: string;
  linkedAt: string;
  isGroup?: boolean;
}

export interface PairingSession {
  code: string;
  deviceId: string;
  connectedAt: string;
  lastHeartbeat: string;
  activeThreadId?: string;
  status: 'active' | 'expired';
  telegramLink?: TelegramChatLink;
}

export type UserAction = 'LOCK' | 'FLAG' | 'COUNTER' | 'UNDO';

export interface OutgoingMessage {
  id: string;
  threadId: string;
  pairingCode: string;
  chatId: string | number;
  text: string;
  type: 'LOCK_CONFIRMATION' | 'FLAG_ALERT' | 'COUNTER_OFFER' | 'UNDO_NOTICE' | 'STATUS_REPLY';
  status: 'sent' | 'queued' | 'cancelled';
  timestamp: string;
  error?: string;
}

export interface ActionExecutionRequest {
  threadId: string;
  pairingCode: string;
  action: UserAction;
  actor?: string;
  chatId?: string | number;
  customNote?: string;
  targetTerms?: Partial<StructuredTerms>;
  withUndoWindow?: boolean;
  sendTelegramNotification?: boolean;
}

export interface ActionExecutionResult {
  success: boolean;
  action: UserAction;
  thread: ThreadLock;
  outgoingMessage?: OutgoingMessage;
  inUndoWindow: boolean;
  undoDeadline?: string;
  auditEvent: AuditEvent;
  message: string;
}

export type VoiceCommandIntent =
  | 'LOCK_TERMS'
  | 'FLAG_DRIFT'
  | 'COUNTER_OFFER'
  | 'UNDO'
  | 'INCOMING_PROPOSAL'
  | 'QUERY_STATUS'
  | 'UNKNOWN';

export interface VoiceTranscriptionRequest {
  audioBase64?: string;
  mimeType?: string;
  commandText?: string;
  pairingCode?: string;
  threadId?: string;
  autoExecuteAction?: boolean;
}

export interface VoiceTranscriptionResult {
  transcribedText: string;
  confidence: number;
  detectedIntent: VoiceCommandIntent;
  executedAction?: ActionExecutionResult;
  provider: string;
}

