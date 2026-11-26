import { EvaluationResult, StructuredDiff, StructuredTerms, ThreadLock } from '../types/index.js';
import { extractPrices, normalizeCurrency } from './currency-parser.js';
import { extractDeadlines, getDaysDifference } from './deadline-parser.js';
import { formatGlanceAlert } from './glance-formatter.js';
import { evaluateCustomRules } from './rules-engine.js';
import { compareScope } from './scope-comparator.js';
import { detectSemanticDrift } from './semantic-detector.js';

export class DiffEngine {
  /**
   * Evaluates an incoming message, proposal draft, or structured counter against a locked thread
   */
  public async evaluate(
    lockedTerms: StructuredTerms,
    baselineSummary: string,
    incomingText: string,
    proposedTerms?: Partial<StructuredTerms>
  ): Promise<EvaluationResult> {
    const structuredDiffs: StructuredDiff[] = [];

    // --- 1. Price & Currency Evaluation ---
    const lockedPrice = lockedTerms.price;
    const lockedCurrency = normalizeCurrency(lockedTerms.currency);

    // Extract amounts from text and/or proposedTerms
    const extracted = extractPrices(incomingText);
    const candidatePrice = proposedTerms?.price !== undefined
      ? proposedTerms.price
      : (extracted.length > 0 ? extracted[0].price : undefined);

    const candidateCurrency = proposedTerms?.currency
      ? normalizeCurrency(proposedTerms.currency)
      : (extracted.length > 0 ? extracted[0].currency : undefined);

    if (lockedPrice !== undefined && candidatePrice !== undefined) {
      if (candidateCurrency && candidateCurrency !== lockedCurrency) {
        structuredDiffs.push({
          field: 'currency',
          driftType: 'CURRENCY_MISMATCH',
          oldValue: lockedCurrency,
          newValue: candidateCurrency,
          changeDescription: `Currency changed from ${lockedCurrency} to ${candidateCurrency}`,
          severity: 'HIGH',
        });
      }

      const priceDiff = candidatePrice - lockedPrice;
      if (Math.abs(priceDiff) >= 0.01) {
        const pct = Math.round((priceDiff / lockedPrice) * 100);
        const sign = priceDiff > 0 ? '+' : '';
        const isIncrease = priceDiff > 0;

        structuredDiffs.push({
          field: 'price',
          driftType: isIncrease ? 'PRICE_INCREASE' : 'PRICE_DECREASE',
          oldValue: `${lockedCurrency} ${lockedPrice.toLocaleString()}`,
          newValue: `${candidateCurrency || lockedCurrency} ${candidatePrice.toLocaleString()}`,
          changeDescription: `Price: ${sign}${priceDiff.toLocaleString()} (${sign}${pct}%)`,
          severity: Math.abs(pct) > 10 ? 'HIGH' : 'MEDIUM',
        });
      }
    }

    // --- 2. Deadline Evaluation ---
    const lockedDeadline = lockedTerms.deadline;
    const extractedDates = extractDeadlines(incomingText);
    const candidateDeadline = proposedTerms?.deadline || (extractedDates.length > 0 ? extractedDates[0].isoDate : undefined);
    const isRemoval = extractedDates.some(d => d.isRemoval);

    if (lockedDeadline) {
      if (isRemoval) {
        structuredDiffs.push({
          field: 'deadline',
          driftType: 'DEADLINE_REMOVED',
          oldValue: lockedDeadline,
          newValue: 'None / Open-ended',
          changeDescription: 'Agreed deadline removed / open-ended schedule',
          severity: 'HIGH',
        });
      } else if (candidateDeadline && candidateDeadline !== lockedDeadline) {
        const daysDiff = getDaysDifference(lockedDeadline, candidateDeadline);
        if (daysDiff !== 0) {
          const isExtended = daysDiff > 0;
          structuredDiffs.push({
            field: 'deadline',
            driftType: isExtended ? 'DEADLINE_EXTENDED' : 'DEADLINE_SHORTENED',
            oldValue: lockedDeadline,
            newValue: candidateDeadline,
            changeDescription: `Deadline shifted by ${Math.abs(daysDiff)} days (${isExtended ? 'later' : 'earlier'})`,
            severity: Math.abs(daysDiff) > 7 ? 'HIGH' : 'MEDIUM',
          });
        }
      }
    }

    // --- 3. Scope Evaluation ---
    const scopeResult = compareScope(lockedTerms.scope, incomingText, proposedTerms?.scope);
    structuredDiffs.push(...scopeResult.diffs);

    // --- 4. Custom Rules Evaluation ---
    const ruleViolations = evaluateCustomRules(lockedTerms.customRules, incomingText);

    // --- 5. Semantic Drift Evaluation ---
    const semanticResult = await detectSemanticDrift(baselineSummary, incomingText);

    // Check if message is a pure confirmation
    const isConfirmation = !semanticResult.detected &&
      semanticResult.reason.includes('confirmed') &&
      structuredDiffs.length === 0 &&
      ruleViolations.length === 0;

    // --- 6. Format Glance Alert for Even Realities G2 Display ---
    const glance = formatGlanceAlert({
      structuredDiffs,
      ruleViolations,
      semanticDrift: semanticResult,
      isConfirmationMatch: isConfirmation,
    });

    const hasDrift = structuredDiffs.length > 0 || ruleViolations.length > 0 || semanticResult.detected;

    // Confidence calculation
    let confidence = 0.95;
    if (semanticResult?.detected && structuredDiffs.length === 0) {
      confidence = semanticResult.confidence;
    }

    return {
      hasDrift,
      severity: glance.severity,
      confidence,
      structuredDiffs,
      semanticDrift: semanticResult,
      ruleViolations,
      glance,
      rawInput: incomingText,
      timestamp: new Date().toISOString(),
    };
  }
}
