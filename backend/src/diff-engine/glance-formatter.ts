import { DriftSeverity, DriftType, GlanceAlert, RuleViolation, SemanticDriftResult, StructuredDiff } from '../types/index.js';

export function formatGlanceAlert(params: {
  structuredDiffs: StructuredDiff[];
  ruleViolations: RuleViolation[];
  semanticDrift?: SemanticDriftResult;
  isConfirmationMatch?: boolean;
}): GlanceAlert {
  const { structuredDiffs, ruleViolations, semanticDrift, isConfirmationMatch } = params;

  // 1. Clean confirmation (no drift)
  if (isConfirmationMatch && structuredDiffs.length === 0 && ruleViolations.length === 0) {
    return {
      headlineDiff: 'LOCKED: ZERO DRIFT',
      oldValue: 'Baseline Terms',
      newValue: 'Confirmed by Counterparty',
      driftTypes: ['CONFIRMATION_MATCH'],
      severity: 'LOW',
      recommendedAction: 'ACCEPT_LOCK',
      shortReason: 'All terms match locked agreement',
      g2Lines: [
        '[OK] THREADLOCK: MATCH',
        'STATUS: NO DRIFT DETECTED',
        'Counterparty confirmed all terms',
        'OLD: 100% Locked | NEW: Matches',
        'ACTION: SAFE TO PROCEED',
        '<TAP: HOLD LOCK | SWIPE: DISMISS>',
      ],
    };
  }

  // 2. Aggregate drift types & highest severity
  const driftTypes: DriftType[] = [];
  let highestSeverity: DriftSeverity = 'LOW';

  for (const d of structuredDiffs) {
    if (!driftTypes.includes(d.driftType)) driftTypes.push(d.driftType);
    if (d.severity === 'HIGH') highestSeverity = 'HIGH';
    else if (d.severity === 'MEDIUM' && highestSeverity !== 'HIGH') highestSeverity = 'MEDIUM';
  }

  for (const r of ruleViolations) {
    if (!driftTypes.includes('CUSTOM_RULE_VIOLATION')) driftTypes.push('CUSTOM_RULE_VIOLATION');
    if (r.severity === 'HIGH') highestSeverity = 'HIGH';
    else if (r.severity === 'MEDIUM' && highestSeverity !== 'HIGH') highestSeverity = 'MEDIUM';
  }

  if (semanticDrift?.detected) {
    if (!driftTypes.includes('SEMANTIC_DRIFT')) driftTypes.push('SEMANTIC_DRIFT');
    if (semanticDrift.severity === 'HIGH') highestSeverity = 'HIGH';
    else if (semanticDrift.severity === 'MEDIUM' && highestSeverity !== 'HIGH') highestSeverity = 'MEDIUM';
  }

  // If no drift found at all
  if (driftTypes.length === 0) {
    return {
      headlineDiff: 'UNMODIFIED DRAFT',
      oldValue: 'Locked Baseline',
      newValue: 'Incoming Proposal',
      driftTypes: [],
      severity: 'LOW',
      recommendedAction: 'DISMISS',
      shortReason: 'No measurable drift detected',
      g2Lines: [
        '[i] THREADLOCK: ACTIVE',
        'TERMS: UNCHANGED',
        'No critical shift found in message',
        'OLD: Baseline | NEW: Unchanged',
        'ACTION: MONITORING ACTIVE',
        '<SWIPE: DISMISS>',
      ],
    };
  }

  // 3. Determine headline diff and old/new representations based on primary drift
  let headlineDiff = 'TERMS DRIFT DETECTED';
  let oldValueStr = 'Baseline';
  let newValueStr = 'Proposed';
  let shortReason = 'Terms deviate from locked baseline';
  let recommendedAction: 'FLAG' | 'COUNTER' | 'ACCEPT_LOCK' | 'DISMISS' = 'FLAG';

  const priceDiff = structuredDiffs.find(d => d.field === 'price' || d.field === 'currency');
  const deadlineDiff = structuredDiffs.find(d => d.field === 'deadline');
  const scopeDiff = structuredDiffs.find(d => d.field === 'scope');

  if (priceDiff) {
    headlineDiff = priceDiff.changeDescription.length > 30
      ? priceDiff.changeDescription.substring(0, 27) + '...'
      : priceDiff.changeDescription;
    oldValueStr = String(priceDiff.oldValue);
    newValueStr = String(priceDiff.newValue);
    shortReason = `Price shifted: ${oldValueStr} -> ${newValueStr}`;
    recommendedAction = highestSeverity === 'HIGH' ? 'FLAG' : 'COUNTER';
  } else if (deadlineDiff) {
    headlineDiff = deadlineDiff.changeDescription.length > 30
      ? deadlineDiff.changeDescription.substring(0, 27) + '...'
      : deadlineDiff.changeDescription;
    oldValueStr = String(deadlineDiff.oldValue);
    newValueStr = String(deadlineDiff.newValue);
    shortReason = `Deadline shifted: ${oldValueStr} -> ${newValueStr}`;
    recommendedAction = 'COUNTER';
  } else if (scopeDiff) {
    headlineDiff = scopeDiff.driftType === 'SCOPE_CREEP' ? 'SCOPE CREEP: NEW ITEM' : 'SCOPE REDUCED';
    oldValueStr = String(scopeDiff.oldValue || 'None');
    newValueStr = String(scopeDiff.newValue || 'None');
    shortReason = scopeDiff.changeDescription;
    recommendedAction = 'FLAG';
  } else if (ruleViolations.length > 0) {
    headlineDiff = `RULE BREAK: ${ruleViolations[0].ruleName.toUpperCase()}`.substring(0, 30);
    oldValueStr = 'Locked Rule';
    newValueStr = ruleViolations[0].ruleName;
    shortReason = ruleViolations[0].reason;
    recommendedAction = 'FLAG';
  } else if (semanticDrift?.detected) {
    headlineDiff = 'SEMANTIC DRIFT FLAGGED';
    oldValueStr = 'Agreed Terms';
    newValueStr = 'Modified Tone/Clause';
    shortReason = semanticDrift.reason;
    recommendedAction = 'FLAG';
  }

  // Format 576x288 HUD display lines (max 6 lines, 30-34 chars max per line)
  const severityTag = highestSeverity === 'HIGH' ? '[!!!] HIGH DRIFT' : '[!] DRIFT DETECTED';
  const tagList = driftTypes.map(t => `[${t.replace(/_/g, '')}]`).join(' ').substring(0, 32);

  const g2Lines: string[] = [
    severityTag,
    headlineDiff.toUpperCase().substring(0, 32),
    `OLD: ${oldValueStr.substring(0, 12)} | NEW: ${newValueStr.substring(0, 12)}`,
    tagList.length > 0 ? tagList : `TYPE: ${driftTypes[0] || 'TERMS'}`,
    `RECOM: ${recommendedAction} OFFER`,
    `<SWIPE L: FLAG | SWIPE R: COUNTER>`,
  ];

  return {
    headlineDiff,
    oldValue: oldValueStr,
    newValue: newValueStr,
    driftTypes,
    severity: highestSeverity,
    recommendedAction,
    shortReason,
    g2Lines,
  };
}
