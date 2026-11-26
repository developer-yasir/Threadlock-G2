import { DriftSeverity, DriftType, StructuredDiff } from '../types/index.js';

export interface ScopeEvaluation {
  hasCreep: boolean;
  hasRemoval: boolean;
  creptItems: string[];
  removedItems: string[];
  diffs: StructuredDiff[];
}

/**
 * Common scope creep trigger patterns in client negotiation messages
 */
const SCOPE_CREEP_PATTERNS = [
  /(?:can you also|could you also|also include|please add|we also need|must also include|expand scope to|would like to add|plus we need|throw in|additional requirement|also want)\s+([^.?!,;\n]{4,80})/gi,
  /(?:scope includes|new deliverable|added item|additional deliverable|don't forget to include)\s+([^.?!,;\n]{4,80})/gi,
];

const SCOPE_REMOVAL_PATTERNS = [
  /(?:we'll drop|remove|skip|no longer need|exclude|cancel deliverable|leave out)\s+([^.?!,;\n]{4,80})/gi,
];

/**
 * Token set overlap similarity (0.0 to 1.0)
 */
function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(t => t.length > 2));
  const tokensB = new Set(b.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(t => t.length > 2));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

export function compareScope(
  baselineScope: string[] = [],
  incomingText: string,
  proposedScopeList?: string[]
): ScopeEvaluation {
  const diffs: StructuredDiff[] = [];
  const creptItems: string[] = [];
  const removedItems: string[] = [];

  // 1. If an explicit new scope array was passed (e.g. structured counter)
  if (proposedScopeList && proposedScopeList.length > 0) {
    // Check for additions
    for (const newItem of proposedScopeList) {
      const matched = baselineScope.some(baseItem => tokenSimilarity(baseItem, newItem) > 0.6);
      if (!matched) {
        creptItems.push(newItem);
        diffs.push({
          field: 'scope',
          driftType: 'SCOPE_CREEP',
          oldValue: null,
          newValue: newItem,
          changeDescription: `New unapproved deliverable: "${newItem}"`,
          severity: 'HIGH',
        });
      }
    }

    // Check for baseline items missing in proposal
    for (const baseItem of baselineScope) {
      const stillPresent = proposedScopeList.some(newItem => tokenSimilarity(baseItem, newItem) > 0.6);
      if (!stillPresent) {
        removedItems.push(baseItem);
        diffs.push({
          field: 'scope',
          driftType: 'SCOPE_REMOVAL',
          oldValue: baseItem,
          newValue: null,
          changeDescription: `Agreed deliverable omitted: "${baseItem}"`,
          severity: 'MEDIUM',
        });
      }
    }
  }

  // 2. Check for linguistic scope creep phrases in message text
  for (const pattern of SCOPE_CREEP_PATTERNS) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(incomingText)) !== null) {
      const candidate = match[1].trim();
      // Ensure candidate isn't already covered in baseline
      const isAlreadyCovered = baselineScope.some(b => tokenSimilarity(b, candidate) > 0.4);
      if (!isAlreadyCovered && candidate.length > 3 && !creptItems.includes(candidate)) {
        creptItems.push(candidate);
        diffs.push({
          field: 'scope',
          driftType: 'SCOPE_CREEP',
          oldValue: 'Not in baseline',
          newValue: candidate,
          changeDescription: `Unagreed scope addition requested: "${candidate}"`,
          severity: 'HIGH',
        });
      }
    }
  }

  // 3. Check for scope removal phrases in message text
  for (const pattern of SCOPE_REMOVAL_PATTERNS) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(incomingText)) !== null) {
      const candidate = match[1].trim();
      // Check if candidate matches any baseline item
      const matchingBaseline = baselineScope.find(b => tokenSimilarity(b, candidate) > 0.35);
      if (matchingBaseline && !removedItems.includes(matchingBaseline)) {
        removedItems.push(matchingBaseline);
        diffs.push({
          field: 'scope',
          driftType: 'SCOPE_REMOVAL',
          oldValue: matchingBaseline,
          newValue: 'Removed/Excluded',
          changeDescription: `Client requested removal of deliverable: "${matchingBaseline}"`,
          severity: 'MEDIUM',
        });
      }
    }
  }

  return {
    hasCreep: creptItems.length > 0,
    hasRemoval: removedItems.length > 0,
    creptItems,
    removedItems,
    diffs,
  };
}
